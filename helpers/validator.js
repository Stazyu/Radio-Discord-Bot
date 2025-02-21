/**
 * Checks if a given string is a valid URL.
 * 
 * @param {string} str - The string to be tested.
 * @returns {boolean} - Returns true if the string is a valid URL, otherwise false.
 */

function isUrl(str) {
    const urlRegex = /^(?:http(s)?:\/\/)?[\w.-]+(?:\.[\w\.-]+)+[\w\-\._~:/?#[\]@!$&'()*+,;=]+$/;
    return urlRegex.test(str);
}

module.exports = {
    isUrl
}