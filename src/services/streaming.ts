import { Client, Message } from "discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream } from "@dank074/discord-video-stream";
import fs from 'fs';
import config from "../config.js";
import { MediaService } from './media.js';
import { QueueService } from './queue.js';
import { getVideoParams } from "../utils/ffmpeg.js";
import logger from '../utils/logger.js';
import { DiscordUtils, ErrorUtils } from '../utils/shared.js';
import { QueueItem, StreamStatus } from '../types/index.js';
import { streamSelectionService } from './streamSelection.js';

export class StreamingService {
  private streamer: Streamer;
  private mediaService: MediaService;
  private queueService: QueueService;
  private controller: AbortController | null = null;
  private streamStatus: StreamStatus;
  private failedVideos: Set<string> = new Set();
  private isSkipping: boolean = false;
  
  // Variabelen voor het nauwkeurig pauzeren en hervatten
  private streamStartTime: number = 0;
  private pausedTimeMs: number = 0;
  private isPaused: boolean = false;
  private currentCommand: any = null;

  // Variabele om bij te houden of we midden in een spoorgewijzigde herstart zitten
  private isSwitchingTracks: boolean = false;

  constructor(client: Client, streamStatus: StreamStatus) {
    this.streamer = new Streamer(client);
    this.mediaService = new MediaService();
    this.queueService = new QueueService();
    this.streamStatus = streamStatus;
  }

  public getStreamer(): Streamer {
    return this.streamer;
  }

  public getQueueService(): QueueService {
    return this.queueService;
  }

  private markVideoAsFailed(videoSource: string): void {
    this.failedVideos.add(videoSource);
    logger.info(`Marked video as failed: ${videoSource}`);
  }

  public async addToQueue(
    message: Message,
    videoSource: string,
    title?: string
  ): Promise<boolean> {
    try {
      const username = message.author.username;
      const mediaSource = await this.mediaService.resolveMediaSource(videoSource);

      if (mediaSource) {
        const queueItem = await this.queueService.addToQueue(mediaSource, username);
        await DiscordUtils.sendSuccess(message, `Added to queue: \`${queueItem.title}\``);
        return true;
      } else {
        const queueItem = await this.queueService.add(
          videoSource,
          title || videoSource,
          username,
          'url',
          false,
          videoSource
        );
        await DiscordUtils.sendSuccess(message, `Added to queue: \`${queueItem.title}\``);
        return true;
      }
    } catch (error) {
      await ErrorUtils.handleError(error, `adding to queue: ${videoSource}`, message);
      return false;
    }
  }

  public async playFromQueue(message: Message): Promise<void> {
    if (this.streamStatus.playing && !this.isPaused) {
      await DiscordUtils.sendError(message, 'Already playing a video. Use skip command to skip current video.');
      return;
    }

    const nextItem = this.queueService.getNext();
    if (!nextItem) {
      await DiscordUtils.sendError(message, 'Queue is empty.');
      return;
    }

    this.queueService.setPlaying(true);
    await this.playVideoFromQueueItem(message, nextItem);
  }

  public async skipCurrent(message: Message): Promise<void> {
    if (!this.streamStatus.playing && !this.isPaused) {
      await DiscordUtils.sendError(message, 'No video is currently playing.');
      return;
    }

    const queueLength = this.queueService.getLength();
    const isLastItem = queueLength <= 1;

    if (this.isSkipping && !isLastItem) {
      await DiscordUtils.sendError(message, 'Skip already in progress.');
      return;
    }

    this.isSkipping = true;

    try {
      this.streamStatus.manualStop = true;
      this.controller?.abort();
      this.streamer.stopStream();

      const currentItem = this.queueService.getCurrent();
      const nextItem = this.queueService.skip();

      if (!nextItem) {
        await DiscordUtils.sendInfo(message, 'Queue', 'No more videos in queue.');
        this.queueService.setPlaying(false);
        this.isPaused = false;
        await this.cleanupStreamStatus();
        return;
      }

      const currentTitle = currentItem ? currentItem.title : 'current video';
      await DiscordUtils.sendInfo(message, 'Skipping', `Skipping \`${currentTitle}\`. Playing next: \`${nextItem.title}\``);

      this.streamStatus.manualStop = false;
      this.isPaused = false;
      this.pausedTimeMs = 0;

      await this.playVideoFromQueueItem(message, nextItem);
    } finally {
      this.isSkipping = false;
    }
  }

  public async pauseCurrent(message: Message): Promise<void> {
    if (!this.streamStatus.playing || this.isPaused) {
      await DiscordUtils.sendError(message, 'Er wordt momenteel geen video afgespeeld of hij is al gepauzeerd.');
      return;
    }

    try {
      const elapsedMs = Date.now() - this.streamStartTime;
      this.pausedTimeMs += elapsedMs;
      this.isPaused = true;
      
      if (this.currentCommand) {
        this.currentCommand.kill('SIGSTOP');
      }

      await DiscordUtils.sendSuccess(message, '⏸️ De stream is gepauzeerd.');
    } catch (error) {
      logger.error('Kon stream niet pauzeren:', error);
      await DiscordUtils.sendError(message, 'Er ging iets mis bij het pauzeren.');
    }
  }

  public async resumeCurrent(message: Message): Promise<void> {
    if (!this.isPaused) {
      await DiscordUtils.sendError(message, 'De stream is momenteel niet gepauzeerd.');
      return;
    }

    try {
      this.isPaused = false;
      
      if (this.currentCommand) {
        this.currentCommand.kill('SIGCONT');
        this.streamStartTime = Date.now();
      }

      await DiscordUtils.sendSuccess(message, '▶️ De stream is hervat.');
    } catch (error) {
      logger.error('Kon stream niet hervatten:', error);
      await DiscordUtils.sendError(message, 'Er ging iets mis bij het hervatten.');
    }
  }

  // === NIEUWE DYNAMISCHE WISSEL FUNCTIE VOOR SUBS EN DUBS ===
  public async switchTracksDynamic(message: Message): Promise<void> {
    if (!this.streamStatus.playing) {
      await DiscordUtils.sendError(message, 'Er speelt momenteel geen video om sporen voor te wijzigen.');
      return;
    }

    const currentItem = this.queueService.getCurrent();
    if (!currentItem) {
      await DiscordUtils.sendError(message, 'Geen actieve video gevonden in de wachtrij.');
      return;
    }

    try {
      logger.info(`🔄 Dynamische track-wissel aangevraagd voor: ${currentItem.title}`);
      
      // 1. Bereken de verstreken tijd tot nu toe en voeg toe aan het totaal
      const elapsedMs = Date.now() - this.streamStartTime;
      this.pausedTimeMs += elapsedMs;
      
      // 2. Zet de wissel-vlag aan zodat finalizeStream de wachtrij niet sloopt
      this.isSwitchingTracks = true;
      this.streamStatus.manualStop = true;

      // 3. Stop de huidige FFmpeg stream onmiddellijk
      this.controller?.abort();
      this.streamer.stopStream();

      await DiscordUtils.sendInfo(message, 'Spoor Wijzigen', '🔄 Audio/Ondertiteling wordt live bijgewerkt, stream herstart over 1 seconde...');

      // 4. Start direct de video opnieuw op de exact opgeslagen milliseconde
      // De playVideoFromQueueItem zal automatisch de NIEUWE streamSelectionService indexen ophalen!
      setTimeout(async () => {
        this.streamStatus.manualStop = false;
        this.isSwitchingTracks = false;
        await this.playVideoFromQueueItem(message, currentItem, this.pausedTimeMs);
      }, 1000);

    } catch (error) {
      this.isSwitchingTracks = false;
      this.streamStatus.manualStop = false;
      logger.error('Fout bij het dynamisch wisselen van sporen:', error);
      await DiscordUtils.sendError(message, 'Er ging iets mis bij het live wisselen van de audiotracks/subs.');
    }
  }

  private async playVideoFromQueueItem(message: Message, queueItem: QueueItem, seekTimeMs: number = 0): Promise<void> {
    this.queueService.setPlaying(true);

    if (seekTimeMs === 0) {
      this.pausedTimeMs = 0; 
    }

    const userId = message.author.id;
    const itemId = queueItem.sourceId;

    let streamOpts: any = undefined;

    if (itemId) {
      const subtitle = streamSelectionService.getSubtitle(userId, itemId);
      const audio = streamSelectionService.getAudio(userId, itemId);

      streamOpts = {};

      if (subtitle !== undefined) {
        if (subtitle === null) {
          logger.info(`📌 Subtitles disabled for this video`);
          streamOpts.subtitleStreamIndex = null;
        } else {
          logger.info(`📌 Using subtitle index ${subtitle} (subtitle ${subtitle + 1})`);
          streamOpts.subtitleStreamIndex = subtitle;
        }
      }

      if (audio !== undefined) {
        logger.info(`📌 Using audio index ${audio} (audio track ${audio + 1})`);
        streamOpts.audioStreamIndex = audio;
      }
    }

    let videoParams = undefined;
    if (config.respect_video_params) {
      videoParams = await this.getVideoParameters(queueItem.url);
    }

    logger.info(`Playing from queue: ${queueItem.title} (${queueItem.url})`);

    await this.playVideo(message, queueItem.url, queueItem.title, videoParams, seekTimeMs, streamOpts);
  }

  private async getVideoParameters(videoUrl: string): Promise<{ width: number, height: number, fps?: number, bitrate?: number } | undefined> {
    try {
      const resolution = await getVideoParams(videoUrl);
      logger.info(`Video parameters: ${resolution.width}x${resolution.height}, FPS: ${resolution.fps || 'unknown'}, Bitrate: ${resolution.bitrate || 'unknown'}`);
      
      let bitrateKbps: number | undefined;
      if (resolution.bitrate) {
        bitrateKbps = Math.round(parseInt(resolution.bitrate) / 1000);
      }

      return {
        width: resolution.width,
        height: resolution.height,
        fps: resolution.fps,
        bitrate: bitrateKbps
      };
    } catch (error) {
      await ErrorUtils.handleError(error, 'determining video parameters');
      return undefined;
    }
  }

  private async ensureVoiceConnection(guildId: string, channelId: string, title?: string): Promise<void> {
    logger.info(`Ensuring voice connection to guild ${guildId}, channel ${channelId}`);
    
    if (!this.streamStatus.joined || !this.streamer.voiceConnection) {
      logger.info(`Voice not connected yet, joining voice channel...`);
      try {
        await this.streamer.joinVoice(guildId, channelId);
        this.streamStatus.joined = true;
        logger.info(`Joined voice channel`);
      } catch (error) {
        logger.error(`Failed to join voice channel:`, error);
        throw error;
      }
    } else {
      logger.info(`Already connected to voice`);
    }
    
    this.streamStatus.playing = true;
    this.streamStatus.channelInfo = { guildId, channelId, cmdChannelId: config.cmdChannelId! };

    if (title) {
      this.streamer.client.user?.setActivity(DiscordUtils.status_watch(title));
    }

    logger.info(`Waiting for voice connection to be ready...`);
    let connectionReady = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (this.streamer.voiceConnection) {
        connectionReady = true;
        logger.info(`Voice connection established on attempt ${i + 1}/10`);
        break;
      }
    }

    if (!connectionReady || !this.streamer.voiceConnection) {
      logger.error(`Voice connection is not established after wait`);
      throw new Error('Voice connection is not established');
    }
    logger.info(`Voice connection verified and ready`);
  }

  private setupStreamConfiguration(videoParams?: { width: number, height: number, fps?: number, bitrate?: number }, userId?: string): any {
    let width = videoParams?.width || config.width;
    let height = videoParams?.height || config.height;
    let frameRate = videoParams?.fps || config.fps;
    let bitrateVideo = config.bitrateKbps;

    if (videoParams && videoParams.bitrate && !config.bitrateOverride) {
      bitrateVideo = videoParams.bitrate;
    }

    if (config.maxWidth > 0 || config.maxHeight > 0) {
      const ratio = width / height;
      if (config.maxWidth > 0 && width > config.maxWidth) {
        width = config.maxWidth;
        height = Math.round(width / ratio);
      }
      if (config.maxHeight > 0 && height > config.maxHeight) {
        height = config.maxHeight;
        width = Math.round(height * ratio);
      }
      width = Math.round(width / 2) * 2;
      height = Math.round(height / 2) * 2;
    }

    const streamOpts: any = {
      width,
      height,
      frameRate,
      bitrateVideo,
      bitrateVideoMax: config.maxBitrateKbps,
      videoCodec: Utils.normalizeVideoCodec(config.videoCodec),
      hardwareAcceleratedDecoding: config.hardwareAcceleratedDecoding,
      minimizeLatency: false,
      h26xPreset: config.h26xPreset
    };

    return streamOpts;
  }

  private async executeStream(inputForFfmpeg: any, streamOpts: any, message: Message, title: string, videoSource: string, seekTimeMs: number = 0): Promise<void> {
    const userId = message.author.id;
    
    logger.info(`Creating stream with FFmpeg input: ${inputForFfmpeg}`);
    
    if (streamOpts.audioStreamIndex !== undefined) {
      logger.info(`📌 Using audio stream index ${streamOpts.audioStreamIndex} (audio track ${streamOpts.audioStreamIndex + 1})`);
    }
    if (streamOpts.subtitleStreamIndex !== undefined && streamOpts.subtitleStreamIndex !== null) {
      logger.info(`📌 Using subtitle stream index ${streamOpts.subtitleStreamIndex} (subtitle ${streamOpts.subtitleStreamIndex + 1})`);
    } else if (streamOpts.subtitleStreamIndex === null) {
      logger.info(`📌 Subtitles disabled`);
    }
    
    logger.info(`Stream options: ${JSON.stringify(streamOpts)}`);
    
    try {
      const { command, output: ffmpegOutput } = prepareStream(inputForFfmpeg, streamOpts, this.controller!.signal);
      logger.info(`FFmpeg command created successfully`);

      this.currentCommand = command;

      // Zorg dat we de tpad filter correct forceren zodat hij niet crasht tijdens pauzes
      command.videoFilters(`scale=${streamOpts.width}:${streamOpts.height},tpad=stop=-1:stop_mode=clone`);

      if (seekTimeMs > 0) {
        const seekSeconds = seekTimeMs / 1000;
        command.inputOptions(`-ss ${seekSeconds}`);
        logger.info(`✅ Succesvol -ss ${seekSeconds} toegevoegd aan de input opties`);
      }

      command.on("start", (cmdline) => {
        logger.info(`FFmpeg process started`);
        logger.info(`FFmpeg command line: ${cmdline}`);
      });

      command.on("error", (err, stdout, stderr) => {
        if (!this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
          logger.error("An error happened with ffmpeg:", err.message);
          this.controller.abort();
        }
      });

      logger.info(`Starting playStream with ffmpegOutput...`);
      this.streamStartTime = Date.now();
      
      await playStream(ffmpegOutput, this.streamer, undefined, this.controller!.signal)
        .catch((err) => {
          if (this.controller && !this.controller.signal.aborted) {
            logger.error('playStream error:', err);
            DiscordUtils.sendError(message, `Stream error: ${err.message || 'Unknown error'}`).catch(e =>
              logger.error('Failed to send error message:', e)
            );
          }
          if (this.controller && !this.controller.signal.aborted) this.controller.abort();
        });

      if (this.controller && !this.controller.signal.aborted && !this.streamStatus.manualStop) {
        logger.info(`Finished playing: ${title || videoSource}`);
      } else if (this.streamStatus.manualStop) {
        logger.info(`Stopped playing: ${title || videoSource}`);
      } else {
        logger.info(`Failed playing: ${title || videoSource}`);
      }
    } catch (error) {
      logger.error(`Unexpected error in executeStream:`, error);
      throw error;
    }
  }

  private async handleQueueAdvancement(message: Message): Promise<void> {
    await DiscordUtils.sendFinishMessage(message);

    const finishedItem = this.queueService.getCurrent();
    if (finishedItem) {
      this.queueService.removeFromQueue(finishedItem.id);
    }

    const nextItem = this.queueService.getNext();

    if (nextItem) {
      logger.info(`Auto-playing next item from queue: ${nextItem.title}`);
      setTimeout(() => {
        this.playVideoFromQueueItem(message, nextItem).catch(err =>
          ErrorUtils.handleError(err, 'auto-playing next item')
        );
      }, 1000);
    } else {
      this.queueService.setPlaying(false);
      logger.info('No more items in queue, playback stopped');
      await this.cleanupStreamStatus();
    }
  }

  private async handleDownload(message: Message, videoSource: string, title?: string): Promise<string | null> {
    const downloadMessage = await message.reply(`📥 Downloading \`${title || 'YouTube video'}\`...`).catch(e => {
      logger.warn("Failed to send 'Downloading...' message:", e);
      return null;
    });

    try {
      const tempFilePath = await this.mediaService.downloadYouTubeVideo(videoSource);
      if (tempFilePath) {
        if (downloadMessage) {
          await downloadMessage.delete().catch(e => logger.warn("Failed to delete 'Downloading...' message:", e));
        }
        return tempFilePath;
      }
      throw new Error('Download failed, no temp file path returned.');
    } catch (error) {
      if (downloadMessage) {
        await downloadMessage.edit(`❌ Failed to download \`${title || 'YouTube video'}\`.`).catch(e => logger.warn("Failed to edit message:", e));
      }
      return null;
    }
  }

  private async prepareVideoSource(message: Message, videoSource: string, title?: string): Promise<{ inputForFfmpeg: any, tempFilePath: string | null }> {
    const mediaSource = await this.mediaService.resolveMediaSource(videoSource);

    if (mediaSource && mediaSource.type === 'youtube' && !mediaSource.isLive) {
      const tempFilePath = await this.handleDownload(message, videoSource, title);
      if (tempFilePath) {
        return { inputForFfmpeg: tempFilePath, tempFilePath };
      }
      throw new Error('Failed to prepare video source due to download failure.');
    }

    return { inputForFfmpeg: mediaSource ? mediaSource.url : videoSource, tempFilePath: null };
  }

  private async executeStreamWorkflow(input: any, options: any, message: Message, title: string, source: string, seekTimeMs: number = 0): Promise<void> {
    this.controller = new AbortController();
    await this.executeStream(input, options, message, title, source, seekTimeMs);
  }

  private async finalizeStream(message: Message, tempFile: string | null): Promise<void> {
    if (!this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
      await this.handleQueueAdvancement(message);
    } else if (!this.isPaused && !this.isSwitchingTracks) {
      // Als we niet gepauzeerd zijn én niet wisselen van track, mag de queue gereset worden
      this.queueService.setPlaying(false);
      this.queueService.resetCurrentIndex();
      await this.cleanupStreamStatus();
    }

    if (tempFile) {
      try {
        fs.unlinkSync(tempFile);
      } catch (cleanupError) {
        logger.error(`Failed to delete temp file ${tempFile}:`, cleanupError);
      }
    }
  }

  public async playVideo(message: Message, videoSource: string, title?: string, videoParams?: { width: number, height: number, fps?: number, bitrate?: number }, seekTimeMs: number = 0, trackOverrides?: any): Promise<void> {
    const [guildId, channelId] = [config.guildId, config.videoChannelId];
    this.streamStatus.manualStop = false;

    if (title) {
      const currentQueueItem = this.queueService.getCurrent();
      if (currentQueueItem?.title === title) {
        this.queueService.setPlaying(true);
      }
    }

    let tempFile: string | null = null;
    try {
      const { inputForFfmpeg, tempFilePath } = await this.prepareVideoSource(message, videoSource, title);
      tempFile = tempFilePath;

      await this.ensureVoiceConnection(guildId, channelId, title);
      
      // Alleen sturen bij een écht nieuw begin
      if (seekTimeMs === 0) {
        await DiscordUtils.sendPlaying(message, title || videoSource);
      }

      const userId = message.author.id;
      const streamOpts = this.setupStreamConfiguration(videoParams, userId);
      
      // Voeg track overrides (audio/subs) samen met de standaard stream opties
      if (trackOverrides) {
        if (trackOverrides.audioStreamIndex !== undefined) streamOpts.audioStreamIndex = trackOverrides.audioStreamIndex;
        if (trackOverrides.subtitleStreamIndex !== undefined) streamOpts.subtitleStreamIndex = trackOverrides.subtitleStreamIndex;
      }

      await this.executeStreamWorkflow(inputForFfmpeg, streamOpts, message, title || videoSource, videoSource, seekTimeMs);
    } catch (error) {
      await ErrorUtils.handleError(error, `playing video: ${title || videoSource}`);
      if (this.controller && !this.controller.signal.aborted) this.controller.abort();
      this.markVideoAsFailed(videoSource);
    } finally {
      await this.finalizeStream(message, tempFile);
    }
  }

  public async cleanupStreamStatus(): Promise<void> {
    try {
      this.controller?.abort();
      this.streamer.stopStream();

      const hasQueueItems = !this.queueService.isEmpty();
      if (!hasQueueItems) {
        this.streamer.leaveVoice();
        this.streamStatus.joined = false;
        this.streamStatus.joinsucc = false;
      }

      this.streamer.client.user?.setActivity(DiscordUtils.status_idle());

      this.streamStatus.playing = false;
      this.streamStatus.manualStop = false;
      this.isPaused = false;
      this.isSwitchingTracks = false;
      this.pausedTimeMs = 0;
      this.streamStartTime = 0;
      this.currentCommand = null;

      this.streamStatus.channelInfo = {
        guildId: "",
        channelId: "",
        cmdChannelId: "",
      };
    } catch (error) {
      await ErrorUtils.handleError(error, "cleanup stream status");
    }
  }

  public async stopAndClearQueue(): Promise<void> {
    this.queueService.clearQueue();
    logger.info("Queue cleared by stop command");
    await this.cleanupStreamStatus();
  }
}