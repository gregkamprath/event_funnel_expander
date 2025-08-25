import { createStealthContext } from './stealth.js'
import { humanDelay, autoScroll } from './helpers.js'
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { URL } from 'url';

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

    // return cleanedHtml; // temporarily doing just html instead of markdown
    return turndownService.turndown(cleanedHtml);
}

export async function fetchPageHtml(url) {
    const { browser, context } = await createStealthContext();
    let page;

    try {
        page = await context.newPage();

        await humanDelay(500, 1500);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await humanDelay(5000, 6000);
        await autoScroll(page);
        await humanDelay(5000, 6000);

        // decide based on domain
        const domain = new URL(url).hostname;
        let html;

        if (domain.includes('encoreglobal.com')) {
            // special case: grab all `.newexhibit` nodes and join them
            const exhibits = page.locator('.newexhibit');
            const count = await exhibits.count();

            let parts = [];
            for (let i = 0; i < count; i++) {
                const partHtml = await exhibits.nth(i).innerHTML();
                parts.push(partHtml);
            }

            html = parts.join('\n');
        } else {
            // fallback: full DOM
            html = await page.content();
        }

        console.log('Inner HTML:', html?.slice(0,500));

        const markdown = html ? htmlToMarkdown(html) : null;

        return { url, html: html, markdown, error: null };
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