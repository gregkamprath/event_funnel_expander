import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';
import { queryLLM, truncateToTokenLimit, buildEventExtractionPrompt } from './llm.js';
import { loadPrompt } from "./prompts.js";
import { saveOutputs } from './files.js';
import { getOrCreateLink, createReading, updateEventAutoExpanded } from './rails.js';

const extractionPrompt = loadPrompt("extract_event_info");

const BASE_URL = process.env.BASE_URL;

(async () => {
    // 1. Fetch target event from Rails API
    const url = `${BASE_URL}/events/next_to_auto_expand`;
    const response = await fetch(
        url,
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
        if (matchesFound >= 1) {
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
        await getOrCreateLink(url).then(console.log).catch(console.error);


        // Count matches
        try {
            // const parsed = JSON.parse(result);
            const parsed = result;

            if (Array.isArray(parsed)) {
                const matchingEvents = parsed.filter(ev => ev.matches_target_event === true);

                for (const ev of matchingEvents) {
                    try {
                        // First make sure link exists in Rails
                        const link = await getOrCreateLink(url);

                        // Build reading payload
                        const readingData = {
                            event_name: ev.event_name,
                            event_name_casual: ev.event_name_casual,
                            organization_name: ev.organization_name,
                            organization_name_abbreviated: ev.organization_name_abbreviated,
                            organization_link: ev.organization_link,
                            // year: ev.year,
                            // month: ev.month,
                            start_date: ev.start_date,
                            end_date: ev.end_date,
                            city: ev.city,
                            state: ev.state,
                            venue: ev.venue,
                            // attendees: ev.attendees,
                            event_id: event.id,   // from the Rails "target event"
                            link_id: link.id,     // from getOrCreateLink
                            link_for_more_information: ev.link_for_more_information
                        };

                        const savedReading = await createReading(readingData);
                        console.log("Saved Reading:", savedReading.id);
                    } catch (err) {
                        console.error("Error saving reading:", err.message);
                    }
                }

                matchesFound += matchingEvents.length;
                console.log(
                    `Matches found in this page: ${matchingEvents.length}, total so far: ${matchesFound}`
                );
            }
        } catch (err) {
            console.warn("Could not parse JSON result:", err.message);
        }
    }
    await updateEventAutoExpanded(event.id, true);
    console.log(`Finished processing. Total matches: ${matchesFound}`);
}) ();