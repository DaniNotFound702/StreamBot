import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
export default class SubtitlesCommand extends BaseCommand {
    name: string;
    description: string;
    usage: string;
    aliases: string[];
    execute(context: CommandContext): Promise<void>;
}
