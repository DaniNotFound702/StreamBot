import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
import jellyfin from "../utils/jellyfin.js";
import logger from "../utils/logger.js";
import { streamSelectionService } from "../services/streamSelection.js";

export default class AudioCommand extends BaseCommand {
	name = "audio";
	description = "Manage audio tracks for current Jellyfin video";
	usage = "audio [number]";
	aliases = ["dubs", "track"];

	async execute(context: CommandContext): Promise<void> {
		const currentItem = context.streamingService.getQueueService().getCurrent();
		if (!currentItem) {
			await this.sendError(context.message, 'No video in queue.');
			return;
		}

		// Check if this is a Jellyfin item
		if (currentItem.type !== 'jellyfin' || !currentItem.sourceId) {
			await this.sendError(context.message, 'This command only works with Jellyfin videos. Use `$jellyfin` to play from Jellyfin.');
			return;
		}

		const userId = context.message.author.id;
		const jellyfinItemId = currentItem.sourceId;

		// Get media info
		const mediaInfo = await jellyfin.getMediaInfo(jellyfinItemId);
		if (!mediaInfo) {
			await this.sendError(context.message, 'Could not fetch audio track information.');
			return;
		}

		const audioIndex = context.args[0];

		if (!audioIndex) {
			// List audio tracks
			if (mediaInfo.AudioStreams.length === 0) {
				await this.sendSuccess(context.message, '🔊 No audio tracks available for this video.');
				return;
			}

			let audioList = '🔊 **Available Audio Tracks**:\n\n';
			mediaInfo.AudioStreams.forEach((audio, idx) => {
				const language = audio.Language || 'Unknown';
				const codec = audio.Codec || '';
				const isDefault = audio.IsDefault ? '✓ (default)' : '';
				const title = audio.DisplayTitle || language;
				audioList += `${idx + 1}. ${title} [${codec}] ${isDefault}\n`;
			});

			const currentAudio = streamSelectionService.getAudio(userId, jellyfinItemId);
			if (currentAudio !== undefined) {
				const current = mediaInfo.AudioStreams[currentAudio];
				audioList += `\n**Currently:** ${current?.DisplayTitle || current?.Language || 'Unknown'}`;
			}

			audioList += `\n\nUse: \`$audio <number>\` to select`;

			await this.sendInfo(context.message, '🔊 Audio Tracks', audioList);
		} else {
			// Select audio track
			const idx = parseInt(audioIndex, 10) - 1;
			if (isNaN(idx) || idx < 0 || idx >= mediaInfo.AudioStreams.length) {
				await this.sendError(context.message, `Invalid audio track number. Choose 1-${mediaInfo.AudioStreams.length}`);
				return;
			}

			const selected = mediaInfo.AudioStreams[idx];
			const language = selected.Language || 'Unknown';
			streamSelectionService.setAudio(userId, jellyfinItemId, idx);

			await this.sendSuccess(context.message, `✓ Selected audio track: ${language}`);
			logger.info(`User ${userId} selected audio track ${idx} (${language}) for ${currentItem.title}`);
		}
	}
}
