const { useQueue } = require("discord-player");
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stops the music!'),
    /**
     * Stops the music and cleans up the queue.
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.tracks) return interaction.reply({ content: "❌ | No music is being played!" });
        const success = queue.node.stop();
        return interaction.reply({ content: success ? "✅ | Stopped the music!" : "❌ | Something went wrong!" });
    }
}