import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';
import { queryLLM, truncateToTokenLimit, buildEventExtractionPrompt } from './llm.js';
import { loadPrompt } from "./prompts.js";
import { saveMarkdownOutput, saveReadingsOutput } from './files.js';
import { getOrCreateLink, createReading, checkReadingMatch, eventMergeReadings, updateEventAutoExpanded } from './rails.js';

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
    const allReadings = [];
    let matchesFound = 0;
    let matchingReadings = [];

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
        const { mdFilePath } = saveMarkdownOutput(url, markdown);
        console.log(`Saved Markdown to ${mdFilePath}`);

        const link = await getOrCreateLink(url).catch(console.error);

        if (Array.isArray(result)) {
            let matchesInPage = 0;

            for (const ev of result) {
                try {
                    // Save the reading first (event_id null for now)
                    const readingData = {
                        event_name: ev.event_name,
                        event_name_casual: ev.event_name_casual,
                        organization_name: ev.organization_name,
                        organization_name_abbreviated: ev.organization_name_abbreviated,
                        organization_link: ev.organization_link,
                        start_date: ev.start_date,
                        end_date: ev.end_date,
                        city: ev.city,
                        state: ev.state,
                        venue: ev.venue,
                        link_for_more_information: ev.link_for_more_information,
                        link_id: link.id,
                        event_id: null
                    };

                    const savedReading = await createReading(readingData);
                    console.log(`Saved Reading: ${savedReading.id}`);

                    // Call Rails to check if it matches the target event
                    const checkMatchResponse = await checkReadingMatch(savedReading.id, event.id);
                    const isMatch = checkMatchResponse.matches;

                    // If it matches, update the reading with event_id
                    if (isMatch) {
                        matchesInPage++;
                        matchingReadings.push(savedReading);
                    }

                    allReadings.push({
                        ...readingData,
                        matches: isMatch
                    });

                    console.log(`Reading ${savedReading.id} match status: ${isMatch ? 'matched' : 'not matched'}`);
                } catch (err) {
                    console.error("Error processing reading:", err.message);
                }
            }

            matchesFound += matchesInPage;
            console.log(`Matches found in this page: ${matchesInPage}, total so far: ${matchesFound}`);
        }
    }

    await saveReadingsOutput(allReadings);

    try {
        const mergedEvent = await eventMergeReadings(event.id);
        console.log("Merged event:", mergedEvent);
    } catch (err) {
        console.error("Error merging readings in Rails:", err.message);
    }

    await updateEventAutoExpanded(event.id, true);
    console.log(`Finished processing. Total matches: ${matchesFound}`);
}) ();