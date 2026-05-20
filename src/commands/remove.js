import { BaseCommand } from "./base.js";
export default class RemoveCommand extends BaseCommand {
    name = "remove";
    description = "Remove an item from the queue";
    usage = "remove <number>";
    aliases = ["rm", "delete", "del"];
    async execute(context) {
        const args = context.args.slice(1);
        if (!args.length) {
            await this.sendError(context.message, 'Please provide a queue item number. Usage: `remove <number>`');
            return;
        }
        const queueService = context.streamingService.getQueueService();
        const queue = queueService.getQueue();
        const currentItem = queueService.getCurrent();
        if (queue.length === 0) {
            await this.sendError(context.message, 'The queue is empty.');
            return;
        }
        const itemNumber = parseInt(args[0]);
        if (isNaN(itemNumber) || itemNumber < 1) {
            await this.sendError(context.message, 'Please provide a valid item number.');
            return;
        }
        const index = itemNumber - 1;
        if (index >= queue.length) {
            await this.sendError(context.message, `Item #${itemNumber} not found. Queue has ${queue.length} item${queue.length !== 1 ? 's' : ''}.`);
            return;
        }
        const itemToRemove = queue[index];
        if (currentItem && itemToRemove.id === currentItem.id) {
            await this.sendError(context.message, '❌ Cannot remove the currently playing item. Use `skip` to skip to the next item.');
            return;
        }
        queueService.removeFromQueue(itemToRemove.id);
        await this.sendSuccess(context.message, `✅ Removed \`${itemToRemove.title}\` from queue.`);
    }
}
//# sourceMappingURL=remove.js.map