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

async function detectFullVisibleDom(page) {
    return await page.evaluate(() => {
        const IGNORE_TAGS = ['HEADER','FOOTER','NAV','ASIDE','SCRIPT','STYLE','NOSCRIPT','IFRAME','FORM','ADS','SVG'];

        function isVisible(el) {
            const style = window.getComputedStyle(el);
            return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
        }

        function cloneVisibleDom(el) {
            if (!isVisible(el)) return null;
            if (IGNORE_TAGS.includes(el.tagName)) return null;

            // Create a shallow clone of the element
            const clone = document.createElement(el.tagName.toLowerCase());

            // Copy text nodes
            for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    clone.appendChild(document.createTextNode(node.textContent));
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const childClone = cloneVisibleDom(node);
                    if (childClone) clone.appendChild(childClone);
                }
            }

            // Copy relevant attributes (optional: you can add more if needed)
            for (const attr of ['class', 'id', 'data-*']) {
                if (el.hasAttribute(attr)) clone.setAttribute(attr, el.getAttribute(attr));
            }

            return clone;
        }

        const clonedBody = cloneVisibleDom(document.body);
        return clonedBody ? clonedBody.outerHTML : '';
    });
}


export async function fetchPageHtml(url) {
    const { browser, context } = await createStealthContext();
    let page;

    try {
        page = await context.newPage();

        // Add random delay before navigating
        await humanDelay(500, 1500);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        // await page.goto(url, {
        //     waitUntil: "networkidle",  // Playwright-compatible
        //     timeout: 45000,
        // });

        // Wait a little for JS to render content
        await page.waitForTimeout(3000);
        await autoScroll(page);
        await humanDelay(2000, 4000);

        // Use evaluate instead of page.content() to avoid destroyed context issues
        await page.screenshot({ path: "debug.png", fullPage: true });
        const renderedHtml = await detectFullVisibleDom(page);
        const markdown = htmlToMarkdown(renderedHtml);
        
        return { url, html: renderedHtml, markdown, error: null };
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