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

    // 2. Search up to 10 candidate pages
    const links = await searchDuckDuckGo(event.search_string, 10);
    console.log("Search results:", links);

  // 3. Iterate over links in chunks, stop once 3 matches found
    const limit = pLimit(2);
    const MAX_INPUT_TOKENS = 32000;
    let matchesFound = 0;

    for (const url of links) {
        if (matchesFound >= 3) {
            console.log("✅ Found 3 matching events — stopping early.");
            break;
        }

        console.log(`Fetching: ${url}`);
        const { markdown, error } = await limit(() => fetchPageHtml(url));

        if (error) {
            console.error(`Error fetching ${url}:`, error);
            continue;
        }

        if (typeof markdown !== 'string') {
            console.warn("Warning: markdown is not a string:", markdown);
            continue;
        }

        console.log(`\n========================================================`);
        console.log(`Sending cleaned content from ${url} to LLM...`);

        // Build prompt
        const prePrompt = buildEventExtractionPrompt(extractionPrompt, event, markdown);
        const truncatedPrompt = truncateToTokenLimit(prePrompt, MAX_INPUT_TOKENS);

        // Query LLM
        const result = await queryLLM(truncatedPrompt);

        // Save outputs
        const { mdFilePath, jsonFilePath } = saveOutputs(url, markdown, result);
        console.log(`Saved Markdown to ${mdFilePath}`);
        console.log(`Saved JSON to ${jsonFilePath}`);

        // Count matches
        try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
                const newMatches = parsed.filter(ev => ev.matches_target_event === true).length;
                matchesFound += newMatches;
                console.log(`Matches found in this page: ${newMatches}, total so far: ${matchesFound}`);
            }
        } catch (err) {
            console.warn("Could not parse JSON result:", err.message);
        }
    }

    console.log("Finished processing. Total matches: ${matchesFound}");
}) ();