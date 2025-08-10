import { createStealthContext } from './stealth.js'
import { humanDelay } from './helpers.js'

export async function fetchPageHtml(url) {
    const { browser, context } = await createStealthContext();
    const results = { url };

    try {
        const page = await context.newPage();

        // Add random delay before navigating
        await humanDelay(500, 1500);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Add random delay after navigation
        await humanDelay(500, 1500);

        results.html = await page.content();
        await page.close();
    } catch (err) {
        results.error = err.message;
    } finally {
        await browser.close();
    }
    return results;
}