// utils/getRadioNowPlaying.js
const http = require('http');
const https = require('https');
const { parseShoutcastStats } = require('./parseShoutcastStats');

function fetchText(url, { tlsBypass = false, timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.get({
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + (u.search || ''),
            headers: { 'User-Agent': 'DiscordRadioBot/1.0' },
            timeout,
            ...(tlsBypass && u.protocol === 'https:' ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {})
        }, (res) => {
            if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
            let data = '';
            res.setEncoding('utf8');
            res.on('data', d => data += d);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
    });
}
async function fetchJson(url, opt) { return JSON.parse(await fetchText(url, opt)); }

/**
 * Ambil "Now Playing" prioritas:
 * 1) Shoutcast JSON (statsUrl kalau diberikan; kalau tidak, tebak /stats?sid=1&json=1 lalu /stats?json=1)
 * 2) Icecast status-json.xsl
 * 3) ICY metadata (judul saja) — best effort
 *
 * @param {string} streamUrl URL audio yang kamu putar (buat derive base/mount & ICY fallback)
 * @param {{ statsUrl?: string, tlsBypass?: boolean }} opts
 * @returns {Promise<{title?: string, serverTitle?: string, listeners?: number, peakListeners?: number, genre?: string, bitrate?: number, sampleRate?: number, contentType?: string, streamPath?: string, uptimeSec?: number, uptimeHuman?: string, source: 'shoutcast'|'icecast'|'icy'|'unknown', raw?: any }>}
 */
async function getRadioNowPlaying(streamUrl, { statsUrl, tlsBypass = true } = {}) {
    const base = streamUrl.includes('denger.in') ? 'https://stream.denger.in:8888' : (() => { const u = new URL(streamUrl); return `${u.protocol}//${u.host}`; })();
    const mount = new URL(streamUrl).pathname;

    // 1) Shoutcast JSON — utama
    try {
        const scUrl = statsUrl || new URL('/stats?sid=1&json=1', base).toString();
        console.log('[getRadioNowPlaying] shoutcast', scUrl);
        const j = await fetchJson(scUrl, { tlsBypass });
        const parsed = parseShoutcastStats(j);
        if (parsed.title) return { ...parsed, source: 'shoutcast' };
        // coba global jika per-stream kosong
        if (!statsUrl) {
            const j2 = await fetchJson(new URL('/stats?json=1', base).toString(), { tlsBypass });
            // format bisa {streams:[...]} atau object tunggal
            if (Array.isArray(j2?.streams) && j2.streams.length) {
                const pick = j2.streams.find(s => (s.songtitle || s.streamtitle)) || j2.streams[0];
                const parsed2 = parseShoutcastStats(pick);
                if (parsed2.title) return { ...parsed2, source: 'shoutcast' };
            } else {
                const parsed2 = parseShoutcastStats(j2);
                if (parsed2.title) return { ...parsed2, source: 'shoutcast' };
            }
        }
    } catch { }

    // 2) Icecast status-json.xsl
    try {
        console.log('[getRadioNowPlaying] trying icecast');
        const statusUrl = new URL('/status-json.xsl', base).toString();
        const j = await fetchJson(statusUrl, { tlsBypass });
        const srcs = j?.icestats?.source;
        const arr = Array.isArray(srcs) ? srcs : [srcs].filter(Boolean);
        let pick = arr.find(s => {
            const listen = s?.listenurl || '';
            try { const u = new URL(listen); return u.pathname === mount || listen.includes(mount); }
            catch { return listen.includes(mount); }
        }) || arr[0];
        if (pick) {
            const title = (pick.title || pick.artist || pick.server_name || '').trim();
            const res = {
                title,
                serverTitle: pick.server_name,
                listeners: Number(pick.listeners) || undefined,
                bitrate: Number(pick.bitrate) || undefined,
                contentType: pick.server_type,
                streamPath: pick.listenurl ? new URL(pick.listenurl).pathname : undefined,
                source: 'icecast',
                raw: pick
            };
            if (title) return res;
        }
    } catch { }

    // 3) ICY fallback — judul saja (tanpa lib)
    try {
        console.log('[getRadioNowPlaying] trying icy');
        const title = await getIcyTitleOnce(streamUrl, { tlsBypass });
        if (title) return { title, source: 'icy' };
    } catch { }

    return { source: 'unknown' };
}

/** Ambil 1x judul ICY (blok metadata pertama) */
function getIcyTitleOnce(streamUrl, { tlsBypass = false, timeoutMs = 8000 } = {}) {
    return new Promise((resolve) => {
        const u = new URL(streamUrl);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + (u.search || ''),
            method: 'GET',
            headers: { 'Icy-MetaData': '1', 'User-Agent': 'DiscordRadioBot/1.0' },
            ...(tlsBypass && u.protocol === 'https:' ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {})
        }, (res) => {
            const metaint = parseInt(res.headers['icy-metaint'] || res.headers['icy-metaint'.toLowerCase()] || 'NaN', 10);
            if (!Number.isFinite(metaint)) { res.resume(); resolve(''); return; }
            let bytesUntilMeta = metaint;
            let metaLenPending = -1;
            let metaBuf = Buffer.alloc(0);

            res.on('data', (chunk) => {
                let offset = 0;
                while (offset < chunk.length) {
                    if (metaLenPending < 0) {
                        const consume = Math.min(bytesUntilMeta, chunk.length - offset);
                        offset += consume; bytesUntilMeta -= consume;
                        if (bytesUntilMeta === 0) {
                            if (offset >= chunk.length) { metaLenPending = null; break; }
                            const lenByte = chunk.readUInt8(offset); offset += 1;
                            const metaLen = lenByte * 16;
                            if (metaLen === 0) { resolve(''); return; }
                            metaLenPending = metaLen; metaBuf = Buffer.alloc(0);
                        }
                    } else {
                        if (metaLenPending === null) {
                            if (offset >= chunk.length) break;
                            const lenByte = chunk.readUInt8(offset); offset += 1;
                            const metaLen = lenByte * 16;
                            if (metaLen === 0) { resolve(''); return; }
                            metaLenPending = metaLen; metaBuf = Buffer.alloc(0);
                        } else {
                            const take = Math.min(chunk.length - offset, metaLenPending);
                            metaBuf = Buffer.concat([metaBuf, chunk.subarray(offset, offset + take)]);
                            offset += take; metaLenPending -= take;
                            if (metaLenPending === 0) {
                                const s = metaBuf.toString('utf8').replace(/\0+$/g, '');
                                const m = /StreamTitle='([^']*)'/.exec(s);
                                resolve(m ? m[1].trim() : '');
                                try { req.destroy(); } catch { }
                                return;
                            }
                        }
                    }
                }
            });
        });
        req.on('error', () => resolve(''));
        req.end();
        setTimeout(() => { try { req.destroy(); } catch { }; resolve(''); }, timeoutMs);
    });
}

module.exports = { getRadioNowPlaying };
