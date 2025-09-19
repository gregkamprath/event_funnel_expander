import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';
import { queryLLM, truncateToTokenLimit, buildEventExtractionPrompt } from './llm.js';
import { loadPrompt } from "./prompts.js";
import { saveReadingsOutput, saveEventComparison, saveLoopOutput, saveLoopsOutput, saveEntireOutput } from './files.js';
import { getOrCreateLink, createReading, checkReadingMatch, eventMergeReadings, updateEventAutoExpanded} from './rails.js';

const eventId = process.argv[2];           // optional event id
const runCount = parseInt(process.argv[3] || "", 10); // number of times to run

const extractionPrompt = loadPrompt("extract_event_info");
const BASE_URL = process.env.BASE_URL;
const RUN_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-nano';

// Blocklist as regex patterns
const BLOCKLIST = [
  { type: "domain", pattern: /(^|\.)investing\.com$/i, reason: "Blocked domain: investing.com - it crashes browser" },
  { type: "domain", pattern: /(^|\.)financy.yahoo\.com$/i, reason: "Blocked domain: finance.yahoo.com - it crashes browser" },
  { type: "url", pattern: /\.pdf$/i, reason: "Blocked file type: PDF" }
];

function getBaseDomain(hostname) {
  // strip "www." and subdomains → "example.com"
  const parts = hostname.split('.');
  return parts.slice(-2).join('.'); 
}

function moveDomainToEnd(links, badUrl) {
  const badHost = getHostname(badUrl);
  const badBase = getBaseDomain(badHost);

  // Stable partition: keep everything not matching first, then matching
  const matching = [];
  const rest = [];

  for (const link of links) {
    if (link === badUrl) continue; // skip the bad link itself

    const base = getBaseDomain(getHostname(link));
    if (base === badBase) {
      matching.push(link);
    } else {
      rest.push(link);
    }
  }

  return [...rest, ...matching];
}

function getHostname(url) {
  try {
    return new URL(url).hostname; // e.g. "www.investing.com"
  } catch {
    return ""; // in case it's a malformed URL
  }
}

function getBlockReason(url) {
  const hostname = getHostname(url);

  for (const { type, pattern, reason } of BLOCKLIST) {
    if (type === "domain" && pattern.test(hostname)) {
      return reason;
    }
    if (type === "url" && pattern.test(url)) {
      return reason;
    }
  }

  return null; // not blocked
}

function compare(originalEvent, mergedEvent) {
    // Collect all unique keys from both objects
  const keys = new Set([...Object.keys(originalEvent), ...Object.keys(mergedEvent)]);
  const comparison = {};

  for (const key of keys) {
    comparison[key] = {
      original: originalEvent[key] ?? null,
      merged: mergedEvent[key] ?? null
    };
  }
  return comparison;
}

async function expandOneEvent(eventId) {
    let loop = { };
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let matchesFound = 0;
    let allReadings = [];
    let matchingReadings = [];
    let linkIterations = [];
    let readLinks = [];


    // 1. Fetch target event from Rails API
    let url;

    if (eventId) {
        url = `${BASE_URL}/events/${eventId}`;
    } else {
        url = `${BASE_URL}/events/next_to_auto_expand`;
    }

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
    let links = await searchDuckDuckGo(event.search_string, 10);
    linkIterations.push(links);
    console.log("Search results (raw):\n", links);

    // Apply blocklist with logging
    let newLinks = links.filter(url => {
    const reason = getBlockReason(url);
    if (reason) {
        console.log(`❌ Excluded: ${url} → ${reason}`);
        return false;
    }
    return true;
    });
    if (newLinks != links) {
      linkIterations.push(newLinks);
    }
    links = newLinks;

    console.log("Search results (filtered):\n", links);

  // 3. Iterate over links in chunks, stop once 3 matches found
    const limit = pLimit(2);
    const MAX_INPUT_TOKENS = 32000;

    while (links.length > 0 && matchesFound < 3) {
        console.log(`\n========================================================`);
        const url = links.shift();

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

        console.log(`Sending cleaned content from ${url} to LLM...`);

        // Build prompt
        const prePrompt = buildEventExtractionPrompt(extractionPrompt, event, markdown);
        const truncatedPrompt = truncateToTokenLimit(prePrompt, MAX_INPUT_TOKENS);

        // Query LLM
        const { parsed: result, inputTokens, outputTokens } = await queryLLM(truncatedPrompt, 3, RUN_MODEL);
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        const link = await getOrCreateLink(url).catch(console.error);
        readLinks.push(url);

        if (Array.isArray(result)) {
            let matchesInPage = 0;

            if (result.length === 0) {
              console.log(`No events found at ${url}, moving ${getHostname(url)} domain to the end`);
              links = moveDomainToEnd(links, url);
              linkIterations.push(links)
              console.log("Re-ordered search results:\n", links);
              continue
            }

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
                        ...savedReading,
                        matches: isMatch,
                        link_url: url
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

    // Pricing in $ per 1M tokens (defaults; override with env if you like)
    const MODEL_PRICING = {
        'gpt-4.1-mini': { inputPer1M: 0.80, outputPer1M: 3.20 },
        // add others if you may use them
        'gpt-4.1': { inputPer1M: 3.00, outputPer1M: 12.00 },
        'gpt-4.1-nano': { inputPer1M: 0.20, outputPer1M: 0.80 },
    };
    const pricing = MODEL_PRICING[RUN_MODEL];
    const costInput = (totalInputTokens / 1_000_000) * pricing.inputPer1M;
    const costOutput = (totalOutputTokens / 1_000_000) * pricing.outputPer1M;
    const totalCost = costInput + costOutput;

    let eventComparison = {}
    try {
        const mergedEvent = await eventMergeReadings(event.id);
        eventComparison = compare(event, mergedEvent);
    } catch (err) {
        console.error("Error merging readings in Rails:", err.message);
    }

    await updateEventAutoExpanded(event.id, true);

    console.log(`Finished processing. Total matches: ${matchesFound}`);
    console.log(`Total input tokens: ${totalInputTokens}`);
    console.log(`Total output tokens: ${totalOutputTokens}`);
    console.log(`Estimated cost: $${totalCost.toFixed(6)} (input $${costInput.toFixed(6)} + output $${costOutput.toFixed(6)})`);
    loop.event = {
        id: event.id,
        event_name: event.event_name,
        search_string: event.search_string
      },
    loop.results = {
      matchesFound: matchesFound,
      totalInputTokens: totalInputTokens,
      totalOutputTokens: totalOutputTokens,
      costInput: costInput,
      costOutput: costOutput,
      cost: totalCost,
    }
    loop.eventComparison = eventComparison;
    loop.linkIterations = linkIterations;
    loop.readLinks = readLinks;
    loop.readings = allReadings;
    await saveLoopOutput(loop);
    return loop;
}

(async () => {

}) ();

(async () => {
  let loops = [];
  let grandInputTokens = 0;
  let grandOutputTokens = 0;
  let grandCost = 0;

  for (let i = 0; i < runCount; i++) {
    console.log(`\n========== Run ${i + 1} of ${runCount} ==========\n`);
    const result = await expandOneEvent(eventId);
    loops.push(result);

    grandInputTokens += result.results.totalInputTokens;
    grandOutputTokens += result.results.totalOutputTokens;
    grandCost += result.results.cost;
  }

  const avgInputTokens = grandInputTokens / runCount;
  const avgOutputTokens = grandOutputTokens / runCount;
  const avgCost = grandCost / runCount;

  const totalResults = {
    results: {
      runCount: runCount,
      grandInputTokens: grandInputTokens,
      grantOutputTokens: grandOutputTokens,
      grandCost: grandCost,
      avgInputTokens: avgInputTokens,
      avgOutputTokens: avgOutputTokens,
      avgCost: avgCost
    },
    loops: loops
  }
  await saveLoopsOutput(totalResults);

  console.log("\n========== Final Summary ==========");
  console.log(`Total loops: ${runCount}`);
  console.log(`Total input tokens: ${grandInputTokens}`);
  console.log(`Total output tokens: ${grandOutputTokens}`);
  console.log(`Total cost: $${grandCost.toFixed(6)}`);
  console.log(`Average input tokens per loop: ${avgInputTokens.toFixed(2)}`);
  console.log(`Average output tokens per loop: ${avgOutputTokens.toFixed(2)}`);
  console.log(`Average cost per loop: $${avgCost.toFixed(6)}`);
})();