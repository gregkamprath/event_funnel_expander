const { chromium } = require('playwright');

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
];

// Human delay ====================================================================================
async function humanDelay(min = 100, max = 400) {
    console.log("Yup delayed");
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(res => setTimeout(res, delay));
}

// Create stealth context =========================================================================================================
async function createStealthContext() {
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

    // Randomize viewport size a bit
    const viewport = {
        width: 1280 + Math.floor(Math.random() * 50),
        height: 800 + Math.floor(Math.random() * 50),
    };

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: ua,
        viewport,
    });

    // Block images, fonts, media to speed up loading and avoid extra resource requests
    await context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
            route.abort();
        } else {
            route.continue();
        }
    });

    // Add stealth JS patches to be injected before any script runs
    await context.addInitScript(() => {
        // Pass the webdriver test
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // Pass the Chrome test
        window.chrome = { runtime: {} };

        // Pass the Permissions test
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);

        // Pass the Plugins Length test
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });

        // Pass the Languages test
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

        // Extra navigator properties
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    });

    return { browser, context, humanDelay };
}

// Search Duck Duck Go =============================================================================================================
async function searchDuckDuckGo(query, limit = 3) {
    const { browser, context } = await createStealthContext();
    
    const page = await context.newPage();

    await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="q"]', query);
    await humanDelay();
    await page.keyboard.press('Enter');

    // Wait for results container
    await page.waitForSelector('ol.react-results--main', { timeout: 15000 });
    await humanDelay();


    // Grab organic result links
    const links = await page.$$eval(
        'ol.react-results--main li[data-layout="organic"] a[href]',
        anchors => {
            return anchors
                .map(a => a.href)
                .filter(href => href && !href.startsWith('https://duckduckgo.com'))
                .filter((href, idx, self) => self.indexOf(href) === idx) // deduplicate
                .slice(0, 3);
        }
    );

    await browser.close();
    return links;
}

// Fetch pages ===============================================================================================================
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
        await new Promise(res => setTimeout(res, 1500)); // delay
    }

    await browser.close();
    return results;
}


// Main function =============================================================================================================
// Example usage
(async () => {
    const searchQuery = 'Zscaler - Zenith Live 2025 Las Vegas June';
    const links = await searchDuckDuckGo(searchQuery, 3);
    console.log('Search results:', links);

    const pages = await fetchPagesHtml(links);
    for (const { url, html, error } of pages) {
        console.log(`\n=== ${url} ===`);
        if (error) {
            console.error('Error:', error);
        } else {
            console.log(html.substring(0, 500));
        }
    }
})();
