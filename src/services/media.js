import { getStream, getVod } from 'twitch-m3u8';
import config from "../config.js";
import logger from '../utils/logger.js';
import { Youtube } from '../utils/youtube.js';
import ytdl, { downloadToTempFile } from '../utils/yt-dlp.js';
import { GeneralUtils } from '../utils/shared.js';
import jellyfin from '../utils/jellyfin.js';
import path from 'path';
export class MediaService {
    youtube;
    constructor() {
        this.youtube = new Youtube();
    }
    async resolveMediaSource(url, audioIndex, subtitleIndex, seekTimeMs) {
        try {
            if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
                return await this._resolveYouTubeSource(url);
            }
            else if (url.includes('twitch.tv/')) {
                return await this._resolveTwitchSource(url);
            }
            else if (config.jellyfinServerUrl && (url.includes(config.jellyfinServerUrl) || url.includes('/web/index.html'))) {
                logger.info(`Detected Jellyfin URL: ${url.substring(0, 100)}`);
                const resolved = await this._resolveJellyfinSource(url, audioIndex, subtitleIndex, seekTimeMs);
                if (resolved) {
                    logger.info(`Successfully resolved Jellyfin source to stream URL`);
                    return resolved;
                }
                else {
                    logger.warn(`Failed to resolve Jellyfin source, falling back to direct URL`);
                }
            }
            else if (GeneralUtils.isLocalFile(url)) {
                return this._resolveLocalSource(url);
            }
            else if (GeneralUtils.isValidUrl(url)) {
                return this._resolveDirectUrlSource(url);
            }
            else {
                return this.searchAndPlayYouTube(url);
            }
            return null;
        }
        catch (error) {
            logger.error("Failed to resolve media source:", error);
            return null;
        }
    }
    async _resolveYouTubeSource(url) {
        const videoDetails = await this.youtube.getVideoInfo(url);
        if (!videoDetails)
            return null;
        const isLive = videoDetails.videoDetails?.isLiveContent || false;
        const streamUrl = isLive ? await this.youtube.getLiveStreamUrl(url) : url;
        if (streamUrl) {
            return {
                url: streamUrl,
                title: videoDetails.title,
                type: 'youtube',
                isLive: isLive,
            };
        }
        return null;
    }
    async getTwitchStreamUrl(url) {
        try {
            if (url.includes('/videos/')) {
                const vodId = url.split('/videos/').pop();
                const vodInfo = await getVod(vodId);
                const vod = vodInfo.find((stream) => stream.resolution === `${config.width}x${config.height}`) || vodInfo[0];
                if (vod?.url) {
                    return vod.url;
                }
                logger.error("No VOD URL found");
                return null;
            }
            else {
                const twitchId = url.split('/').pop();
                const streams = await getStream(twitchId);
                const stream = streams.find((stream) => stream.resolution === `${config.width}x${config.height}`) || streams[0];
                if (stream?.url) {
                    return stream.url;
                }
                logger.error("No Stream URL found");
                return null;
            }
        }
        catch (error) {
            logger.error("Failed to get Twitch stream URL:", error);
            return null;
        }
    }
    async downloadYouTubeVideo(url) {
        try {
            const ytDlpDownloadOptions = {
                format: `bestvideo[height<=${config.height || 720}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${config.height || 720}]+bestaudio/best[height<=${config.height || 720}]/best`,
                noPlaylist: true,
            };
            const tempFilePath = await downloadToTempFile(url, ytDlpDownloadOptions);
            return tempFilePath;
        }
        catch (error) {
            logger.error("Failed to download YouTube video:", error);
            return null;
        }
    }
    async _resolveTwitchSource(url) {
        const streamUrl = await this.getTwitchStreamUrl(url);
        if (streamUrl) {
            const twitchId = url.split('/').pop();
            return {
                url: streamUrl,
                title: `twitch.tv/${twitchId}`,
                type: 'twitch'
            };
        }
        return null;
    }
    async _resolveJellyfinSource(url, audioIndex, subtitleIndex, seekTimeMs) {
        try {
            let itemId = null;
            if (url.includes('id=')) {
                const idMatch = url.match(/id=([a-f0-9]+)/i);
                itemId = idMatch ? idMatch[1] : null;
            }
            else if (url.includes('/Videos/')) {
                const idMatch = url.match(/\/Videos\/([a-f0-9]+)/i);
                itemId = idMatch ? idMatch[1] : null;
            }
            if (!itemId) {
                logger.error('Could not extract Jellyfin item ID from URL:', url);
                return null;
            }
            const item = await jellyfin.getItemDetails(itemId);
            if (!item)
                return null;
            const streamUrl = await jellyfin.getStreamUrl(itemId, audioIndex, subtitleIndex, seekTimeMs);
            if (!streamUrl)
                return null;
            return {
                url: streamUrl,
                title: item.Name,
                type: 'jellyfin',
                sourceId: itemId
            };
        }
        catch (error) {
            logger.error('Failed to resolve Jellyfin source:', error);
            return null;
        }
    }
    _resolveLocalSource(url) {
        return {
            url,
            title: path.basename(url, path.extname(url)),
            type: 'local'
        };
    }
    async _resolveDirectUrlSource(url) {
        try {
            const metadata = await ytdl(url, {
                dumpJson: true,
                skipDownload: true,
                noWarnings: true,
                quiet: true
            });
            if (metadata && metadata.title) {
                let streamUrl = url;
                if (metadata.formats && Array.isArray(metadata.formats) && metadata.formats.length > 0) {
                    const bestFormat = metadata.formats
                        .filter((format) => format.url && format.ext !== 'm3u8')
                        .sort((a, b) => {
                        const aScore = (a.vcodec && a.vcodec !== 'none' ? 1 : 0) + (a.acodec && a.acodec !== 'none' ? 1 : 0) + (a.height || 0) / 1000;
                        const bScore = (b.vcodec && b.vcodec !== 'none' ? 1 : 0) + (b.acodec && b.acodec !== 'none' ? 1 : 0) + (b.height || 0) / 1000;
                        return bScore - aScore;
                    })[0];
                    if (bestFormat && bestFormat.url) {
                        streamUrl = bestFormat.url;
                    }
                }
                return {
                    url: streamUrl,
                    title: metadata.title,
                    type: 'url'
                };
            }
        }
        catch (error) {
            logger.debug("yt-dlp failed to extract metadata for URL:", url, error);
        }
        let title = "Direct URL";
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            if (filename && filename.includes('.')) {
                title = decodeURIComponent(filename.replace(/\.[^/.]+$/, ""));
            }
            else if (pathname !== '/' && pathname.length > 1) {
                const pathSegment = pathname.split('/').pop();
                if (pathSegment) {
                    title = decodeURIComponent(pathSegment);
                }
            }
        }
        catch (e) {
            logger.debug("Could not parse URL for title extraction:", url);
        }
        return {
            url,
            title,
            type: 'url'
        };
    }
    async searchYouTube(query, limit = 5) {
        try {
            return await this.youtube.search(query, limit);
        }
        catch (error) {
            logger.error("Failed to search YouTube:", error);
            return [];
        }
    }
    async searchAndPlayYouTube(query) {
        try {
            const searchResult = await this.youtube.searchAndGetPageUrl(query);
            if (searchResult.pageUrl && searchResult.title) {
                return {
                    url: searchResult.pageUrl,
                    title: searchResult.title,
                    type: 'youtube'
                };
            }
            return null;
        }
        catch (error) {
            logger.error("Failed to search and play YouTube:", error);
            return null;
        }
    }
    async searchJellyfin(query, limit = 10) {
        try {
            if (!jellyfin.isConfigured()) {
                logger.warn('Jellyfin is not configured');
                return [];
            }
            const items = await jellyfin.searchItems(query, limit);
            const playableTypes = ['Movie', 'Episode', 'Audio', 'MusicVideo', 'Video'];
            const playableItems = items.filter(item => playableTypes.includes(item.Type));
            if (playableItems.length === 0) {
                logger.warn(`No playable items found in Jellyfin search for "${query}". Found ${items.length} total items but none were playable types.`);
            }
            return playableItems.map(item => ({
                id: item.Id,
                name: item.Name,
                type: item.Type,
                url: `${jellyfin.getServerUrl()}/web/index.html#!/details?id=${item.Id}`
            }));
        }
        catch (error) {
            logger.error("Failed to search Jellyfin:", error);
            return [];
        }
    }
}
//# sourceMappingURL=media.js.map