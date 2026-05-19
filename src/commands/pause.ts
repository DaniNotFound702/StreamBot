import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";

export default class PauseCommand extends BaseCommand {
	name = "pause";
	description = "Pauzeert de huidige video/stream";
	usage = "pause";
	aliases = ["p"];

	async execute(context: CommandContext): Promise<void> {
		await context.streamingService.pauseCurrent(context.message);
	}
}