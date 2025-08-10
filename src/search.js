import { createStealthContext } from './stealth.js'
import { humanDelay } from './helpers.js'

export async function searchDuckDuckGo(query, limit = 3) {
    const { browser, context } = await createStealthContext();
    const page = await context.newPage();

    await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="q"]', query);
    await humanDelay();
    await page.keyboard.press('Enter');

    await page.waitForSelector('ol.react-results--main', { timeout: 15000 });
    await humanDelay();

    const links = await page.$$eval(
        'ol.react-results--main li[data-layout="organic"] a[href]',
        (anchors, limit) => {
            const filtered = anchors
                .map(a => a.href)
                .filter(href => href && !href.startsWith('https://duckduckgo.com'))
                .filter((href, idx, self) => self.indexOf(href) === idx); // deduplicate

            // If fewer than limit results, return them all
            return filtered.slice(0, Math.min(limit, filtered.length));
        },
        limit
    );

    await browser.close();
    return links;
}