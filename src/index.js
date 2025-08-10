const { searchDuckDuckGo } = require('./search');
const { fetchPagesHtml } = require('./fetch');

(async () => {
    const query = 'Zscaler - Zenith Live 2025 Las Vegas June';
    const links = await searchDuckDuckGo(query, 3);
    console.log('Search results:', links);

    const pages = await fetchPagesHtml(links);
    for (const { url, html, error } of pages) {
        console.log(`\n=== ${url} ===`);
        if (error) console.error('Error:', error);
        else console.log(html.substring(0, 500));
    }
})();
