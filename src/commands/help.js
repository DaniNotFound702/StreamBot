import { BaseCommand } from "./base.js";
export default class HelpCommand extends BaseCommand {
    commandManager;
    name = "help";
    description = "Show available commands";
    usage = "help [command]";
    aliases = ["h", "?"];
    constructor(commandManager) {
        super(commandManager);
        this.commandManager = commandManager;
    }
    async execute(context) {
        const args = context.args[0]?.toLowerCase();
        if (args) {
            await this.showCommandHelp(context, args);
        }
        else {
            await this.showAllCommands(context);
        }
    }
    async showAllCommands(context) {
        const commands = this.commandManager.getAllCommands();
        const categories = {
            '▶️ Playback': ['play', 'pause', 'skip', 'stop'],
            '📺 Media Control': ['subtitles', 'dubs'],
            '🔍 Search & Browse': ['search', 'ytsearch', 'jellyfin', 'list'],
            '📊 Queue & Status': ['queue', 'remove', 'status'],
            '⚙️ Configuration': ['config'],
            'ℹ️ Info': ['help', 'ping', 'preview']
        };
        let helpText = '```\n📽 STREAMBOT COMMANDS\n━━━━━━━━━━━━━━━━━━━━\n\n';
        for (const [category, commandNames] of Object.entries(categories)) {
            const categoryCommands = commands.filter(cmd => commandNames.includes(cmd.name));
            if (categoryCommands.length > 0) {
                helpText += `${category}\n`;
                categoryCommands.forEach(cmd => {
                    const aliases = cmd.aliases ? ` (${cmd.aliases.join(', ')})` : '';
                    helpText += `  $${cmd.name}${aliases}\n    ${cmd.description}\n\n`;
                });
            }
        }
        helpText += '━━━━━━━━━━━━━━━━━━━━\n';
        helpText += `Use: $help <command> for more info\n`;
        helpText += 'Total Commands: ' + commands.length + '\n```';
        try {
            await context.message.react('📋');
            if (helpText.length > 2000) {
                const chunks = helpText.match(/[\s\S]{1,1900}/g) || [];
                for (const chunk of chunks) {
                    await context.message.reply(chunk);
                }
            }
            else {
                await context.message.reply(helpText);
            }
        }
        catch (error) {
            await this.sendError(context.message, 'Failed to send help message.');
        }
    }
    async showCommandHelp(context, commandName) {
        const command = this.commandManager.getCommand(commandName);
        if (!command) {
            await this.sendError(context.message, `Command \`${commandName}\` not found.`);
            return;
        }
        const aliases = command.aliases && command.aliases.length > 0
            ? `\nAliases: ${command.aliases.map(a => `\`${a}\``).join(', ')}`
            : '';
        const helpText = `
**${command.name.toUpperCase()}**
${command.description}

Usage: \`$${command.usage}\`${aliases}

Type \`$help\` to see all commands.
		`.trim();
        try {
            await context.message.react('📋');
            await context.message.reply(helpText);
        }
        catch (error) {
            await this.sendError(context.message, 'Failed to send help message.');
        }
    }
}
//# sourceMappingURL=help.js.map