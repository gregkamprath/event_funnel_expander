import { createStealthContext } from './stealth.js'
import { humanDelay, autoScroll } from './helpers.js'
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { URL } from 'url';
import { saveMarkdownOutput, saveTextOutput } from './files.js';


function htmlToMarkdown(html) {
    const $ = cheerio.load(html);

    // Remove noise / non-content elements
    $('script, style, noscript, header, nav, aside, iframe, form, ads, svg').remove();

    // Extract cleaned HTML body
    const cleanedHtml = $('body').html() || '';

    // Convert to Markdown
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-'
    });

    return turndownService.turndown(cleanedHtml);
}

export async function fetchPageHtml(url) {
    const { browser, context } = await createStealthContext();
    let page;

    try {
        page = await context.newPage();

        await humanDelay(500, 1500);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await humanDelay(3000, 5000);
        await autoScroll(page);
        await humanDelay(3000, 5000);
        await autoScroll(page);
        await humanDelay(3000, 5000);


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

        let plaintext;
        try {
            plaintext = await page.evaluate(() => document.body ? document.body.innerText : "");
        } catch (e) {
            plaintext ="";
        }
        const markdown = html ? htmlToMarkdown(html) : null;

        // Save outputs
        const { mdFilePath } = saveMarkdownOutput(url, markdown);
        console.log(`Saved Markdown to ${mdFilePath}`);
        const { textPath } = saveTextOutput(url, plaintext);
        console.log(`Saved text to ${textPath}`);

        return { 
            url, 
            html: html, 
            markdown,
            plaintext,
            error: null 
        };
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

// If this file is run directly from the command line:
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node ./src/fetch.js <url>");
    process.exit(1);
  }

  (async () => {
    const result = await fetchPageHtml(url);

    if (result.error) {
      console.error("❌ Error fetching page:", result.error);
      process.exit(1);
    }
  })();
}
