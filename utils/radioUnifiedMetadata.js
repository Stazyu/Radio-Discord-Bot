// utils/radioMetadataUnified.js
const http = require('http');
const https = require('https');

function getText(u, { tlsBypass = false, timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(u);
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.get({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + (url.search || ''),
            method: 'GET',
            timeout,
            headers: { 'User-Agent': 'DiscordRadioBot/1.0' },
            ...(tlsBypass && url.protocol === 'https:' ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {})
        }, (res) => {
            if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
            let data = '';
            res.setEncoding('utf8');
            res.on('data', d => (data += d));
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
    });
}
async function getJson(u, opt) { return JSON.parse(await getText(u, opt)); }

function makeBase(url) {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
}

function startInterval(fn, ms) {
    let stopped = false, t;
    const tick = async () => {
        if (stopped) return;
        try { await fn(); } finally { if (!stopped) t = setTimeout(tick, ms); }
    };
    tick();
    return { stop() { stopped = true; clearTimeout(t); } };
}

/** --------- Shoutcast helpers ---------- */
async function probeShoutcastDirect(statsUrl, opt) {
    try {
        const j = await getJson(statsUrl, opt);
        const title = (j?.songtitle || j?.streamtitle || j?.title || '').trim();
        return title ? { ok: true, title, mode: 'sc-direct', statsUrl } : { ok: false };
    } catch { return { ok: false }; }
}
async function probeShoutcastGuessed(base, opt) {
    // coba /stats?sid=1&json=1 lalu /stats?json=1
    for (const path of ['/stats?sid=1&json=1', '/stats?json=1']) {
        try {
            const j = await getJson(new URL(path, base).toString(), opt);
            if (Array.isArray(j?.streams)) {
                console.log('[DEBUG] shoutcast guessed multiple streams:', j.streams.length);

                const s = j.streams.find(x => x.songtitle || x.streamtitle) || j.streams[0];
                const title = (s?.songtitle || s?.streamtitle || s?.title || '').trim();
                if (title) return { ok: true, title, mode: 'sc-guess', statsUrl: new URL(path, base).toString() };
            } else {
                // single stream
                console.log('[DEBUG] shoutcast guessed single stream', j);
                const title = (j?.songtitle || j?.streamtitle || j?.title || '').trim();
                if (title) return { ok: true, title, mode: 'sc-guess', statsUrl: new URL(path, base).toString() };
            }
        } catch { }
    }
    return { ok: false };
}

/** --------- Icecast helpers ---------- */
async function probeIcecast(base, mountHint, opt) {
    try {
        const j = await getJson(new URL('/status-json.xsl', base).toString(), opt);
        const srcs = j?.icestats?.source;
        const arr = Array.isArray(srcs) ? srcs : [srcs].filter(Boolean);
        let pick = null;
        if (mountHint) {
            pick = arr.find(s => {
                const listen = s?.listenurl || '';
                try { const u = new URL(listen); return u.pathname === mountHint || listen.includes(mountHint); }
                catch { return listen.includes(mountHint); }
            }) || null;
        }
        if (!pick) pick = arr[0];
        if (!pick) return { ok: false };
        const title = (pick.title || pick.artist || pick.server_name || '').trim();
        return title ? { ok: true, title, mode: 'icecast', statusUrl: new URL('/status-json.xsl', base).toString() } : { ok: false };
    } catch { return { ok: false }; }
}

/** --------- ICY raw (tanpa lib) ---------- */
function startIcyRaw(streamUrl, onChange, { tlsBypass = false } = {}) {
    const url = new URL(streamUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers: { 'Icy-MetaData': '1', 'User-Agent': 'DiscordRadioBot/1.0' },
        ...(tlsBypass && url.protocol === 'https:' ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {})
    };

    let req, stopped = false, last = null;
    req = lib.request(opts, (res) => {
        const metaint = parseInt(res.headers['icy-metaint'] || res.headers['icy-metaint'.toLowerCase()] || 'NaN', 10);
        if (!Number.isFinite(metaint)) { res.resume(); return; } // tidak ada ICY
        let bytesUntilMeta = metaint;
        let metaLenPending = -1;
        let metaBuf = Buffer.alloc(0);

        res.on('data', (chunk) => {
            if (stopped) return;
            let offset = 0;
            while (offset < chunk.length) {
                if (metaLenPending < 0) {
                    const consume = Math.min(bytesUntilMeta, chunk.length - offset);
                    offset += consume; bytesUntilMeta -= consume;
                    if (bytesUntilMeta === 0) {
                        if (offset >= chunk.length) { metaLenPending = null; break; }
                        const lenByte = chunk.readUInt8(offset); offset += 1;
                        const metaLen = lenByte * 16;
                        if (metaLen === 0) { bytesUntilMeta = metaint; metaLenPending = -1; }
                        else { metaLenPending = metaLen; metaBuf = Buffer.alloc(0); }
                    }
                } else {
                    if (metaLenPending === null) {
                        if (offset >= chunk.length) break;
                        const lenByte = chunk.readUInt8(offset); offset += 1;
                        const metaLen = lenByte * 16;
                        if (metaLen === 0) { bytesUntilMeta = metaint; metaLenPending = -1; }
                        else { metaLenPending = metaLen; metaBuf = Buffer.alloc(0); }
                    } else {
                        const take = Math.min(chunk.length - offset, metaLenPending);
                        metaBuf = Buffer.concat([metaBuf, chunk.subarray(offset, offset + take)]);
                        offset += take; metaLenPending -= take;
                        if (metaLenPending === 0) {
                            const s = metaBuf.toString('utf8').replace(/\0+$/g, '');
                            const m = /StreamTitle='([^']*)'/.exec(s);
                            const title = m ? m[1].trim() : '';
                            if (title && title !== last) { last = title; onChange(title, { source: 'icy' }); }
                            bytesUntilMeta = metaint; metaLenPending = -1; metaBuf = Buffer.alloc(0);
                        }
                    }
                }
            }
        });
    });
    req.on('error', () => { });
    req.end();

    return {
        stop() { stopped = true; try { req.destroy(); } catch { } }
    };
}

/**
 * Start unified metadata watcher.
 * Prioritas:
 *  1) statsUrl (Shoutcast langsung)
 *  2) Shoutcast guessed (base/stats)
 *  3) Icecast status-json.xsl
 *  4) ICY raw dari streamUrl
 *
 * @param {string} streamUrl URL yang sedang diputar (input untuk ICY & derive base/mount)
 * @param {(title:string, extra?:object)=>void} onChange callback saat judul berubah
 * @param {object} opts
 * @param {string} [opts.statsUrl] jika kamu tahu Shoutcast stats URL pasti (ex: https://host:port/stats?sid=1&json=1)
 * @param {boolean} [opts.tlsBypass=true]
 * @param {number} [opts.intervalMs=12000]
 */
async function startUnifiedRadioMetadata(streamUrl, onChange, { statsUrl, tlsBypass = true, intervalMs = 12000 } = {}) {
    const base = makeBase(streamUrl);
    const mount = new URL(streamUrl).pathname;

    // 1) Shoutcast direct (jika diberikan)
    if (statsUrl) {
        let last = null;
        const job = startInterval(async () => {
            try {
                const j = await getJson(statsUrl, { tlsBypass });
                const title = (j?.songtitle || j?.streamtitle || j?.title || '').trim();
                if (title && title !== last) { last = title; onChange(title, { mode: 'sc-direct' }); }
            } catch { }
        }, intervalMs);
        return { stop() { job.stop(); } };
    }

    // 2) Probe Shoutcast guessed
    const sc = await probeShoutcastGuessed(base, { tlsBypass });
    if (sc.ok && sc.statsUrl) {
        let last = sc.title || null;
        // emit awal jika ada
        if (last) onChange(last, { mode: 'sc-guess' });
        const job = startInterval(async () => {
            try {
                const j = await getJson(sc.statsUrl, { tlsBypass });
                const title = (j?.songtitle || j?.streamtitle || j?.title || '').trim();
                if (title && title !== last) { last = title; onChange(title, { mode: 'sc-guess' }); }
            } catch { }
        }, intervalMs);
        return { stop() { job.stop(); } };
    }

    // 3) Probe Icecast status-json
    const ic = await probeIcecast(base, mount, { tlsBypass });
    if (ic.ok && ic.statusUrl) {
        let last = ic.title || null;
        if (last) onChange(last, { mode: 'icecast' });
        const job = startInterval(async () => {
            try {
                const j = await getJson(ic.statusUrl, { tlsBypass });
                const srcs = j?.icestats?.source;
                const arr = Array.isArray(srcs) ? srcs : [srcs].filter(Boolean);
                let pick = arr.find(s => {
                    const listen = s?.listenurl || '';
                    try { const u = new URL(listen); return u.pathname === mount || listen.includes(mount); }
                    catch { return listen.includes(mount); }
                }) || arr[0];
                const title = (pick?.title || pick?.artist || pick?.server_name || '').trim();
                if (title && title !== last) { last = title; onChange(title, { mode: 'icecast' }); }
            } catch { }
        }, intervalMs);
        return { stop() { job.stop(); } };
    }

    // 4) ICY raw fallback
    const icy = startIcyRaw(streamUrl, onChange, { tlsBypass });
    return { stop() { icy.stop(); } };
}

module.exports = { startUnifiedRadioMetadata };