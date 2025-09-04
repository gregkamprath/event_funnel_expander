import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import fs from "fs";
import path from 'path';

import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';
import { queryLLM, countTokens, truncateToTokenLimit } from './llm.js';

import { loadPrompt } from "./prompts.js";

const extractionPrompt = loadPrompt("extract_event_info");

(async () => {
    const limit = pLimit(2);

    // Use CLI args if provided, otherwise fall back to default
    const argLinks = process.argv.slice(2);
    let links = argLinks.length > 0
        ? argLinks
        : ['https://eventnow.encoreglobal.com/landingpage/newexhibit/index/?v=cd67d37d-360b-e411-9406-00155dcfc111'];


    // Wrap each fetch call with the concurrency limiter
    const fetchPromises = links.map(link => 
        limit(async () => {
            console.log(`Fetching: ${link}`);
            const result = await fetchPageHtml(link);
            return result;
        })
    );

    // Wait for all fetches to finish
    const pages = await Promise.all(fetchPromises);

    for (const { url, markdown, error } of pages) {
        if (error) {
            console.error(`Error fetching ${url}:`, error);
        } else {
            console.log(`\n======================================================== \nSending cleaned content from \n${url} \nto LLM...`);

            if (typeof markdown !== 'string') {
                console.warn('Warning: markdown is not a string:', markdown);
            } else {
                const MAX_INPUT_TOKENS = 32000;

                const prePrompt = `${extractionPrompt}\n\n${markdown}`;

                const truncatedPrompt = truncateToTokenLimit(prePrompt, MAX_INPUT_TOKENS);                
                const result = await queryLLM(truncatedPrompt);

                // ---------- Save output to file ----------
                const timestamp = new Date().toISOString().replace(/:/g, "-");
                const safeName = url.replace(/[^a-z0-9]/gi, "_").slice(0, 80); // prevent overly long names
                fs.mkdirSync("outputs", { recursive: true }); // ensure output dir exists

                // Markdown file
                const mdFilePath = path.join("outputs", `${timestamp + "_" + safeName}.md`);
                fs.writeFileSync(mdFilePath, markdown, "utf-8");
                console.log(`Saved Markdown to ${mdFilePath}`);

                // JSON file
                const jsonFilePath = path.join("outputs", `${timestamp + "_" + safeName}.json`);
                fs.writeFileSync(jsonFilePath, result, "utf-8");
                console.log(`Saved JSON to ${jsonFilePath}`);
            }
        }
    }
})();