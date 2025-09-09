import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';
import { queryLLM, truncateToTokenLimit, buildEventExtractionPrompt } from './llm.js';
import { loadPrompt } from "./prompts.js";
import { saveOutputs } from './files.js';
import { getOrCreateLink, getOrCreateAccount, createReading, updateEventAutoExpanded } from './rails.js';

const extractionPrompt = loadPrompt("extract_event_info");

const BASE_URL = process.env.BASE_URL;

function normalizeTargetEvent(event) {
    return {
        event_name: event.event_name,
        event_name_casual: event.event_name_casual,
        organization_name: event.account_name,
        organization_name_abbreviated: event.account_name_abbr,
        organization_link: event.account_url,
        start_date: event.start_date,
        end_date: event.end_date,
        city: event.city,
        state: event.state,
        venue: event.venue
    };
}

function mergeReadings(baseEvent, readings) {
    const merged = { ...baseEvent };

    // Simple helper: pick the most common non-empty value
    const pickConsensus = (field) => {
        const values = readings.map(r => r[field]).filter(Boolean);
        if (values.length === 0) return merged[field]; // keep existing
        const freq = values.reduce((acc, v) => {
            acc[v] = (acc[v] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    };

    merged.event_name   = pickConsensus("event_name");
    merged.event_name_casual = pickConsensus("event_name_casual");
    merged.organization_name = pickConsensus("organization_name");
    merged.organization_name_abbreviated = pickConsensus("organization_name_abbreviated");
    merged.organization_link = pickConsensus("organization_link");
    merged.start_date = pickConsensus("start_date");
    merged.end_date   = pickConsensus("end_date");
    merged.year       = pickConsensus("year");
    merged.month      = pickConsensus("month");
    merged.city       = pickConsensus("city");
    merged.state      = pickConsensus("state");
    merged.venue      = pickConsensus("venue");

    return merged;
}

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
        const { mdFilePath, jsonFilePath } = saveOutputs(url, markdown, result);
        console.log(`Saved Markdown to ${mdFilePath}`);
        console.log(`Saved JSON to ${jsonFilePath}`);
        await getOrCreateLink(url).catch(console.error);


        // Count matches
        try {
            const parsed = result;

            if (Array.isArray(parsed)) {
                let matchesInPage = 0;

                for (const ev of parsed) {
                    try {
                        // Track matches for logging
                        if (ev.matches_target_event) {
                            matchesInPage++;
                            matchingReadings.push(ev);
                        }

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
                            event_id: ev.matches_target_event ? event.id : null, // only set if matches
                            link_id: link.id,     // from getOrCreateLink
                            link_for_more_information: ev.link_for_more_information
                        };

                        const savedReading = await createReading(readingData);
                        console.log(`Saved Reading: ${savedReading.id} (${ev.matches_target_event ? 'matched' : 'not matched'})`);
                    } catch (err) {
                        console.error("Error saving reading:", err.message);
                    }
                }




                matchesFound += matchesInPage;
                console.log(`Matches found in this page: ${matchesInPage}, total so far: ${matchesFound}`);
            }
        } catch (err) {
            console.warn("Could not parse JSON result:", err.message);
        }
    }

    if (matchingReadings.length > 0) {
        console.log(`Merging ${matchingReadings.length} matching readings...`);
        const baseForMerge = normalizeTargetEvent(event);
        const mergedData = mergeReadings(baseForMerge, matchingReadings);
        console.log("The merged readings result in:");
        console.log(mergedData);

        // Step A: find/create account
        let account = null;
        if (mergedData.organization_name) {
            account = await getOrCreateAccount(
                mergedData.organization_name,
                mergedData.organization_name_abbreviated,
                mergedData.organization_link
            );
        }

        // Step B: Build event payload
        const updatePayload = {
            event: {
                event_name: mergedData.event_name,
                event_name_casual: mergedData.event_name_casual,
                year: mergedData.year,
                month: mergedData.month,
                start_date: mergedData.start_date,
                end_date: mergedData.end_date,
                city: mergedData.city,
                state: mergedData.state,
                venue: mergedData.venue,
                account_id: account ? account.id : event.account_id // attach org if found
            }
        };

        // Step C: Update event
        try {
            await fetch(`${BASE_URL}/events/${event.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(updatePayload)
            });
            console.log(`✅ Updated event ${event.id} with merged fields`);
        } catch (err) {
            console.error(`Failed to update event: ${err.message}`);
        }
    }

    await updateEventAutoExpanded(event.id, true);
    console.log(`Finished processing. Total matches: ${matchesFound}`);
}) ();