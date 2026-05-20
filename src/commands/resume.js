import { BaseCommand } from "./base.js";
export default class ResumeCommand extends BaseCommand {
    name = "resume";
    description = "Hervat een gepauzeerde video/stream";
    usage = "resume";
    aliases = ["r", "unpause"];
    async execute(context) {
        await context.streamingService.resumeCurrent(context.message);
    }
}
//# sourceMappingURL=resume.js.map