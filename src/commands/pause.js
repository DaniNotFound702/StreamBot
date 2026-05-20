import { BaseCommand } from "./base.js";
export default class PauseCommand extends BaseCommand {
    name = "pause";
    description = "Pauzeert de huidige video/stream";
    usage = "pause";
    aliases = ["p"];
    async execute(context) {
        await context.streamingService.pauseCurrent(context.message);
    }
}
//# sourceMappingURL=pause.js.map