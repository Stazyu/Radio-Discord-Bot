const { SlashCommandBuilder } = require("discord.js");
const { getVoiceConnection } = require("@discordjs/voice");
const { useQueue } = require("discord-player");
const radioState = require("../../state/radiostate");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Stops the music/radio and leaves the voice channel."),
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guildId;

        // 1) Coba hentikan radio (@discordjs/voice + ffmpeg)
        const st = radioState.get(guildId);
        if (st) {
            try {
                // stop meta watcher
                try { st.metaWatcher?.stop(); } catch { }
                // stop player
                try { st.player.stop(true); } catch { }
                // kill ffmpeg
                try { st.ffmpeg?.kill("SIGKILL"); } catch { }
                // destroy voice connection
                try { st.conn?.destroy(); } catch { }

                radioState.clear(guildId);
                return interaction.followUp("✅ | Radio stopped and disconnected.");
            } catch (e) {
                // lanjut coba queue discord-player di bawah
                console.warn("[stop] radio stop error:", e);
            }
        }

        // 2) (Fallback) hentikan queue discord-player kalau ada
        const queue = useQueue(guildId);
        if (queue) {
            try {
                // hentikan playback & kosongkan antrian
                queue.delete(); // lebih “bersih” daripada node.stop()
                // (opsi lain: queue.node.stop(); queue.tracks.clear(); queue.delete();)
                return interaction.followUp("✅ | Music stopped and queue cleared.");
            } catch (e) {
                console.warn("[stop] discord-player stop error:", e);
                return interaction.followUp("❌ | Gagal stop discord-player queue.");
            }
        }

        return interaction.followUp("❌ | Tidak ada yang sedang diputar.");
    }
};