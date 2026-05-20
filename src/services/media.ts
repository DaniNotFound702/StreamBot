import { getStream, getVod } from 'twitch-m3u8';
import { TwitchStream, MediaSource } from '../types/index.js';
import config from "../config.js";
import logger from '../utils/logger.js';
import { Youtube } from '../utils/youtube.js';
import ytdl, { downloadToTempFile } from '../utils/yt-dlp.js';
import { GeneralUtils } from '../utils/shared.js';
import { YTResponse } from '../types/index.js';
import jellyfin from '../utils/jellyfin.js';
import path from 'path';

export class MediaService {
	private youtube: Youtube;

	constructor() {
		this.youtube = new Youtube();
	}

	public async resolveMediaSource(url: string, audioIndex?: number | null, subtitleIndex?: number | null, seekTimeMs?: number): Promise<MediaSource | null> {
		try {
			if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
				return await this._resolveYouTubeSource(url);
			} else if (url.includes('twitch.tv/')) {
				return await this._resolveTwitchSource(url);
			} else if (config.jellyfinServerUrl && (url.includes(config.jellyfinServerUrl) || url.includes('/web/index.html'))) {
				logger.info(`Detected Jellyfin URL: ${url.substring(0, 100)}`);
				// Geef tracks en tijd door aan Jellyfin
				const resolved = await this._resolveJellyfinSource(url, audioIndex, subtitleIndex, seekTimeMs);
				if (resolved) {
					logger.info(`Successfully resolved Jellyfin source to stream URL`);
					return resolved;
				} else {
					logger.warn(`Failed to resolve Jellyfin source, falling back to direct URL`);
				}
			} else if (GeneralUtils.isLocalFile(url)) {
				return this._resolveLocalSource(url);
			} else if (GeneralUtils.isValidUrl(url)) {
				return this._resolveDirectUrlSource(url);
			} else {
				return this.searchAndPlayYouTube(url);
			}

			return null;
		} catch (error) {
			logger.error("Failed to resolve media source:", error);
			return null;
		}
	}

	private async _resolveYouTubeSource(url: string): Promise<MediaSource | null> {
		const videoDetails = await this.youtube.getVideoInfo(url);
		if (!videoDetails) return null;

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

	public async getTwitchStreamUrl(url: string): Promise<string | null> {
		try {
			// Handle VODs
			if (url.includes('/videos/')) {
				const vodId = url.split('/videos/').pop() as string;
				const vodInfo = await getVod(vodId);
				const vod = vodInfo.find((stream: TwitchStream) => stream.resolution === `${config.width}x${config.height}`) || vodInfo[0];
				if (vod?.url) {
					return vod.url;
				}
				logger.error("No VOD URL found");
				return null;
			} else {
				const twitchId = url.split('/').pop() as string;
				const streams = await getStream(twitchId);
				const stream = streams.find((stream: TwitchStream) => stream.resolution === `${config.width}x${config.height}`) || streams[0];
				if (stream?.url) {
					return stream.url;
				}
				logger.error("No Stream URL found");
				return null;
			}
		} catch (error) {
			logger.error("Failed to get Twitch stream URL:", error);
			return null;
		}
	}

	public async downloadYouTubeVideo(url: string): Promise<string | null> {
		try {
			const ytDlpDownloadOptions = {
				format: `bestvideo[height<=${config.height || 720}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${config.height || 720}]+bestaudio/best[height<=${config.height || 720}]/best`,
				noPlaylist: true,
			};

			const tempFilePath = await downloadToTempFile(url, ytDlpDownloadOptions);
			return tempFilePath;
		} catch (error) {
			logger.error("Failed to download YouTube video:", error);
			return null;
		}
	
	}

	private async _resolveTwitchSource(url: string): Promise<MediaSource | null> {
		const streamUrl = await this.getTwitchStreamUrl(url);
		if (streamUrl) {
			const twitchId = url.split('/').pop() as string;
			return {
				url: streamUrl,
				title: `twitch.tv/${twitchId}`,
				type: 'twitch'
			};
		}
		return null;
	}

	private async _resolveJellyfinSource(url: string, audioIndex?: number | null, subtitleIndex?: number | null, seekTimeMs?: number): Promise<MediaSource | null> {
		try {
			let itemId: string | null = null;

			if (url.includes('id=')) {
				const idMatch = url.match(/id=([a-f0-9]+)/i);
				itemId = idMatch ? idMatch[1] : null;
			} else if (url.includes('/Videos/')) {
				const idMatch = url.match(/\/Videos\/([a-f0-9]+)/i);
				itemId = idMatch ? idMatch[1] : null;
			}

			if (!itemId) {
				logger.error('Could not extract Jellyfin item ID from URL:', url);
				return null;
			}

			const item = await jellyfin.getItemDetails(itemId);
			if (!item) return null;

			// Vraag de speciale transcoder URL op mét de ingestelde sporen en tijd
			const streamUrl = await jellyfin.getStreamUrl(itemId, audioIndex, subtitleIndex, seekTimeMs);
			if (!streamUrl) return null;

			return {
				url: streamUrl,
				title: item.Name,
				type: 'jellyfin',
				sourceId: itemId
			};
		} catch (error) {
			logger.error('Failed to resolve Jellyfin source:', error);
			return null;
		}
	}

	private _resolveLocalSource(url: string): MediaSource {
		return {
			url,
			title: path.basename(url, path.extname(url)),
			type: 'local'
		};
	}

	private async _resolveDirectUrlSource(url: string): Promise<MediaSource> {
		// First try to get metadata using yt-dlp
		try {
			const metadata = await ytdl(url, {
				dumpJson: true,
				skipDownload: true,
				noWarnings: true,
				quiet: true
			}) as YTResponse;

			// If yt-dlp succeeds, use the extracted metadata
			if (metadata && metadata.title) {
				// Get the best available format URL
				let streamUrl = url;
				if (metadata.formats && Array.isArray(metadata.formats) && metadata.formats.length > 0) {
					// Find the format with both audio and video, preferring higher quality
					const bestFormat = metadata.formats
						.filter((format) => format.url && format.ext !== 'm3u8') // Avoid HLS streams
						.sort((a, b) => {
							// Prefer formats with both audio and video
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
		} catch (error) {
			// yt-dlp failed, log debug info and continue to fallback
			logger.debug("yt-dlp failed to extract metadata for URL:", url, error);
		}

		// Fallback to original URL parsing logic
		let title = "Direct URL";
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;
			const filename = pathname.split('/').pop();

			if (filename && filename.includes('.')) {
				title = decodeURIComponent(filename.replace(/\.[^/.]+$/, ""));
			} else if (pathname !== '/' && pathname.length > 1) {
				const pathSegment = pathname.split('/').pop();
				if (pathSegment) {
					title = decodeURIComponent(pathSegment);
				}
			}
		} catch (e) {
			logger.debug("Could not parse URL for title extraction:", url);
		}

		return {
			url,
			title,
			type: 'url'
		};
	}

	public async searchYouTube(query: string, limit: number = 5): Promise<string[]> {
		try {
			return await this.youtube.search(query, limit);
		} catch (error) {
			logger.error("Failed to search YouTube:", error);
			return [];
		}
	}

	public async searchAndPlayYouTube(query: string): Promise<MediaSource | null> {
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
		} catch (error) {
			logger.error("Failed to search and play YouTube:", error);
			return null;
		}
	}

	public async searchJellyfin(query: string, limit: number = 10): Promise<Array<{ id: string; name: string; type: string; url?: string }>> {
		try {
			if (!jellyfin.isConfigured()) {
				logger.warn('Jellyfin is not configured');
				return [];
			}

			const items = await jellyfin.searchItems(query, limit);
			
			// Filter to only include playable types
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
		} catch (error) {
			logger.error("Failed to search Jellyfin:", error);
			return [];
		}
	}
}