const { useQueue } = require("discord-player");
const { createAudioPlayer, useMainPlayer } = require("discord-player");
const { SlashCommandBuilder } = require("discord.js");
const fetch = require("node-fetch");
const { isUrl } = require("../../helpers/validator");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Radio!')
        .addStringOption(option =>
            option.setName("query")
                .setDescription("Enter your search query")
                .setRequired(false)
        ),
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        // await interaction.reply('Radio!');
        const queue = useQueue(interaction.guildId);
        const player = useMainPlayer();
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply('You are not connected to a voice channel!'); // make sure we have a voice channel
        const query = interaction.options.getString('query');
        await player.extractors.loadDefault((ext) => ext !== 'YouTubeExtractor');
        const radioApi = isUrl(query) ? query : await fetch(`https://de1.api.radio-browser.info/json/stations/byname/${query ? query : 'dengerin musik'}`).then(res => res.json());
        console.log(radioApi[0].url);
        const radioUrl = await fetch(isUrl(query) ? query : radioApi[0].url).then(res => res.url);

        if (queue && queue.isPlaying) return queue.node.skip();
        // let's defer the interaction as things can take time to process
        await interaction.deferReply();

        try {
            const playying = await player.play(channel, radioUrl, {
                nodeOptions: {
                    // nodeOptions are the options for guild node (aka your queue in simple word)
                    metadata: interaction, // we can access this metadata object using queue.metadata later on
                }
            })

            return interaction.followUp(`**${radioApi[0].name || 'Radio'}** is Playing!`);
        } catch (e) {
            // let's return error if something failed
            console.log(e);

            return interaction.followUp(`Something went wrong: ${e}`);
        }
    },
};