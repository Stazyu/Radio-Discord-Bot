const fs = require('node:fs');
const path = require('node:path');
const { Client, Events, REST, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");
const { Player, QueryType } = require("discord-player");
const { joinVoiceChannel } = require('@discordjs/voice');

const config = require("./config.json");
const { AudioPlayer } = require('@discordjs/voice');
const { useQueue } = require('discord-player');

// const client = new Client({
//     // intents: [Intents.FLAGS.GUILD_VOICE_STATES, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILDS]
//     intents: [GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
// });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        // Set a new item in the Collection with the key as the command name and the value as the exported module
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

client.on('ready', readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

const player = new Player(client);

// this event is emitted whenever discord-player starts to play a track
player.events.on('playerStart', (queue, track) => {
    // we will later define queue.metadata object while creating the queue
    console.log(track);
    if (track.views === 0) return
    queue.metadata.channel.send(`Started playing **${track.cleanTitle}**!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    console.log(interaction.options.get("query"));
    if (!interaction.isChatInputCommand()) return;
    const queue = useQueue(interaction.guildId);

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction, queue);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!client.application?.owner) await client.application?.fetch();
    // ...
    // console.log(message);
    // console.log('ID : ', client.application?.owner?.id);

    if (message.content === "!ping") {
        await message.reply("Pong!");
    }
});

client.login(config.token);

client.on("error", console.error);
client.on("warn", console.warn);
