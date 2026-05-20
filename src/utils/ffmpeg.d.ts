export declare function ffmpegScreenshot(video: string): Promise<string[]>;
export declare function getVideoParams(videoPath: string): Promise<{
    width: number;
    height: number;
    bitrate: string;
    maxbitrate: string;
    fps: number;
}>;
