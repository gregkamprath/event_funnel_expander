import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';
import { queryLLM, truncateToTokenLimit, buildEventExtractionPrompt } from './llm.js';
import { loadPrompt } from "./prompts.js";
import { saveOutputs } from './files.js';

const extractionPrompt = loadPrompt("extract_event_info");

(async () => {
    // 1. Fetch target event from Rails API
    const response = await fetch(
        "https://floating-plains-26538.herokuapp.com/events/next_to_auto_expand",
        { headers: { "Accept": "application/json" } }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch event: ${response.statusText}`);
    }

    const event = await response.json();
    console.log("Target Event:", event);

    // 2. Search for candidate pages
    const links = await searchDuckDuckGo(event.search_string, 3);
    console.log("Search results:", links);

    // 3. Fetch pages concurrently (limit to 2 at a time)
    const limit = pLimit(2);
    const pages = await Promise.all(
        links.map(link => limit(() => fetchPageHtml(link)))
    );

    // 4. Process each page
    for (const { url, markdown, error } of pages) {
        if (error) {
            console.error(`Error fetching ${url}:`, error);
            continue;
        }
    
        console.log(`\n========================================================`);
        console.log(`Sending cleaned content from ${url} to LLM...`);

        if (typeof markdown !== 'string') {
            console.warn("Warning: markdown is not a string:", markdown);
            continue;
        }

        const MAX_INPUT_TOKENS = 32000;

        // Build full LLM prompt with target event context
        const prePrompt = buildEventExtractionPrompt(extractionPrompt, event, markdown);
        const truncatedPrompt = truncateToTokenLimit(prePrompt, MAX_INPUT_TOKENS);

        // Send to LLM
        const result = await queryLLM(truncatedPrompt);

        // Save outputs
        const { mdFilePath, jsonFilePath } = saveOutputs(url, markdown, result);
        console.log(`Saved Markdown to ${mdFilePath}`);
        console.log(`Saved JSON to ${jsonFilePath}`);
    }
}) ();