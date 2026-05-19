import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";

export default class ResumeCommand extends BaseCommand {
	name = "resume";
	description = "Hervat een gepauzeerde video/stream";
	usage = "resume";
	aliases = ["r", "unpause"];

	async execute(context: CommandContext): Promise<void> {
		await context.streamingService.resumeCurrent(context.message);
	}
}