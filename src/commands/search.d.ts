import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
export default class SearchCommand extends BaseCommand {
    name: string;
    description: string;
    usage: string;
    aliases: string[];
    private mediaService;
    constructor();
    execute(context: CommandContext): Promise<void>;
    private searchLocal;
}
