const { chromium } = require('playwright');
const { userAgents } = require('./config');

async function createStealthContext() {
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    const viewport = {
        width: 1280 + Math.floor(Math.random() * 50),
        height: 800 + Math.floor(Math.random() * 50),
    };

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: ua,
        viewport,
    });

    await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media'].includes(type)) route.abort();
        else route.continue();
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    });

    return { browser, context };
}

module.exports = { createStealthContext };
