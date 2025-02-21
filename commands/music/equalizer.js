const { useQueue } = require("discord-player");
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equalizer')
        .setDescription('Setting Equalizer 15 Band')
        .addStringOption(option =>
            option.setName("preset")
                .setDescription("Enter your preset Equalizer")
                .setRequired(false)
                .addChoices(
                    { name: "Disable", value: "disable" },
                    { name: "Rock", value: "rock" },
                )
        )
        .addStringOption(option =>
            option.setName("custom")
                .setDescription("Enter your custom Equalizer")
                .setRequired(false)
        ),
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     * @param {import("discord-player").GuildQueue} queue
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying) return interaction.reply({ content: "❌ | No music is being played!" });

        if (interaction.options.getString('equalizer') === 'disable') {
            // Set equalizer preset to flat
            queue.filters.equalizer.disable();
            // Reply with a success message
            return interaction.reply({ content: "✅ | Equalizer Disabled" });
        } else if (interaction.options.getString('equalizer') === 'rock') {
            queue.filters.equalizerPresets.Rock
            // Reply with a success message
            return interaction.reply({ content: "✅ | Equalizer Rock" });
        } else {
            // Set equalizer preset to custom preset
            queue.filters.equalizer.setEQ([
                // Low
                {
                    band: 0,
                    gain: -2
                },
                {
                    band: 1,
                    gain: 0.5
                },
                {
                    band: 2,
                    gain: 1
                },
                // Mid
                // {
                //     band: 3,
                //     gain: 0.25
                // },
                // {
                //     band: 4,
                //     gain: 0.25
                // },
                // {
                //     band: 5,
                //     gain: 0.25
                // },
                // {
                //     band: 6,
                //     gain: 0.25
                // },
                // High
                {
                    band: 7,
                    gain: -2
                },
                {
                    band: 8,
                    gain: -3
                },
                // {
                //     band: 9,
                //     gain: 0.25
                // },
                // {
                //     band: 10,
                //     gain: 0.25
                // },
                // {
                //     band: 11,
                //     gain: 0.25
                // },
                {
                    band: 12,
                    gain: 1
                },
                {
                    band: 13,
                    gain: 3
                },
                {
                    band: 14,
                    gain: 1
                },
            ])
            // Reply with a success message
            return interaction.reply({ content: "✅ | Equalizer Custom" });
        }
    },
};