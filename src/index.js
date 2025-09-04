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
// Fetch event object
    const response = await fetch("https://floating-plains-26538.herokuapp.com/events/next_to_auto_expand", {
        headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch event: ${response.statusText}`);
    }

    const text = await response.text();
    console.log("Response text preview:", text.slice(0, 200));

    let event;
    try {
        event = await response.json();
    } catch (err) {
        const text = await response.text();
        throw new Error(`Expected JSON but got:\n${text.slice(0, 500)}`);
    }

    const query = event.search_string;
    const links = await searchDuckDuckGo(query, 3);
    console.log('Search results:', links);

    // Create a limiter allowing 2 concurrent fetches, for example
    const limit = pLimit(2);

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
            console.log(`\n======================================================== \nSending cleaned content from ${url} to LLM...`);
            
            console.log('markdown type:', typeof markdown);

            if (typeof markdown !== 'string') {
                console.warn('Warning: markdown is not a string:', markdown);
            } else {
                const MAX_INPUT_TOKENS = 32000;

                const prePrompt = `${extractionPrompt}\n\n${markdown}`;

                const truncatedPrompt = truncateToTokenLimit(prePrompt, MAX_INPUT_TOKENS);                
                const result = await queryLLM(truncatedPrompt);

                console.log('LLM response:', result);

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