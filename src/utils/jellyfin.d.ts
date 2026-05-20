export interface JellyfinItem {
    Id: string;
    Name: string;
    Type: string;
    MediaType?: string;
    RunTimeTicks?: number;
    ImageTags?: {
        [key: string]: string;
    };
    Overview?: string;
    PremiereDate?: string;
    Status?: string;
    Url?: string;
}
export interface JellyfinSearchResult {
    Items: JellyfinItem[];
    TotalRecordCount: number;
}
export interface MediaStream {
    Type: string;
    Codec: string;
    IsDefault: boolean;
    Language?: string;
    DisplayTitle?: string;
    Index?: number;
    IsForced?: boolean;
}
export interface JellyfinMediaInfo {
    Id: string;
    Name: string;
    VideoStreams: MediaStream[];
    AudioStreams: MediaStream[];
    SubtitleStreams: MediaStream[];
}
export interface JellyfinPlaybackInfo {
    MediaSources: Array<{
        Id: string;
        Path?: string;
        Protocol?: string;
        Type: string;
        MediaStreams: Array<MediaStream>;
        TranscodingUrl?: string;
        DirectStreamUrl?: string;
    }>;
}
export declare class Jellyfin {
    private client;
    private userId;
    private deviceId;
    private isAuthenticated;
    constructor();
    private getRequestParams;
    authenticate(): Promise<boolean>;
    searchItems(query: string, limit?: number): Promise<JellyfinItem[]>;
    getItemDetails(itemId: string): Promise<JellyfinItem | null>;
    getStreamUrl(itemId: string, audioIndex?: number | null, subtitleIndex?: number | null, seekTimeMs?: number): Promise<string | null>;
    getLibraries(): Promise<JellyfinItem[]>;
    getLibraryItems(parentId: string, limit?: number): Promise<JellyfinItem[]>;
    isConfigured(): boolean;
    getServerUrl(): string;
    getMediaInfo(itemId: string): Promise<JellyfinMediaInfo | null>;
}
declare const _default: Jellyfin;
export default _default;
