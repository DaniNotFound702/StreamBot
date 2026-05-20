import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
export default class JellyfinCommand extends BaseCommand {
    name: string;
    description: string;
    usage: string;
    aliases: string[];
    private mediaService;
    private static lastSearchResults;
    constructor();
    execute(context: CommandContext): Promise<void>;
    private handleSearch;
    private handlePlay;
    private applyStreamSelections;
    private handleListLibraries;
    private showHelp;
}
