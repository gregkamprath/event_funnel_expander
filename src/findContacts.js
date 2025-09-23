import { chromium } from "playwright";

function normalizeWebsite(url) {
  if (!url) return "";

  try {
    if (!/^https?:\/\//i.test(url)) {
      url = "http://" + url;
    }

    const { hostname } = new URL(url);
    return hostname.replace(/^www\./i, "");
  } catch (e) {
    console.error("Invalid URL:", url, e);
    return "";
  }
}

async function openZoomInfoWithProfile() {
  const account = {
    website: "https://www.axis.com/"
  };

  const userDataDir = "./user-data-zoominfo";

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--start-maximized"],
    viewport: null,
  });

  const [page] = context.pages().length ? context.pages() : [await context.newPage()];
  // await page.goto("https://app.zoominfo.com/#/apps/search/v2", { waitUntil: "networkidle" }); // sometimes never idle
  await page.goto("https://app.zoominfo.com/#/apps/search/v2", { waitUntil: "domcontentloaded" });


  // Open "Company Name" filter
  await page.waitForSelector('button[data-automation-id="companyNameUrlTicker_label"]', { state: "visible" });
  await page.click('button[data-automation-id="companyNameUrlTicker_label"]');

  // Input field inside autocomplete
  const inputSelector = 'zic-auto-complete input[placeholder="Enter company name, URL or ticker"]';
  const input = page.locator(inputSelector).first();

  await input.waitFor({ state: "visible" });

  // Usage in your playwright code
  const cleanedWebsite = normalizeWebsite(account.website);

  // Type normalized website into field
  await input.click({ force: true });
  await input.fill(""); // clear any existing value
  await input.type(cleanedWebsite, { delay: 50 });

  // Confirm with Enter
  await page.keyboard.press("Enter");

  // Wait for and click the "Job Title & Role" filter button
  await page.waitForSelector('button[data-automation-id="currentRole_label"]', { state: "visible" });
  await page.click('button[data-automation-id="currentRole_label"]');

  // Wait for the Job Title input to appear
  const jobTitleInputSelector = 'input[data-automation-id="currentRole-filter-jobTitle-input"]';
  await page.waitForSelector(jobTitleInputSelector, { state: "visible" });

  // Focus on the input
  const titleInput = await page.$(jobTitleInputSelector);

  const jobTitles = ["event", "meeting", "conference"];
  for (const title of jobTitles) {
    await titleInput.type(title, { delay: 50 }); // type the word
    await page.keyboard.press("Enter");     // confirm with Enter
    await page.waitForTimeout(200);         // small delay to ensure it's processed
  }

// Wait until at least one result row is in the DOM
await page.waitForSelector('tr.result-row', { timeout: 5000 }); // waits up to 5 seconds

// Select all result rows
const rows = await page.$$('tr.result-row');

// Map each row into an object
const results = [];
for (const row of rows) {
    const name = await row.$eval(
        'a[data-automation-id="contact-column-contact-name"] span[data-automation-id="card-name"]',
        el => el.textContent.trim()
    );

    const jobTitle = await row.$eval(
        'div.job-title__container span[data-automation-id="card-name"]',
        el => el.textContent.trim()
    );

    const company = await row.$eval(
        'div.company-name-container a span[data-automation-id="card-name"]',
        el => el.textContent.trim()
    );

    const accuracy = await row.$eval(
        'zi-confidence-score .tooltip-content',
        el => el.textContent.replace('Contact Accuracy Score: ', '').trim()
    );

    results.push({ name, jobTitle, company, accuracy });
}

console.log(results);

return { context, page };
}

openZoomInfoWithProfile().catch(console.error);
