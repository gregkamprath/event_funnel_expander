import { createStealthContext } from './stealth.js'
import { humanDelay, autoScroll } from './helpers.js'
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

function htmlToMarkdown(html) {
    const $ = cheerio.load(html);

    // Remove noise / non-content elements
    $('script, style, noscript, header, footer, nav, aside, iframe, form, ads, svg').remove();

    // Extract cleaned HTML body
    const cleanedHtml = $('body').html() || '';

    // Convert to Markdown
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-'
    });

    // return cleanedHtml;
    return turndownService.turndown(cleanedHtml);
}

export async function fetchPageHtml(url) {
    const { browser, context } = await createStealthContext();
    let page

    try {
        page = await context.newPage();

        // Add random delay before navigating
        await humanDelay(500, 1500);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await autoScroll(page);

        // Add random delay after navigation
        await humanDelay(500, 1500);

        const html = await page.content();
        const markdown = htmlToMarkdown(html);
        
        return { url, html, markdown, error: null };
    } catch (error) {
        return { url, html: null, markdown: null, error: error.message }
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (e) {
                console.warn('Failed to close page', e);
            }
        }
        await browser.close();
    }
}