const fs = require('node:fs');
const path = require('node:path');
const { useQueue } = require('discord-player');
const { Player, QueryType } = require("discord-player");
const { getVoiceConnection } = require('@discordjs/voice');
const { Client, Events, REST, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");

const config = require("./config.json");
const radioState = require('./state/radiostate');

const EMPTY_TIMEOUT_MS = 15000; // 15 detik grace period
const emptyTimers = new Map();

function isChannelEmpty(channel) {
    if (!channel) return true;
    // hitung hanya member non-bot
    return channel.members.filter(m => !m.user.bot).size === 0;
}

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

client.on('voiceStateUpdate', (oldState, newState) => {
    const guild = newState.guild;
    const guildId = guild.id;

    // ambil koneksi voice aktif (kalau ada)
    const conn = getVoiceConnection(guildId);
    if (!conn) return;

    // channel id tempat bot sedang berada
    const channelId = conn.joinConfig.channelId;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    if (isChannelEmpty(channel)) {
        // kalau sudah ada timer, jangan dobel
        if (emptyTimers.has(guildId)) return;

        const t = setTimeout(() => {
            try {
                const ch = guild.channels.cache.get(channelId);
                if (isChannelEmpty(ch)) {
                    // hentikan radio (player + ffmpeg) dan putuskan koneksi
                    const st = radioState.get(guildId);
                    try { st?.player?.stop(true); } catch { }
                    try { st?.ffmpeg?.kill('SIGKILL'); } catch { }
                    radioState.clear(guildId);

                    try { conn.destroy(); } catch { }
                    console.log(`[auto-leave] Disconnected from empty channel in ${guild.name}`);
                }
            } finally {
                emptyTimers.delete(guildId);
            }
        }, EMPTY_TIMEOUT_MS);

        emptyTimers.set(guildId, t);
    } else {
        // ada user masuk lagi → batalkan countdown keluar
        const t = emptyTimers.get(guildId);
        if (t) {
            clearTimeout(t);
            emptyTimers.delete(guildId);
        }
    }
});

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
