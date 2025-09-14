// state/radioState.js
// Simpan state per guild: { conn, player, ffmpeg }
const radioState = new Map();

module.exports = {
    get(guildId) {
        return radioState.get(guildId);
    },
    set(guildId, payload) {
        radioState.set(guildId, payload);
    },
    clear(guildId) {
        radioState.delete(guildId);
    }
};