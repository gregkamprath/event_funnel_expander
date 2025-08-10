async function humanDelay(min = 100, max = 400) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(res => setTimeout(res, delay));
}

module.exports = { humanDelay };
