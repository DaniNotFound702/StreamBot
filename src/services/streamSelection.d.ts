export interface StreamSelection {
    userId: string;
    itemId: string;
    subtitleIndex?: number | null;
    audioIndex?: number;
    timestamp: number;
}
declare class StreamSelectionService {
    private selections;
    private getKey;
    private getOrCreateSelection;
    setSubtitle(userId: string, itemId: string, subtitleIndex: number | null): void;
    getSubtitle(userId: string, itemId: string): number | null | undefined;
    setAudio(userId: string, itemId: string, audioIndex: number): void;
    getAudio(userId: string, itemId: string): number | undefined;
    getUserSelections(userId: string): StreamSelection[];
    clearSelection(userId: string, itemId: string): void;
    clearUserSelections(userId: string): void;
    cleanup(maxAgeMs?: number): void;
}
export declare const streamSelectionService: StreamSelectionService;
export {};
