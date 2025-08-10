const { createStealthContext } = require('./stealth');
const { humanDelay } = require('./helpers');

async function fetchPagesHtml(urls) {
    const { browser, context } = await createStealthContext();
    const results = [];

    for (const link of urls) {
        const page = await context.newPage();
        try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await humanDelay();
            const html = await page.content();
            results.push({ url: link, html });
        } catch (err) {
            results.push({ url: link, error: err.message });
        } finally {
            await page.close();
        }
        await new Promise(res => setTimeout(res, 1500));
    }

    await browser.close();
    return results;
}

module.exports = { fetchPagesHtml };
