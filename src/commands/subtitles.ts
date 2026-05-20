import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
import jellyfin from "../utils/jellyfin.js";
import logger from "../utils/logger.js";
import { streamSelectionService } from "../services/streamSelection.js";

export default class SubtitlesCommand extends BaseCommand {
  name = "subtitles";
  description = "Manage subtitles for current Jellyfin video";
  usage = "subtitles [number|off]";
  aliases = ["subs"];

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
      await this.sendError(context.message, 'Could not fetch subtitle information.');
      return;
    }

    const args = context.args[0];

    if (!args) {
      // List subtitles
      if (mediaInfo.SubtitleStreams.length === 0) {
        await this.sendSuccess(context.message, '📝 No subtitles available for this video.');
        return;
      }

      let subtitleList = '📝 **Available Subtitles**:\n\n';
      const indexedSubtitleStreams = mediaInfo.SubtitleStreams.map((subtitle, rawIndex) => ({
        ...subtitle,
        rawPosition: rawIndex,
      }));

      indexedSubtitleStreams.forEach((subtitle, idx) => {
        const language = subtitle.Language || 'Unknown';
        const codec = subtitle.Codec || '';
        const isDefault = subtitle.IsDefault ? '✓ (default)' : '';
        const title = subtitle.DisplayTitle || language;
        const streamIndexNote = subtitle.Index !== undefined && subtitle.Index !== null && subtitle.Index !== subtitle.rawPosition
          ? ` (stream ${subtitle.Index})`
          : '';
        subtitleList += `${idx + 1}. ${title} [${codec}] (${language})${streamIndexNote} ${isDefault}\n`;
      });

      const currentSubtitle = streamSelectionService.getSubtitle(userId, jellyfinItemId);
      const currentSubtitlePosition = streamSelectionService.getSubtitlePosition(userId, jellyfinItemId);
      if (currentSubtitle !== undefined) {
        if (currentSubtitle === null) {
          subtitleList += `\n**Currently:** Disabled`;
        } else {
          const current = mediaInfo.SubtitleStreams.find((subtitle) => subtitle.Index === currentSubtitle) || mediaInfo.SubtitleStreams[currentSubtitlePosition ?? currentSubtitle];
          subtitleList += `\n**Currently:** ${current?.DisplayTitle || current?.Language || 'Unknown'}`;
        }
      }

      subtitleList += `\n\nUse: \`$subtitles <number>\` to select, or \`$subtitles off\` to disable`;

      await this.sendInfo(context.message, '📝 Subtitles', subtitleList);
    } else if (args.toLowerCase() === 'off') {
      // Disable subtitles
      streamSelectionService.setSubtitle(userId, jellyfinItemId, null);
      await this.sendSuccess(context.message, `✓ Subtitles disabled`);
      logger.info(`User ${userId} disabled subtitles for ${currentItem.title}`);

      // === LIVE DE STREAM UPDATEN EN HERVATTEN ZONDER SUBS ===
      await context.streamingService.switchTracksDynamic(context.message);
    } else {
      // Select subtitle
      const idx = parseInt(args, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= mediaInfo.SubtitleStreams.length) {
        await this.sendError(context.message, `Invalid subtitle number. Choose 1-${mediaInfo.SubtitleStreams.length} or use 'off'`);
        return;
      }

      const indexedSubtitleStreams = mediaInfo.SubtitleStreams.map((subtitle, rawIndex) => ({
        ...subtitle,
        rawPosition: rawIndex,
      }));

      const selected = indexedSubtitleStreams[idx];
      const language = selected.Language || 'Unknown';
      const streamIndexToUse = selected.Index !== undefined && selected.Index !== null ? selected.Index : selected.rawPosition;
      streamSelectionService.setSubtitle(userId, jellyfinItemId, streamIndexToUse, selected.rawPosition);

      await this.sendSuccess(context.message, `✓ Selected subtitle: ${language}`);
      logger.info(`User ${userId} selected subtitle list item ${idx} (stream index ${streamIndexToUse}) (${language}) for ${currentItem.title}`);

      // === LIVE DE STREAM UPDATEN EN HERVATTEN MET DE NIEUWE SUBS ===
      await context.streamingService.switchTracksDynamic(context.message);
    }
  }
}
