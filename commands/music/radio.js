// commands/music/radio.js
const { SlashCommandBuilder } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    getVoiceConnection
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const https = require('https');

const radioState = require('../../state/radiostate');

// --- konfigurasi ---

const DEFAULT_STATION = 'dengerin musik'; // fallback query
const TLS_BYPASS = true; // jika HTTPS radio bermasalah; set false bila tidak perlu

// --- helper: cek URL sederhana ---
function isUrl(str) {
    try { new URL(str); return true; } catch { return false; }
}

// --- helper: ambil URL radio ---
// - jika user memasukkan URL: gunakan langsung
// - kalau pakai nama, cari via radio-browser API
async function resolveRadioUrl(query) {
    if (isUrl(query)) return query;

    const enc = encodeURIComponent(query || DEFAULT_STATION);
    const rbUrl = `https://fi1.api.radio-browser.info/json/stations/byname/${enc}`;

    const res = await fetch(rbUrl, { timeout: 10000 });
    if (!res.ok) throw new Error(`Radio Browser API error: ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Tidak ada hasil untuk "${query}"`);
    }

    // Ambil entri pertama yang punya url
    const first = list.find(x => x.url) || list[0];
    return first.url;
}

// --- helper: coba variasi path Icecast yang umum ---
function normalizeIcecastUrl(u) {
    try {
        const url = new URL(u);
        // Banyak server bekerja lebih baik tanpa query param aneh
        url.search = '';

        // Variasi path umum: /stream, /;stream, /; atau mount default
        const candidates = [];
        const path = url.pathname.replace(/\/+$/, '') || '/';

        // Jika path awal terlihat seperti root/;?type=http maka coba ganti
        if (path === '/' || path === '/;' || path === '/stream') {
            candidates.push('/stream', '/;stream', '/;', '/live', '/radio', path);
        } else {
            candidates.push(path, '/stream', '/;stream', '/;');
        }

        return candidates.map(p => {
            const c = new URL(url.toString());
            c.pathname = p;
            return c.toString();
        });
    } catch {
        return [u];
    }
}

// --- helper: bikin stream dari FFmpeg ---
function spawnFfmpeg(inputUrl) {
    // reconnect flags membantu ketika radio putus
    const args = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', inputUrl,
        '-vn',
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '2',
        '-b:a', '128k',
        'pipe:1'
    ];

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    ff.on('spawn', () => console.log('[radio] ffmpeg spawned for', inputUrl));
    ff.on('close', (code) => {
        console.log('[radio] ffmpeg closed with code', code);
        const st = radioState.get(interaction.guildId);
        if (st && st.ffmpeg === ff) {
            // hanya clear jika yang tertutup adalah proses yang sedang terdaftar
            st.ffmpeg = undefined;
        }
    });

    return ff;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Putar radio stream')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Nama stasiun atau URL stream')
                .setRequired(false)
        ),

    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const channel = interaction.member?.voice?.channel;
        if (!channel) return interaction.reply({ content: '❌ Gabung dulu ke voice channel.', ephemeral: true });

        await interaction.deferReply();

        const query = interaction.options.getString('query') || DEFAULT_STATION;

        try {
            // 1) Dapatkan URL radio
            const rawUrl = await resolveRadioUrl(query);

            // 2) Siapkan agent TLS bypass (scoped) hanya untuk follow-redirects awal (opsional)
            const agent = TLS_BYPASS ? new https.Agent({ rejectUnauthorized: false }) : undefined;

            // 3) Ikuti redirect agar dapat URL akhir yang “bersih”
            //    (beberapa server meng-redirect ke mount sebenarnya)
            let finalUrl = rawUrl;
            try {
                const head = await fetch(rawUrl, { method: 'HEAD', redirect: 'follow', agent, timeout: 10000 });
                if (head?.url) finalUrl = head.url;
            } catch (_) {
                // Abaikan—tidak semua server mau HEAD
            }

            // 4) Coba beberapa kandidat path umum jika path tidak valid
            const candidates = normalizeIcecastUrl(finalUrl);

            // 5) Connect ke voice
            //    Jika sudah ada koneksi lama, pakai itu; jika tidak, buat baru
            let conn = getVoiceConnection(interaction.guildId);
            if (!conn) {
                conn = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator
                });
            }

            // 6) Audio player
            const player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
            });

            // Cleanup ketika channel kosong atau error
            player.on('error', (err) => {
                console.error('[radio] player error:', err);
                const st = radioState.get(interaction.guildId);
                try { st?.ffmpeg?.kill('SIGKILL'); } catch { }
            });

            conn.subscribe(player);

            // 7) Coba play kandidat satu per satu sampai ada yang berhasil
            let played = false;
            let lastErr;
            for (const cand of candidates) {
                try {
                    const ff = spawnFfmpeg(cand);
                    const resource = createAudioResource(ff.stdout, { inlineVolume: true });
                    resource.volume.setVolume(0.9);

                    // “Test” kecil: tunggu event Playing atau error cepat
                    const ready = new Promise((resolve, reject) => {
                        const onPlay = () => { player.off('error', onErr); resolve(true); };
                        const onErr = (e) => { player.off('stateChange', onPlay); reject(e); };
                        player.once(AudioPlayerStatus.Playing, onPlay);
                        player.once('error', onErr);
                    });

                    player.play(resource);
                    radioState.set(interaction.guildId, { conn, player, ffmpeg: spawnFfmpeg(cand) }); // <- simpan state

                    // Tunggu siap atau timeout 6 detik
                    await Promise.race([
                        ready,
                        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout start audio')), 6000))
                    ]);

                    // sukses
                    played = true;

                    // Auto-retry jika stream putus: saat Idle, coba respawn ffmpeg ke URL yang sama
                    player.on(AudioPlayerStatus.Idle, () => {
                        console.log('[radio] idle, attempting auto-reconnect...');
                        try {
                            const again = spawnFfmpeg(cand);
                            // simpan ffmpeg baru ke state agar /stop bisa membunuh proses yg benar
                            const st = radioState.get(interaction.guildId);
                            if (st) st.ffmpeg = again;
                            const res2 = createAudioResource(again.stdout, { inlineVolume: true });
                            res2.volume.setVolume(0.9);
                            player.play(res2);
                        } catch (e) {
                            console.error('[radio] reconnect failed:', e);
                        }
                    });

                    await interaction.followUp(`▶️ Memutar **${query}**\n\`\`\`\n${cand}\n\`\`\``);
                    break;
                } catch (e) {
                    lastErr = e;
                    console.warn('[radio] gagal mainkan kandidat:', cand, e?.message || e);
                    // stop player sebelum coba kandidat berikutnya
                    try { player.stop(); } catch { }
                }
            }

            if (!played) {
                throw new Error(`Gagal memutar stream. Terakhir: ${lastErr?.message || lastErr || 'unknown'}`);
            }

        } catch (e) {
            console.error('[radio] error:', e);
            return interaction.followUp(`❌ Gagal: ${e.message || e}`);
        }
    }
};