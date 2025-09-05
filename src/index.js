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

    let event;
    try {
        event = await response.json();
        console.log("Event:" , event);
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
            console.log(`\n======================================================== \nSending cleaned content from \n${url} \nto LLM...`);
            
            if (typeof markdown !== 'string') {
                console.warn('Warning: markdown is not a string:', markdown);
            } else {
                const MAX_INPUT_TOKENS = 32000;

                const targetEventContext = `
                We are trying to find references to a target event, which may have partial or mixed information. Here is the target event:

                {
                    "event_name": "${event.event_name}",
                    "event_name_casual": "${event.event_name_casual}",
                    "organization_name": "${event.organization_name}",
                    "start_date": "${event.start_date}",
                    "end_date": "${event.end_date}",
                    "city": "${event.city}",
                    "state": "${event.state}",
                    "venue": "${event.venue}"
                }

                For each extracted event, include an additional boolean field:
                "matches_target_event": true | false

                Rules for matching:
                - Return true if the extracted event likely refers to the same event as the target event.
                - Sometimes the extracted dates may be similar to the target event but not identical.
                - Sometimes the target event name may include the organization name as well as the event name, or may be just the organization name instead of the event name.
                - If the extracted event is unlikely to refer to the target event then return false.
                `;

                // const prePrompt = `${extractionPrompt}\n\n${markdown}`;
                const prePrompt = `${extractionPrompt}\n\n${targetEventContext}\n\n${markdown}`;

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