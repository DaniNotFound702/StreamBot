import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
import { MediaService } from "../services/media.js";
import fs from 'fs';
import path from 'path';
import config from '../config.js';

export default class SearchCommand extends BaseCommand {
	name = "search";
	description = "Search across all sources (local, YouTube, Jellyfin)";
	usage = "search [source] <query>";
	aliases = ["s"];

	private mediaService: MediaService;

	constructor() {
		super();
		this.mediaService = new MediaService();
	}

	async execute(context: CommandContext): Promise<void> {
		if (context.args.length === 0) {
			await this.sendError(context.message, 'Usage: `$search [source] <query>` - source: local, yt, jellyfin, or omit for all');
			return;
		}

		let source = 'all';
		let query = context.args.join(' ');

		// Check if first arg is a source specifier
		const firstArg = context.args[0].toLowerCase();
		if (['local', 'yt', 'youtube', 'jellyfin', 'jf'].includes(firstArg)) {
			source = firstArg;
			query = context.args.slice(1).join(' ');
		}

		if (!query) {
			await this.sendError(context.message, 'Please provide a search query.');
			return;
		}

		try {
			const results: any[] = [];

			// Search local files
			if (source === 'all' || source === 'local') {
				const localResults = await this.searchLocal(query, context);
				results.push(...localResults.map(v => ({
					type: 'local',
					title: v.name,
					url: v.path,
					description: 'Local File'
				})));
			}

			// Search YouTube
			if (source === 'all' || source === 'yt' || source === 'youtube') {
				try {
					const ytResults = await this.mediaService.searchYouTube(query);
					results.push(...ytResults.slice(0, 3).map((r: any) => ({
						type: 'youtube',
						title: r.title,
						url: r.url,
						description: `YouTube - Duration: ${r.duration || 'N/A'}`
					})));
				} catch (e) {
					// YouTube search failed, continue with other sources
				}
			}

			// Search Jellyfin
			if ((source === 'all' || source === 'jellyfin' || source === 'jf') && config.jellyfinServerUrl) {
				try {
					const jfResults = await this.mediaService.searchJellyfin(query, 3);
					results.push(...jfResults.map((r: any) => ({
						type: 'jellyfin',
						title: r.name,
						url: `${config.jellyfinServerUrl}/web/index.html#!/details?id=${r.Id}`,
						description: `Jellyfin - Type: ${r.Type}`
					})));
				} catch (e) {
					// Jellyfin search failed, continue
				}
			}

			if (results.length === 0) {
				await this.sendError(context.message, 'No results found.');
				return;
			}

			// Format and send results
			let resultText = `🔍 Found ${results.length} results:\n\n`;
			results.slice(0, 10).forEach((result, index) => {
				const icon = result.type === 'local' ? '💾' : result.type === 'youtube' ? '▶️' : result.type === 'jellyfin' ? '📺' : '📄';
				resultText += `${index + 1}. ${icon} **${result.title}**\n   ${result.description}\n`;
			});

			await this.sendInfo(context.message, '🔍 Search Results', resultText);
		} catch (error) {
			await this.sendError(context.message, 'Search failed. Please try again.');
		}
	}

	private async searchLocal(query: string, context: CommandContext): Promise<any[]> {
		try {
			const videoFiles = fs.readdirSync(config.videosDir);
			const queryLower = query.toLowerCase();

			return videoFiles
				.filter(file => !file.startsWith('.') && file.toLowerCase().includes(queryLower))
				.slice(0, 3)
				.map(file => ({
					name: path.parse(file).name,
					path: path.join(config.videosDir, file)
				}));
		} catch (e) {
			return [];
		}
	}
}
