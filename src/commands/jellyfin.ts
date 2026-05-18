import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
import { MediaService } from "../services/media.js";
import { ErrorUtils, DiscordUtils } from '../utils/shared.js';
import jellyfin from '../utils/jellyfin.js';
import logger from '../utils/logger.js';

export default class JellyfinCommand extends BaseCommand {
	name = "jellyfin";
	description = "Search and play media from your Jellyfin server";
	usage = "jellyfin <search_query>";
	aliases = ["jf"];

	private mediaService: MediaService;
	// Store last search results globally for the session
	private static lastSearchResults: Map<string, any[]> = new Map();

	constructor() {
		super();
		this.mediaService = new MediaService();
	}

	async execute(context: CommandContext): Promise<void> {
		if (!context.args.length) {
			await this.showHelp(context);
			return;
		}

		// Check if Jellyfin is configured
		if (!jellyfin.isConfigured()) {
			await this.sendError(context.message, 'Jellyfin server is not configured. Please set `JELLYFIN_SERVER_URL` and either `JELLYFIN_API_KEY` or `JELLYFIN_USERNAME`/`JELLYFIN_PASSWORD` in your .env file.');
			return;
		}

		// Ensure authenticated
		const authenticated = await jellyfin.authenticate();
		if (!authenticated) {
			await this.sendError(context.message, 'Failed to authenticate with Jellyfin server. Check your credentials.');
			return;
		}

		const command = context.args[0].toLowerCase();

		switch (command) {
			case 'search':
				await this.handleSearch(context);
				break;
			case 'play':
				await this.handlePlay(context);
				break;
			case 'list':
			case 'libraries':
				await this.handleListLibraries(context);
				break;
			case 'help':
				await this.showHelp(context);
				break;
			default:
				// Treat as search query
				await this.handleSearch(context);
				break;
		}
	}

	private async handleSearch(context: CommandContext): Promise<void> {
		const searchArgs = context.args[0].toLowerCase() === 'search' 
			? context.args.slice(1) 
			: context.args;
		
		const query = searchArgs.join(' ').trim();

		if (!query) {
			await this.sendError(context.message, 'Please provide a search query. Usage: `jellyfin search <query>`');
			return;
		}

		try {
			const msg = await context.message.reply(`🔍 Searching Jellyfin for: \`${query}\`...`);

			const results = await this.mediaService.searchJellyfin(query, 10);

			if (results.length === 0) {
				await msg.edit(`❌ No results found for: \`${query}\``);
				return;
			}

			// Store results for later reference
			const userId = context.message.author.id;
			JellyfinCommand.lastSearchResults.set(userId, results);

			// Format results
			const resultsList = results
				.slice(0, 10)
				.map((result, index) => `\`${index + 1}\` **${result.name}** (${result.type})`)
				.join('\n');

			const response = `Found ${results.length} result(s):\n\n${resultsList}\n\nUse \`jellyfin play <number>\` to play (e.g., \`jellyfin play 1\`)`;
			
			await msg.edit(response);
			logger.info(`Jellyfin search "${query}" returned ${results.length} results`);
		} catch (error) {
			await ErrorUtils.handleError(error, 'searching Jellyfin', context.message);
		}
	}

	private async handlePlay(context: CommandContext): Promise<void> {
		const args = context.args.slice(1);

		if (!args.length) {
			await this.sendError(context.message, 'Please provide an item number or search query. Usage: `jellyfin play <number>` or `jellyfin play <query>`');
			return;
		}

		try {
			const userId = context.message.author.id;
			const lastResults = JellyfinCommand.lastSearchResults.get(userId);

			// Check if first arg is a number (from previous search results)
			const itemIndex = parseInt(args[0]) - 1;

			if (!isNaN(itemIndex) && lastResults && itemIndex >= 0 && itemIndex < lastResults.length) {
				// Play from last search results
				const item = lastResults[itemIndex];
				const msg = await context.message.reply(`▶️ Playing from Jellyfin: \`${item.name}\`...`);

				const success = await context.streamingService.addToQueue(context.message, item.url, item.name);
				
				if (success) {
					await msg.edit(`✅ Added to queue: \`${item.name}\``);
					// If not currently playing, start playing from queue
					if (!context.streamStatus.playing) {
						await context.streamingService.playFromQueue(context.message);
					}
				}
			} else {
				// Treat as new search query
				const query = args.join(' ');
				const msg = await context.message.reply(`🔍 Searching Jellyfin for: \`${query}\`...`);

				const results = await this.mediaService.searchJellyfin(query, 5);

				if (results.length === 0) {
					await msg.edit(`❌ No results found for: \`${query}\``);
					return;
				}

				// Play the first result
				const item = results[0];
				const success = await context.streamingService.addToQueue(context.message, item.url, item.name);
				
				if (success) {
					await msg.edit(`✅ Playing from Jellyfin: \`${item.name}\``);
					// If not currently playing, start playing from queue
					if (!context.streamStatus.playing) {
						await context.streamingService.playFromQueue(context.message);
					}
				}

				// Store results for future reference
				JellyfinCommand.lastSearchResults.set(userId, results);
			}
		} catch (error) {
			await ErrorUtils.handleError(error, 'playing Jellyfin media', context.message);
		}
	}

	private async handleListLibraries(context: CommandContext): Promise<void> {
		try {
			const msg = await context.message.reply(`📚 Fetching Jellyfin libraries...`);

			const libraries = await jellyfin.getLibraries();

			if (libraries.length === 0) {
				await msg.edit(`No libraries found on Jellyfin server`);
				return;
			}

			const libList = libraries
				.map((lib) => `• **${lib.Name}** (${lib.Type})`)
				.join('\n');

			await msg.edit(`📚 **Jellyfin Libraries**:\n\n${libList}`);
		} catch (error) {
			await ErrorUtils.handleError(error, 'listing Jellyfin libraries', context.message);
		}
	}

	private async showHelp(context: CommandContext): Promise<void> {
		const helpText = `
📺 **Jellyfin Commands**

\`jellyfin search <query>\` - Search for media
\`jellyfin <query>\` - Quick search (same as search)
\`jellyfin play <number>\` - Play item from last search results
\`jellyfin play <query>\` - Search and play the first result
\`jellyfin list\` - List all Jellyfin libraries
\`jellyfin help\` - Show this help message

**Examples:**
• \`jellyfin search movie\` - Search for "movie"
\`jellyfin play 1\` - Play result #1 from last search
• \`jellyfin play action movies\` - Search and auto-play first result`;

		await context.message.reply(helpText);
	}
}
