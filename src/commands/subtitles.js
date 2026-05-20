import { BaseCommand } from "./base.js";
import jellyfin from "../utils/jellyfin.js";
import logger from "../utils/logger.js";
import { streamSelectionService } from "../services/streamSelection.js";
export default class SubtitlesCommand extends BaseCommand {
    name = "subtitles";
    description = "Manage subtitles for current Jellyfin video";
    usage = "subtitles [number|off]";
    aliases = ["subs"];
    async execute(context) {
        const currentItem = context.streamingService.getQueueService().getCurrent();
        if (!currentItem) {
            await this.sendError(context.message, 'No video in queue.');
            return;
        }
        if (currentItem.type !== 'jellyfin' || !currentItem.sourceId) {
            await this.sendError(context.message, 'This command only works with Jellyfin videos. Use `$jellyfin` to play from Jellyfin.');
            return;
        }
        const userId = context.message.author.id;
        const jellyfinItemId = currentItem.sourceId;
        const mediaInfo = await jellyfin.getMediaInfo(jellyfinItemId);
        if (!mediaInfo) {
            await this.sendError(context.message, 'Could not fetch subtitle information.');
            return;
        }
        const args = context.args[0];
        if (!args) {
            if (mediaInfo.SubtitleStreams.length === 0) {
                await this.sendSuccess(context.message, '📝 No subtitles available for this video.');
                return;
            }
            let subtitleList = '📝 **Available Subtitles**:\n\n';
            mediaInfo.SubtitleStreams.forEach((subtitle, idx) => {
                const language = subtitle.Language || 'Unknown';
                const codec = subtitle.Codec || '';
                const isDefault = subtitle.IsDefault ? '✓ (default)' : '';
                const title = subtitle.DisplayTitle || language;
                subtitleList += `${idx + 1}. ${title} [${codec}] ${isDefault}\n`;
            });
            const currentSubtitle = streamSelectionService.getSubtitle(userId, jellyfinItemId);
            if (currentSubtitle !== undefined) {
                if (currentSubtitle === null) {
                    subtitleList += `\n**Currently:** Disabled`;
                }
                else {
                    const current = mediaInfo.SubtitleStreams.find((subtitle) => subtitle.Index === currentSubtitle) || mediaInfo.SubtitleStreams[currentSubtitle];
                    subtitleList += `\n**Currently:** ${current?.DisplayTitle || current?.Language || 'Unknown'}`;
                }
            }
            subtitleList += `\n\nUse: \`$subtitles <number>\` to select, or \`$subtitles off\` to disable`;
            await this.sendInfo(context.message, '📝 Subtitles', subtitleList);
        }
        else if (args.toLowerCase() === 'off') {
            streamSelectionService.setSubtitle(userId, jellyfinItemId, null);
            await this.sendSuccess(context.message, `✓ Subtitles disabled`);
            logger.info(`User ${userId} disabled subtitles for ${currentItem.title}`);
            await context.streamingService.switchTracksDynamic(context.message);
        }
        else {
            const idx = parseInt(args, 10) - 1;
            if (isNaN(idx) || idx < 0 || idx >= mediaInfo.SubtitleStreams.length) {
                await this.sendError(context.message, `Invalid subtitle number. Choose 1-${mediaInfo.SubtitleStreams.length} or use 'off'`);
                return;
            }
            const selected = mediaInfo.SubtitleStreams[idx];
            const language = selected.Language || 'Unknown';
            const subtitleStreamIndex = selected.Index ?? idx;
            streamSelectionService.setSubtitle(userId, jellyfinItemId, subtitleStreamIndex);
            await this.sendSuccess(context.message, `✓ Selected subtitle: ${language}`);
            logger.info(`User ${userId} selected subtitle ${subtitleStreamIndex} (${language}) for ${currentItem.title}`);
            await context.streamingService.switchTracksDynamic(context.message);
        }
    }
}
//# sourceMappingURL=subtitles.js.map