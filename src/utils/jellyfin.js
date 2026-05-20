import axios from 'axios';
import config from '../config.js';
import logger from './logger.js';
export class Jellyfin {
    client;
    userId = null;
    deviceId = 'streambot-' + Math.random().toString(36).substring(7);
    isAuthenticated = false;
    constructor() {
        let baseURL = config.jellyfinServerUrl;
        if (baseURL.endsWith('/')) {
            baseURL = baseURL.slice(0, -1);
        }
        const headers = {
            'X-Emby-Device-Id': this.deviceId,
            'X-Emby-Device-Name': 'StreamBot',
            'X-Emby-Client': 'StreamBot',
            'X-Emby-Client-Version': '1.0.0',
            'X-Emby-Authorization': `MediaBrowser Client="StreamBot", Device="${this.deviceId}", DeviceId="${this.deviceId}", Version="1.0.0"`,
        };
        this.client = axios.create({
            baseURL: baseURL,
            headers: headers,
            validateStatus: () => true,
            timeout: 10000,
        });
    }
    getRequestParams() {
        const params = {};
        if (config.jellyfinApiKey) {
            params.api_key = config.jellyfinApiKey;
        }
        return params;
    }
    async authenticate() {
        if (this.isAuthenticated) {
            return true;
        }
        try {
            logger.info(`🔗 Jellyfin Server URL: ${config.jellyfinServerUrl}`);
            logger.info(`🔑 Jellyfin API Key present: ${!!config.jellyfinApiKey}`);
            try {
                const sysInfo = await this.client.get('/System/Info', {
                    params: this.getRequestParams()
                });
                if (sysInfo.status === 200) {
                    logger.info(`✅ Connected to Jellyfin: ${sysInfo.data?.ServerName}`);
                }
                else {
                    logger.warn(`⚠️ Jellyfin system info returned status ${sysInfo.status}`);
                }
            }
            catch (e) {
                logger.error('Failed to connect to Jellyfin server:', e);
            }
            if (config.jellyfinApiKey) {
                logger.info('🔐 Attempting authentication with Jellyfin API key');
                const response = await this.client.get('/Users', {
                    params: this.getRequestParams()
                });
                logger.info(`   API Key request status: ${response.status}`);
                if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
                    const user = response.data[0];
                    this.userId = user.Id;
                    this.isAuthenticated = true;
                    logger.info(`✅ Authenticated to Jellyfin as ${user.Name} (ID: ${this.userId})`);
                    return true;
                }
                else {
                    logger.error(`❌ API key authentication failed. Status: ${response.status}`);
                    if (response.data) {
                        logger.error(`   Response:`, JSON.stringify(response.data).substring(0, 200));
                    }
                }
            }
            if (config.jellyfinUsername && config.jellyfinPassword) {
                logger.info('🔐 Attempting authentication with Jellyfin username/password');
                const response = await this.client.post('/Users/AuthenticateByName', {
                    Username: config.jellyfinUsername,
                    Pw: config.jellyfinPassword,
                    RememberMe: true,
                }, {
                    params: this.getRequestParams()
                });
                if (response.status === 200 && response.data?.User?.Id) {
                    this.userId = response.data.User.Id;
                    this.isAuthenticated = true;
                    if (response.data.AccessToken) {
                        this.client.defaults.headers['X-MediaBrowser-Token'] = response.data.AccessToken;
                    }
                    logger.info(`✅ Authenticated to Jellyfin as ${response.data.User.Name}`);
                    return true;
                }
                else {
                    logger.error(`❌ Username/password authentication failed. Status: ${response.status}`);
                }
            }
            if (!config.jellyfinApiKey && !(config.jellyfinUsername && config.jellyfinPassword)) {
                logger.warn('⚠️ Failed to authenticate to Jellyfin: no API key or credentials provided');
            }
            return false;
        }
        catch (error) {
            logger.error('❌ Jellyfin authentication error:', error);
            return false;
        }
    }
    async searchItems(query, limit = 20) {
        try {
            if (!this.userId) {
                await this.authenticate();
            }
            if (!this.userId) {
                logger.error('Not authenticated to Jellyfin');
                return [];
            }
            const playableTypes = ['Movie', 'Episode', 'Video'];
            try {
                const response = await this.client.get('/Items', {
                    params: {
                        ...this.getRequestParams(),
                        searchTerm: query,
                        userId: this.userId,
                        limit: limit * 2,
                        includeItemTypes: 'Movie,Episode,Video',
                        recursive: true,
                        fields: 'Overview,ImageTags',
                        sortBy: 'SortName',
                        sortOrder: 'Ascending',
                    },
                });
                const items = (response.data.Items || [])
                    .filter(item => playableTypes.includes(item.Type))
                    .slice(0, limit);
                if (items.length > 0) {
                    return items;
                }
            }
            catch (e) {
            }
            logger.info(`Direct search for "${query}" returned no results, trying library browse...`);
            const libraries = await this.getLibraries();
            const mediaLibs = libraries.filter(l => {
                const name = l.Name.toLowerCase();
                return (name.includes('movie') || name.includes('show') || name.includes('anime') || name.includes('series')) &&
                    !name.includes('music') && !name.includes('audio');
            });
            const allItems = [];
            for (const lib of mediaLibs) {
                if (allItems.length >= limit * 2)
                    break;
                try {
                    const libItems = await this.getLibraryItems(lib.Id, limit * 3);
                    const filtered = libItems
                        .filter(item => playableTypes.includes(item.Type))
                        .filter(item => item.Name.toLowerCase().includes(query.toLowerCase()));
                    allItems.push(...filtered);
                }
                catch (e) {
                    continue;
                }
            }
            if (allItems.length === 0) {
                const otherLibs = libraries.filter(l => {
                    const name = l.Name.toLowerCase();
                    return !mediaLibs.some(ml => ml.Id === l.Id) &&
                        !name.includes('music') &&
                        !name.includes('audio');
                });
                for (const lib of otherLibs) {
                    if (allItems.length >= limit * 2)
                        break;
                    try {
                        const libItems = await this.getLibraryItems(lib.Id, limit);
                        const filtered = libItems
                            .filter(item => playableTypes.includes(item.Type))
                            .filter(item => item.Name.toLowerCase().includes(query.toLowerCase()));
                        allItems.push(...filtered);
                    }
                    catch (e) {
                        continue;
                    }
                }
            }
            return allItems.slice(0, limit);
        }
        catch (error) {
            logger.error('Failed to search Jellyfin items:', error);
            return [];
        }
    }
    async getItemDetails(itemId) {
        try {
            if (!this.userId) {
                await this.authenticate();
            }
            const response = await this.client.get(`/Items/${itemId}`, {
                params: {
                    ...this.getRequestParams(),
                    userId: this.userId,
                },
            });
            if (response.status === 200) {
                return response.data;
            }
            return null;
        }
        catch (error) {
            logger.error('Failed to get Jellyfin item details:', error);
            return null;
        }
    }
    async getStreamUrl(itemId, audioIndex, subtitleIndex, seekTimeMs) {
        try {
            if (!this.userId) {
                await this.authenticate();
            }
            if (!this.userId) {
                logger.error('Not authenticated to Jellyfin');
                return null;
            }
            const token = config.jellyfinApiKey || this.client.defaults.headers['X-MediaBrowser-Token'] || '';
            const baseUrl = (this.client.defaults.baseURL || config.jellyfinServerUrl).replace(/\/$/, '');
            let url = `${baseUrl}/Videos/${itemId}/universal?UserId=${this.userId}&DeviceId=${this.deviceId}&api_key=${token}&Container=ts&VideoCodec=h264&AudioCodec=opus,aac,mp3&MaxStreamingBitrate=140000000`;
            if (audioIndex !== undefined && audioIndex !== null) {
                url += `&AudioStreamIndex=${audioIndex}`;
            }
            if (subtitleIndex !== undefined && subtitleIndex !== null) {
                url += `&SubtitleStreamIndex=${subtitleIndex}&SubtitleMethod=Encode`;
            }
            else {
                url += `&SubtitleMethod=None`;
            }
            if (seekTimeMs !== undefined && seekTimeMs > 0) {
                const ticks = Math.floor(seekTimeMs * 10000);
                url += `&StartTimeTicks=${ticks}`;
            }
            logger.info(`✅ Generated Jellyfin Universal URL: ${url}`);
            return url;
        }
        catch (error) {
            logger.error('Failed to get Jellyfin stream URL:', error);
            return null;
        }
    }
    async getLibraries() {
        try {
            if (!this.userId) {
                await this.authenticate();
            }
            if (!this.userId) {
                logger.error('Not authenticated to Jellyfin');
                return [];
            }
            const response = await this.client.get('/Items', {
                params: {
                    ...this.getRequestParams(),
                    userId: this.userId,
                    includeItemTypes: 'CollectionFolder',
                    sortBy: 'SortName',
                    sortOrder: 'Ascending',
                },
            });
            if (response.status === 200) {
                return response.data.Items || [];
            }
            return [];
        }
        catch (error) {
            logger.error('Failed to get Jellyfin libraries:', error);
            return [];
        }
    }
    async getLibraryItems(parentId, limit = 20) {
        try {
            if (!this.userId) {
                await this.authenticate();
            }
            if (!this.userId) {
                logger.error('Not authenticated to Jellyfin');
                return [];
            }
            const response = await this.client.get('/Items', {
                params: {
                    ...this.getRequestParams(),
                    userId: this.userId,
                    parentId: parentId,
                    limit: limit,
                    includeItemTypes: 'Movie,Episode,Video,Series',
                    fields: 'Overview,ImageTags',
                    sortBy: 'SortName',
                    sortOrder: 'Ascending',
                },
            });
            if (response.status === 200) {
                return response.data.Items || [];
            }
            return [];
        }
        catch (error) {
            logger.error('Failed to get Jellyfin library items:', error);
            return [];
        }
    }
    isConfigured() {
        return !!(config.jellyfinServerUrl && (config.jellyfinApiKey || (config.jellyfinUsername && config.jellyfinPassword)));
    }
    getServerUrl() {
        return config.jellyfinServerUrl;
    }
    async getMediaInfo(itemId) {
        try {
            if (!this.userId) {
                await this.authenticate();
            }
            if (!this.userId) {
                logger.error('Not authenticated to Jellyfin');
                return null;
            }
            const response = await this.client.post('/Items/' + itemId + '/PlaybackInfo', {
                UserId: this.userId,
                IsPlayback: true,
                AutoOpenLiveStream: true,
            }, {
                params: this.getRequestParams()
            });
            if (response.status === 200 && response.data.MediaSources && response.data.MediaSources.length > 0) {
                const mediaSource = response.data.MediaSources[0];
                const streams = mediaSource.MediaStreams || [];
                const itemResponse = await this.client.get(`/Items/${itemId}`, {
                    params: {
                        ...this.getRequestParams(),
                        userId: this.userId,
                    },
                });
                return {
                    Id: itemId,
                    Name: itemResponse.data?.Name || 'Unknown',
                    VideoStreams: streams.filter(s => s.Type === 'Video'),
                    AudioStreams: streams.filter(s => s.Type === 'Audio'),
                    SubtitleStreams: streams.filter(s => s.Type === 'Subtitle'),
                };
            }
            return null;
        }
        catch (error) {
            logger.error('Failed to get Jellyfin media info:', error);
            return null;
        }
    }
}
export default new Jellyfin();
//# sourceMappingURL=jellyfin.js.map