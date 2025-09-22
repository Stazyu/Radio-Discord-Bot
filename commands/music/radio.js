// // commands/music/radio.js
// const { SlashCommandBuilder } = require('discord.js');
// const {
//     joinVoiceChannel,
//     createAudioPlayer,
//     createAudioResource,
//     AudioPlayerStatus,
//     NoSubscriberBehavior,
//     getVoiceConnection
// } = require('@discordjs/voice');
// const { spawn } = require('child_process');
// const fetch = require('node-fetch');
// const https = require('https');

// const radioState = require('../../state/radiostate');
// const { startUnifiedRadioMetadata } = require('../../utils/radioUnifiedMetadata');
// const { EmbedBuilder } = require('discord.js');
// const { getRadioNowPlaying } = require('../../utils/getRadioNowPlaying');

// // --- konfigurasi ---

// const DEFAULT_STATION = 'dengerin musik'; // fallback query
// const TLS_BYPASS = true; // jika HTTPS radio bermasalah; set false bila tidak perlu

// // --- helper: cek URL sederhana ---
// function isUrl(str) {
//     try { new URL(str); return true; } catch { return false; }
// }

// // --- helper: ambil URL radio ---
// // - jika user memasukkan URL: gunakan langsung
// // - kalau pakai nama, cari via radio-browser API
// async function resolveRadioMetadata(query) {
//     if (isUrl(query)) return query;

//     const enc = encodeURIComponent(query || DEFAULT_STATION);
//     const rbUrl = `https://fi1.api.radio-browser.info/json/stations/byname/${enc}`;

//     const res = await fetch(rbUrl, { timeout: 10000 });
//     if (!res.ok) throw new Error(`Radio Browser API error: ${res.status}`);
//     const list = await res.json();
//     if (!Array.isArray(list) || list.length === 0) {
//         throw new Error(`Tidak ada hasil untuk "${query}"`);
//     }

//     // Ambil entri pertama yang punya url
//     const first = list.find(x => x.url) || list[0];

//     return {
//         url: first.url,
//         name: first.name || query,
//         homepage: first.homepage || null,
//         favicon: first.favicon || null,
//         tags: first.tags || null,
//         country: first.country || null,
//         codec: first.codec || null,
//         bitrate: first.bitrate || null,
//     };
// }

// // --- helper: coba variasi path Icecast yang umum ---
// function normalizeIcecastUrl(u) {
//     try {
//         const url = new URL(u);
//         // Banyak server bekerja lebih baik tanpa query param aneh
//         url.search = '';

//         // Variasi path umum: /stream, /;stream, /; atau mount default
//         const candidates = [];
//         const path = url.pathname.replace(/\/+$/, '') || '/';

//         // Jika path awal terlihat seperti root/;?type=http maka coba ganti
//         if (path === '/' || path === '/;' || path === '/stream') {
//             candidates.push('/stream', '/;stream', '/;', '/live', '/radio', path);
//         } else {
//             candidates.push(path, '/stream', '/;stream', '/;');
//         }

//         return candidates.map(p => {
//             const c = new URL(url.toString());
//             c.pathname = p;
//             return c.toString();
//         });
//     } catch {
//         return [u];
//     }
// }

// // --- helper: bikin stream dari FFmpeg ---
// function spawnFfmpeg(inputUrl) {
//     // reconnect flags membantu ketika radio putus
//     const args = [
//         '-reconnect', '1',
//         '-reconnect_streamed', '1',
//         '-reconnect_delay_max', '5',
//         '-i', inputUrl,
//         '-vn',
//         '-f', 'opus',
//         '-ar', '48000',
//         '-ac', '2',
//         '-b:a', '128k',
//         'pipe:1'
//     ];

//     const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
//     ff.on('spawn', () => console.log('[radio] ffmpeg spawned for', inputUrl));
//     ff.on('close', (code) => {
//         console.log('[radio] ffmpeg closed with code', code);
//         // kalau ffmpeg mati, coba destroy voice connection juga
//         // supaya bot tidak “terkunci” di voice channel
//         try {
//             const st = Array.from(radioState.values()).find(s => s.ffmpeg === ff);
//             if (st) {
//                 st.conn?.destroy();
//                 radioState.clear(st.guildId);
//             }
//         } catch { }
//     });

//     return ff;
// }

// module.exports = {
//     data: new SlashCommandBuilder()
//         .setName('radio')
//         .setDescription('Putar radio stream')
//         .addStringOption(option =>
//             option.setName('query')
//                 .setDescription('Nama stasiun atau URL stream')
//                 .setRequired(false)
//         ),

//     /**
//      * @param {import("discord.js").ChatInputCommandInteraction} interaction
//      */
//     async execute(interaction) {
//         const channel = interaction.member?.voice?.channel;
//         if (!channel) return interaction.reply({ content: '❌ Gabung dulu ke voice channel.', ephemeral: true });

//         await interaction.deferReply();

//         const query = interaction.options.getString('query') || DEFAULT_STATION;

//         try {
//             // 1) Dapatkan URL radio
//             const radioUrlMetadata = await resolveRadioMetadata(query);

//             // 2) Siapkan agent TLS bypass (scoped) hanya untuk follow-redirects awal (opsional)
//             const agent = TLS_BYPASS ? new https.Agent({ rejectUnauthorized: false }) : undefined;

//             // 3) Ikuti redirect agar dapat URL akhir yang “bersih”
//             //    (beberapa server meng-redirect ke mount sebenarnya)
//             let finalUrl = radioUrlMetadata.url;
//             try {
//                 const head = await fetch(radioUrlMetadata, { method: 'HEAD', redirect: 'follow', agent, timeout: 10000 });
//                 if (head?.url) finalUrl = head.url;
//             } catch (_) {
//                 // Abaikan—tidak semua server mau HEAD
//             }

//             // 4) Coba beberapa kandidat path umum jika path tidak valid
//             const candidates = normalizeIcecastUrl(finalUrl);

//             // 5) Connect ke voice
//             //    Jika sudah ada koneksi lama, pakai itu; jika tidak, buat baru
//             let conn = getVoiceConnection(interaction.guildId);
//             if (!conn) {
//                 conn = joinVoiceChannel({
//                     channelId: channel.id,
//                     guildId: channel.guild.id,
//                     adapterCreator: channel.guild.voiceAdapterCreator
//                 });
//             }

//             // 6) Audio player
//             const player = createAudioPlayer({
//                 behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
//             });

//             // Cleanup ketika channel kosong atau error
//             player.on('error', (err) => {
//                 console.error('[radio] player error:', err);
//                 const st = radioState.get(interaction.guildId);
//                 try { st?.ffmpeg?.kill('SIGKILL'); } catch { }
//             });

//             conn.subscribe(player);

//             // 7) Coba play kandidat satu per satu sampai ada yang berhasil
//             let played = false;
//             let lastErr;
//             for (const cand of candidates) {
//                 try {
//                     const ff = spawnFfmpeg(cand);
//                     const resource = createAudioResource(ff.stdout, { inlineVolume: true });
//                     resource.volume.setVolume(0.9);

//                     // “Test” kecil: tunggu event Playing atau error cepat
//                     const ready = new Promise((resolve, reject) => {
//                         const onPlay = () => { player.off('error', onErr); resolve(true); };
//                         const onErr = (e) => { player.off('stateChange', onPlay); reject(e); };
//                         player.once(AudioPlayerStatus.Playing, onPlay);
//                         player.once('error', onErr);
//                     });

//                     player.play(resource);
//                     radioState.set(interaction.guildId, { conn, player, ffmpeg: spawnFfmpeg(cand) }); // <- simpan state

//                     // Tunggu siap atau timeout 6 detik
//                     await Promise.race([
//                         ready,
//                         new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout start audio')), 6000))
//                     ]);

//                     // sukses
//                     played = true;

//                     await interaction.followUp({
//                         content: `▶️ Memutar Radio 📻  **${radioUrlMetadata.name}**
// ${radioUrlMetadata.homepage ? `🏠 Homepage : <${radioUrlMetadata.homepage}>` : ''}
// ${radioUrlMetadata.favicon ? `🖼️ Favicon ${radioUrlMetadata.favicon}` : ''}
// 🌍 Country : ${radioUrlMetadata.country || 'Unknown'} 
// 🎵 Tags : ${radioUrlMetadata.tags || 'No tags'}  
// 💽 Codec : ${radioUrlMetadata.codec || 'Unknown'} 
// 🔊 Bitrate : @ ${radioUrlMetadata.bitrate || 'Unknown'} kbps
//                         \n\`\`\`\n${cand}\n\`\`\``,
//                     });

//                     const watcher = await startUnifiedRadioMetadata(
//                         cand,
//                         async (title, info) => {
//                             try { await interaction.channel.send(`🎵 **Now Playing:** ${title}`); } catch { }
//                             // simpan kalau mau
//                             const st = radioState.get(interaction.guildId) || {};
//                             st.lastTitle = title;
//                             radioState.set(interaction.guildId, st);
//                         },
//                         {
//                             // kalau kamu SUDAH tahu stats URL Shoutcast yang valid, set di sini
//                             statsUrl: 'https://stream.denger.in:8888/stats?sid=1&json=1',
//                             tlsBypass: true,     // karena cert host itu bermasalah
//                             intervalMs: 12000
//                         }
//                     );

//                     // const statsUrl = 'https://stream.denger.in:8888/stats?sid=1&json=1';
//                     // const meta = await getRadioNowPlaying(cand, { statsUrl, tlsBypass: true });
//                     // console.log('[radio] now playing metadata:', meta);

//                     // if (meta.title) {
//                     //     const embed = new EmbedBuilder()
//                     //         .setTitle('Now Playing')
//                     //         .setDescription(`**${meta.title}**`)
//                     //         .addFields(
//                     //             ...(meta.serverTitle ? [{ name: 'Station', value: meta.serverTitle, inline: true }] : []),
//                     //             ...(meta.genre ? [{ name: 'Genre', value: meta.genre, inline: true }] : []),
//                     //             ...(meta.listeners !== undefined ? [{ name: 'Listeners', value: String(meta.listeners), inline: true }] : []),
//                     //             ...(meta.bitrate ? [{ name: 'Bitrate', value: `${meta.bitrate} kbps`, inline: true }] : []),
//                     //             ...(meta.sampleRate ? [{ name: 'Sample Rate', value: `${meta.sampleRate} Hz`, inline: true }] : []),
//                     //             ...(meta.uptimeHuman ? [{ name: 'Uptime', value: meta.uptimeHuman, inline: true }] : []),
//                     //         )
//                     //         .setFooter({ text: `Source: ${meta.source}` });

//                     //     await interaction.channel.send({ embeds: [embed] });
//                     // } else {
//                     //     await interaction.channel.send('🎵 Now Playing: (judul tidak tersedia)');
//                     // }

//                     // simpan supaya bisa di-stop di `/stop` & auto-leave
//                     const st = radioState.get(interaction.guildId) || {};
//                     st.metaWatcher = watcher;
//                     radioState.set(interaction.guildId, st);

//                     // Auto-retry jika stream putus: saat Idle, coba respawn ffmpeg ke URL yang sama
//                     player.on(AudioPlayerStatus.Idle, () => {
//                         console.log('[radio] idle, attempting auto-reconnect...');
//                         try {
//                             const again = spawnFfmpeg(cand);
//                             // simpan ffmpeg baru ke state agar /stop bisa membunuh proses yg benar
//                             const st = radioState.get(interaction.guildId);
//                             if (st) st.ffmpeg = again;
//                             const res2 = createAudioResource(again.stdout, { inlineVolume: true });
//                             res2.volume.setVolume(0.9);
//                             player.play(res2);
//                         } catch (e) {
//                             console.error('[radio] reconnect failed:', e);
//                         }
//                     });

//                     break;
//                 } catch (e) {
//                     lastErr = e;
//                     console.warn('[radio] gagal mainkan kandidat:', cand, e?.message || e);
//                     // stop player sebelum coba kandidat berikutnya
//                     try { player.stop(); } catch { }
//                 }
//             }

//             if (!played) {
//                 throw new Error(`Gagal memutar stream. Terakhir: ${lastErr?.message || lastErr || 'unknown'}`);
//             }

//         } catch (e) {
//             console.error('[radio] error:', e);
//             return interaction.followUp(`❌ Gagal: ${e.message || e}`);
//         }
//     }
// };

// commands/music/radio.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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

const radioState = require('../../state/radiostate'); // pastikan modul Map {get,set,clear}
const { getRadioNowPlaying } = require('../../utils/getRadioNowPlaying');

// === Konfigurasi ===
const DEFAULT_STATION = 'dengerin musik';
const TLS_BYPASS = true;                 // sertifikat host bermasalah → true
const NP_INTERVAL_MS = 12000;            // interval polling judul

// === Helpers ===
function isUrl(str) {
    try { new URL(str); return true; } catch { return false; }
}

async function resolveRadioMetadata(query) {
    if (isUrl(query)) {
        return { url: query, name: query, homepage: null, favicon: null, tags: null, country: null, codec: null, bitrate: null };
    }
    const enc = encodeURIComponent(query || DEFAULT_STATION);
    const rbUrl = `https://fi1.api.radio-browser.info/json/stations/byname/${enc}`;
    const rbUrl2 = `https://de1.api.radio-browser.info/json/stations/byname/${enc}`; // alternatif
    const res = await fetch(rbUrl, { timeout: 10000 });
    let list;
    if (!res.ok) {
        const res2 = await fetch(rbUrl2, { timeout: 10000 });
        if (!res2.ok) throw new Error(`Radio Browser API error: ${res2.status}`);
        list = await res2.json();
    } else {
        list = await res.json();
    }
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Tidak ada hasil untuk "${query}"`);
    }
    const first = list.filter(x => x.countrycode === 'ID').find(x => x.url) || list.find(x => x.url) || list[0];
    console.log('[radio] resolved radio-browser:', first);
    return {
        url: first.url,
        name: first.name || query,
        homepage: first.homepage || null,
        favicon: first.favicon || null,
        tags: first.tags || null,
        country: first.country || null,
        codec: first.codec || null,
        bitrate: first.bitrate || null,
    };
}

function normalizeIcecastUrl(u) {
    try {
        const url = new URL(u);
        url.search = '';
        const candidates = [];
        const path = url.pathname.replace(/\/+$/, '') || '/';
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

function spawnFfmpeg(inputUrl, guildId) {
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
        try {
            const st = radioState.get(guildId);
            if (st && st.ffmpeg === ff) {
                try { st.metaWatcher?.stop?.(); } catch { }
                try { st.conn?.destroy(); } catch { }
                radioState.clear(guildId);
            }
        } catch { }
    });
    return ff;
}

// === Watcher judul (polling) ===
function startNowPlayingWatcher(guildId, streamUrl, statsUrl) {
    let stopped = false;
    let last = null;
    const tick = async () => {
        if (stopped) return;
        try {
            const meta = await getRadioNowPlaying(streamUrl, { statsUrl, tlsBypass: TLS_BYPASS });
            const title = (meta?.title || '').replace(/\s+/g, ' ').trim();
            if (title && title !== last) {
                last = title;
                const st = radioState.get(guildId);
                if (st?.textChannel) {
                    // kirim embed ringkas
                    const fields = [];

                    if (meta.serverTitle) fields.push({ name: 'Station', value: meta.serverTitle, inline: true });
                    if (meta.genre) fields.push({ name: 'Genre', value: meta.genre });
                    if (meta.listeners != null) fields.push({ name: 'Listeners', value: String(meta.listeners), inline: true });
                    if (meta.bitrate) fields.push({ name: 'Bitrate', value: `${meta.bitrate} kbps`, inline: true });
                    const embed = new EmbedBuilder()
                        .setTitle('▶️  Now Playing')
                        .setDescription(`🎶 ***Track :*** **${title}**`)
                        .addFields(...fields)
                        .setFooter({ text: `Source: ${meta.source || 'unknown'}` });
                    try { await st.textChannel.send({ embeds: [embed] }); } catch { }
                }
            }
        } catch { }
        if (!stopped) setTimeout(tick, NP_INTERVAL_MS);
    };
    tick();
    return { stop() { stopped = true; } };
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
            // Bersihkan state lama jika ada (biar tidak dobel watcher/proses)
            const prev = radioState.get(interaction.guildId);
            if (prev) {
                try { prev.metaWatcher?.stop?.(); } catch { }
                try { prev.player?.stop(true); } catch { }
                try { prev.ffmpeg?.kill('SIGKILL'); } catch { }
                try { prev.conn?.destroy(); } catch { }
                radioState.clear(interaction.guildId);
            }

            // 1) Dapatkan URL radio & metadata dasar
            const radioUrlMetadata = await resolveRadioMetadata(query);

            // 2) Follow redirect agar dapat URL akhir yang “bersih”
            const agent = TLS_BYPASS ? new https.Agent({ rejectUnauthorized: false }) : undefined;
            let finalUrl = radioUrlMetadata.url;
            try {
                // FIX: pakai .url, bukan objek metadata
                const head = await fetch(radioUrlMetadata.url, { method: 'HEAD', redirect: 'follow', agent, timeout: 10000 });
                if (head?.url) finalUrl = head.url;
            } catch (_) { /* ignore */ }

            // 3) Kandidat path umum
            const candidates = normalizeIcecastUrl(finalUrl);

            // 4) Voice connection
            let conn = getVoiceConnection(interaction.guildId);
            if (!conn) {
                conn = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator
                });
            }

            // 5) Audio player
            const player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
            });
            player.on('error', (err) => {
                console.error('[radio] player error:', err);
                const st = radioState.get(interaction.guildId);
                try { st?.ffmpeg?.kill('SIGKILL'); } catch { }
            });
            conn.subscribe(player);

            // 6) Coba play kandidat satu per satu
            let played = false;
            let lastErr;
            for (const cand of candidates) {
                try {
                    const ff = spawnFfmpeg(cand, interaction.guildId); // FIX: spawn 1x saja
                    const resource = createAudioResource(ff.stdout, { inlineVolume: true });
                    resource.volume.setVolume(0.9);

                    const ready = new Promise((resolve, reject) => {
                        const onPlay = () => { player.off('error', onErr); resolve(true); };
                        const onErr = (e) => { player.off('stateChange', onPlay); reject(e); };
                        player.once(AudioPlayerStatus.Playing, onPlay);
                        player.once('error', onErr);
                    });

                    player.play(resource);

                    // simpan state awal (FIX: jangan spawn lagi; simpan ff yang sama)
                    radioState.set(interaction.guildId, {
                        guildId: interaction.guildId,
                        conn, player, ffmpeg: ff,
                        textChannel: interaction.channel
                    });

                    await Promise.race([
                        ready,
                        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout start audio')), 6000))
                    ]);

                    // sukses
                    played = true;

                    await interaction.followUp({
                        content: `▶️ Memutar Radio 📻  **${radioUrlMetadata.name}**
${radioUrlMetadata.homepage ? `🏠 Homepage : <${radioUrlMetadata.homepage}>` : ''}
${radioUrlMetadata.favicon ? `🖼️ Favicon : ${radioUrlMetadata.favicon}` : ''}
🌍 Country : ${radioUrlMetadata.country || 'Unknown'} 
🎵 Tags : ${radioUrlMetadata.tags || 'No tags'}  
💽 Codec : ${radioUrlMetadata.codec || 'Unknown'} 
🔊 Bitrate : @ ${radioUrlMetadata.bitrate || 'Unknown'} kbps
\`\`\`\n${cand}\n\`\`\``,
                    });

                    // 7) Ambil now playing sekali (langsung tampilkan)
                    const statsUrl = 'https://stream.denger.in:8888/stats?sid=1&json=1';
                    // const meta = await getRadioNowPlaying(cand, { statsUrl, tlsBypass: TLS_BYPASS });
                    // if (meta?.title) {
                    //     const fields = [];
                    //     if (meta.serverTitle) fields.push({ name: 'Station', value: meta.serverTitle, inline: true });
                    //     if (meta.genre) fields.push({ name: 'Genre', value: meta.genre, inline: true });
                    //     if (meta.listeners != null) fields.push({ name: 'Listeners', value: String(meta.listeners), inline: true });
                    //     if (meta.bitrate) fields.push({ name: 'Bitrate', value: `${meta.bitrate} kbps`, inline: true });
                    //     if (meta.sampleRate) fields.push({ name: 'Sample Rate', value: `${meta.sampleRate} Hz`, inline: true });
                    //     if (meta.uptimeHuman) fields.push({ name: 'Uptime', value: meta.uptimeHuman, inline: true });

                    //     const embed = new EmbedBuilder()
                    //         .setTitle('🎵 Now Playing')
                    //         .setDescription(`**${meta.title}**`)
                    //         .addFields(...fields)
                    //         .setFooter({ text: `Source: ${meta.source}` });
                    //     try { await interaction.channel.send({ embeds: [embed] }); } catch { }
                    // } else {
                    //     try { await interaction.channel.send('🎵 Now Playing: (judul tidak tersedia)'); } catch { }
                    // }

                    // 8) START WATCHER — kirim lagi saat judul berubah
                    const watcher = startNowPlayingWatcher(interaction.guildId, cand);
                    const st = radioState.get(interaction.guildId);
                    if (st) st.metaWatcher = watcher;

                    // 9) Auto-reconnect saat Idle
                    player.on(AudioPlayerStatus.Idle, () => {
                        console.log('[radio] idle, attempting auto-reconnect...');
                        try {
                            const again = spawnFfmpeg(cand, interaction.guildId);
                            const s = radioState.get(interaction.guildId);
                            if (s) s.ffmpeg = again; // update handle ffmpeg di state
                            const res2 = createAudioResource(again.stdout, { inlineVolume: true });
                            res2.volume.setVolume(0.9);
                            player.play(res2);
                        } catch (e) {
                            console.error('[radio] reconnect failed:', e);
                        }
                    });

                    break;
                } catch (e) {
                    lastErr = e;
                    console.warn('[radio] gagal mainkan kandidat:', cand, e?.message || e);
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
