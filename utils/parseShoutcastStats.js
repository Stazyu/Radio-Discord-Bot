// utils/parseShoutcastStats.js
function secondsToHMS(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h || parts.length) parts.push(`${h}h`);
    if (m || parts.length) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

/**
 * @param {object} j JSON dari /stats?sid=1&json=1
 * @returns {{
 *   title: string,
 *   serverTitle?: string,
 *   genre?: string,
 *   listeners?: number,
 *   peakListeners?: number,
 *   uniqueListeners?: number,
 *   bitrate?: number,
 *   sampleRate?: number,
 *   contentType?: string,
 *   streamPath?: string,
 *   uptimeSec?: number,
 *   uptimeHuman?: string,
 *   raw: any
 * }}
 */
function parseShoutcastStats(j) {
    const title = (j?.songtitle || j?.streamtitle || j?.title || '').trim();
    const bitrate = Number(j?.bitrate) || undefined;
    const sampleRate = Number(j?.samplerate) || undefined;
    const uptime = Number(j?.streamuptime) || undefined;

    return {
        title,
        serverTitle: j?.servertitle,
        genre: j?.servergenre,
        listeners: Number(j?.currentlisteners) || 0,
        peakListeners: Number(j?.peaklisteners) || 0,
        uniqueListeners: Number(j?.uniquelisteners) || undefined,
        bitrate,
        sampleRate,
        contentType: j?.content,
        streamPath: j?.streampath,
        uptimeSec: uptime,
        uptimeHuman: uptime !== undefined ? secondsToHMS(uptime) : undefined,
        raw: j
    };
}

module.exports = { parseShoutcastStats, secondsToHMS };
