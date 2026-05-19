import logger from '../utils/logger.js';

/**
 * Service to manage user stream selections (subtitles, audio, etc.)
 * Flexible architecture for dynamic media stream handling
 */

export interface StreamSelection {
	userId: string;
	itemId: string;
	subtitleIndex?: number | null; // null = disabled, undefined = not set
	audioIndex?: number; // 0-based index
	timestamp: number;
}

class StreamSelectionService {
	private selections: Map<string, StreamSelection> = new Map();

	/**
	 * Generate unique key for user + item combo
	 */
	private getKey(userId: string, itemId: string): string {
		return `${userId}:${itemId}`;
	}

	/**
	 * Get or create selection for user + item
	 */
	private getOrCreateSelection(userId: string, itemId: string): StreamSelection {
		const key = this.getKey(userId, itemId);
		if (!this.selections.has(key)) {
			this.selections.set(key, {
				userId,
				itemId,
				timestamp: Date.now()
			});
		}
		return this.selections.get(key)!;
	}

	/**
	 * Set subtitle selection for user on item
	 */
	setSubtitle(userId: string, itemId: string, subtitleIndex: number | null): void {
		const selection = this.getOrCreateSelection(userId, itemId);
		selection.subtitleIndex = subtitleIndex;
		selection.timestamp = Date.now();
		logger.info(`[StreamSelection] User ${userId} set subtitle ${subtitleIndex === null ? 'disabled' : `index ${subtitleIndex}`} for item ${itemId}`);
	}

	/**
	 * Get subtitle selection for user on item
	 */
	getSubtitle(userId: string, itemId: string): number | null | undefined {
		const key = this.getKey(userId, itemId);
		return this.selections.get(key)?.subtitleIndex;
	}

	/**
	 * Set audio selection for user on item
	 */
	setAudio(userId: string, itemId: string, audioIndex: number): void {
		const selection = this.getOrCreateSelection(userId, itemId);
		selection.audioIndex = audioIndex;
		selection.timestamp = Date.now();
		logger.info(`[StreamSelection] User ${userId} set audio index ${audioIndex} for item ${itemId}`);
	}

	/**
	 * Get audio selection for user on item
	 */
	getAudio(userId: string, itemId: string): number | undefined {
		const key = this.getKey(userId, itemId);
		return this.selections.get(key)?.audioIndex;
	}

	/**
	 * Get all selections for a user
	 */
	getUserSelections(userId: string): StreamSelection[] {
		return Array.from(this.selections.values()).filter(s => s.userId === userId);
	}

	/**
	 * Clear selection for user + item
	 */
	clearSelection(userId: string, itemId: string): void {
		const key = this.getKey(userId, itemId);
		this.selections.delete(key);
		logger.info(`[StreamSelection] Cleared selections for user ${userId} on item ${itemId}`);
	}

	/**
	 * Clear all selections for a user
	 */
	clearUserSelections(userId: string): void {
		let count = 0;
		for (const key of this.selections.keys()) {
			if (key.startsWith(`${userId}:`)) {
				this.selections.delete(key);
				count++;
			}
		}
		logger.info(`[StreamSelection] Cleared ${count} selections for user ${userId}`);
	}

	/**
	 * Clean up old selections (older than 24 hours)
	 */
	cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
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

// Export singleton instance
export const streamSelectionService = new StreamSelectionService();
