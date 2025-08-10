import pLimit from 'p-limit';
import { searchDuckDuckGo } from './search.js';
import { fetchPageHtml } from './fetch.js';

(async () => {
    const query = 'Zscaler - Zenith Live 2025 Las Vegas June';
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

    for (const { url, html, error } of pages) {
        if (error) {
        console.error(`Error fetching ${url}:`, error);
        } else {
        console.log(`Fetched HTML for ${url}:\n`, html.substring(0, 500));
        }
    }
})();