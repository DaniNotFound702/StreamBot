import { BaseCommand } from "./base.js";
import { MediaService } from "../services/media.js";
import { ErrorUtils, GeneralUtils } from '../utils/shared.js';
import fs from 'fs';
import path from 'path';
import config from "../config.js";
export default class PlayCommand extends BaseCommand {
    name = "play";
    description = "Play local video, URL, or search YouTube videos";
    usage = "play <video_name|url|search_query>";
    mediaService;
    constructor() {
        super();
        this.mediaService = new MediaService();
    }
    async execute(context) {
        const input = context.args.join(' ');
        if (!input) {
            await this.sendError(context.message, 'Please provide a video name, URL, or search query.');
            return;
        }
        if (GeneralUtils.isValidUrl(input)) {
            await this.handleUrl(context, input);
        }
        else {
            const videoFiles = fs.readdirSync(config.videosDir);
            const refreshedVideos = videoFiles.map(file => ({
                name: path.parse(file).name,
                path: path.join(config.videosDir, file)
            }));
            context.videos.length = 0;
            context.videos.push(...refreshedVideos);
            const video = context.videos.find(m => m.name.toLowerCase() === input.toLowerCase());
            if (video) {
                await this.handleLocalVideo(context, video);
            }
            else {
                await this.handleSearchQuery(context, input);
            }
        }
    }
    async handleLocalVideo(context, video) {
        const success = await context.streamingService.addToQueue(context.message, video.path, video.name);
        if (success) {
            if (!context.streamStatus.playing) {
                await context.streamingService.playFromQueue(context.message);
            }
        }
    }
    async handleUrl(context, url) {
        try {
            const success = await context.streamingService.addToQueue(context.message, url);
            if (success) {
                if (!context.streamStatus.playing) {
                    await context.streamingService.playFromQueue(context.message);
                }
            }
        }
        catch (error) {
            await ErrorUtils.handleError(error, `processing URL: ${url}`, context.message);
        }
    }
    async handleSearchQuery(context, query) {
        try {
            const success = await context.streamingService.addToQueue(context.message, query, `Search: ${query}`);
            if (success) {
                if (!context.streamStatus.playing) {
                    await context.streamingService.playFromQueue(context.message);
                }
            }
        }
        catch (error) {
            await ErrorUtils.handleError(error, 'adding search query to queue', context.message);
        }
    }
}
//# sourceMappingURL=play.js.map