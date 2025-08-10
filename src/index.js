const { searchDuckDuckGo } = require('./search');
const { fetchPageHtml } = require('./fetch');

(async () => {
    const query = 'Zscaler - Zenith Live 2025 Las Vegas June';
    const links = await searchDuckDuckGo(query, 3);
    console.log('Search results:', links);

    // Map each link to a fetch promise
    const fetchPromises = links.map(async (link) => {
        console.log(`Fetching: ${link}`);
        const result = await fetchPageHtml(link);
        return result;
    });

    // Wait for all fetches to finish
    const pages = await Promise.all(fetchPromises);

    for (const { url, html, error } of pages) {
        if (error) {
        console.error(`Error fetching ${url}:`, error);
        } else {
        console.log(`Fetched HTML for ${url}:\n`, html.substring(0, 500));
        }
    }

    // for (const link of links) {
    //     console.log(`\nFetching: ${link}`);
    //     const { url, html, error } = await fetchPageHtml(link);

    //     if (error) {
    //         console.error(`Error fetching ${url}:`, error);
    //     } else {
    //         console.log(`Fetched HTML for ${url}:\n`, html.substring(0, 500));
    //     }

    //     // Small delay between requests
    //     await new Promise(res => setTimeout(res, 1500));
    // }
})();