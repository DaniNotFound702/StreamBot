import logger from '../utils/logger.js';
class StreamSelectionService {
    selections = new Map();
    getKey(userId, itemId) {
        return `${userId}:${itemId}`;
    }
    getOrCreateSelection(userId, itemId) {
        const key = this.getKey(userId, itemId);
        if (!this.selections.has(key)) {
            this.selections.set(key, {
                userId,
                itemId,
                timestamp: Date.now()
            });
        }
        return this.selections.get(key);
    }
    setSubtitle(userId, itemId, subtitleIndex) {
        const selection = this.getOrCreateSelection(userId, itemId);
        selection.subtitleIndex = subtitleIndex;
        selection.timestamp = Date.now();
        logger.info(`[StreamSelection] User ${userId} set subtitle ${subtitleIndex === null ? 'disabled' : `index ${subtitleIndex}`} for item ${itemId}`);
    }
    getSubtitle(userId, itemId) {
        const key = this.getKey(userId, itemId);
        return this.selections.get(key)?.subtitleIndex;
    }
    setAudio(userId, itemId, audioIndex) {
        const selection = this.getOrCreateSelection(userId, itemId);
        selection.audioIndex = audioIndex;
        selection.timestamp = Date.now();
        logger.info(`[StreamSelection] User ${userId} set audio index ${audioIndex} for item ${itemId}`);
    }
    getAudio(userId, itemId) {
        const key = this.getKey(userId, itemId);
        return this.selections.get(key)?.audioIndex;
    }
    getUserSelections(userId) {
        return Array.from(this.selections.values()).filter(s => s.userId === userId);
    }
    clearSelection(userId, itemId) {
        const key = this.getKey(userId, itemId);
        this.selections.delete(key);
        logger.info(`[StreamSelection] Cleared selections for user ${userId} on item ${itemId}`);
    }
    clearUserSelections(userId) {
        let count = 0;
        for (const key of this.selections.keys()) {
            if (key.startsWith(`${userId}:`)) {
                this.selections.delete(key);
                count++;
            }
        }
        logger.info(`[StreamSelection] Cleared ${count} selections for user ${userId}`);
    }
    cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        let count = 0;
        for (const [key, selection] of this.selections.entries()) {
            if (now - selection.timestamp > maxAgeMs) {
                this.selections.delete(key);
                count++;
            }
        }
        if (count > 0) {
            logger.info(`[StreamSelection] Cleaned up ${count} old selections`);
        }
    }
}
export const streamSelectionService = new StreamSelectionService();
//# sourceMappingURL=streamSelection.js.map