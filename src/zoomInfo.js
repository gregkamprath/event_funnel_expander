import { chromium } from "playwright";
import { splitFullName } from './rails.js';

function containsFiveXs(value) {
  return typeof value === "string" && /x{5}/i.test(value);
}

function exitIfRedacted(value) {
  if (containsFiveXs(value)) {
    console.log("❌ Detected redacted contact info (XXXXX). Exiting script.");
    process.exit(1);
  }
}

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

export function randomDelay(min = 500, max = 1500) {
  return new Promise(resolve => {
    const timeout = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, timeout);
  });
}

export async function openZoomInfoSearch() {
    const userDataDir = "./user-data-zoominfo";

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: ["--start-maximized"],
        viewport: null,
    });

    const [page] = context.pages().length ? context.pages() : [await context.newPage()];
    await page.goto("https://app.zoominfo.com/#/apps/search/v2", { waitUntil: "domcontentloaded" });
    return {context, page};
}

export async function clearAllFilters(page) {
  try {
    await page.waitForTimeout(500);

    const clearAllButton = page.locator('#btn-clear-all');

    // Wait until it exists in the DOM (attached)
    await clearAllButton.waitFor({ state: 'attached', timeout: 5000 });

    console.log("Attempting to click 'Clear All'...");

    // Use force:true so Playwright clicks even if disabled or covered
    await clearAllButton.click({ force: true, timeout: 2000 });

    await page.waitForTimeout(500);

    console.log("Clicked 'Clear All'");

  } catch (err) {
    console.error("Error attempting to click 'Clear All':", err.message);
  }
}



export async function enterZoomInfoSearchParameters(page, website, titleWords) {
    await randomDelay(1000, 2000);

    // Open "Company Name" filter
    await page.waitForSelector('button[data-automation-id="companyNameUrlTicker_label"]', { state: "visible" });
    await page.click('button[data-automation-id="companyNameUrlTicker_label"]');

    await randomDelay(1000, 2000);

    // Input field inside autocomplete
    const inputSelector = 'zic-auto-complete input[placeholder="Enter company name, URL or ticker"]';
    const input = page.locator(inputSelector).first();

    await input.waitFor({ state: "visible" });

    // Usage in your playwright code
    const cleanedWebsite = normalizeWebsite(website);

    // Type normalized website into field
    await input.click({ force: true });
    await input.fill(""); // clear any existing value
    await input.type(cleanedWebsite, { delay: 50 });

    // Confirm with Enter
    await page.keyboard.press("Enter");

    // Wait for and click the "Job Title & Role" filter button
    await randomDelay(1000, 2000);
    await page.waitForSelector('button[data-automation-id="currentRole_label"]', { state: "visible" });
    await page.click('button[data-automation-id="currentRole_label"]');

    // Wait for the Job Title input to appear
    const jobTitleInputSelector = 'input[data-automation-id="currentRole-filter-jobTitle-input"]';
    await page.waitForSelector(jobTitleInputSelector, { state: "visible" });

    // Focus on the input
    const titleInput = await page.$(jobTitleInputSelector);

    for (const title of titleWords) {
        await randomDelay(1000, 2000);
        await titleInput.type(title, { delay: 50 }); // type the word
        await page.keyboard.press("Enter");     // confirm with Enter
        await page.waitForTimeout(200);         // small delay to ensure it's processed
    }

    return page;
}

export async function sortResults(page) {
    let successful = false;

    const sortBySelector = 'zic-input-select[label="Sort by"] .zic-input-select__input-container__input';
    const sortDropdown = page.locator(sortBySelector);

    // Check existence
    if (await sortDropdown.count() === 0) {
        console.log('No "Sort by" dropdown found — possibly no results on this page.');
        return { page, successful };
    }
    
    // Check visibility
    if (!(await sortDropdown.isVisible())) {
        console.log('"Sort by" dropdown is present but hidden — skipping.');
        return { page, successful };
    }

    // Try sorting
    try {
        await sortDropdown.click();
        await randomDelay(1000, 2000);

        const sortDialog = page.locator('.sort-dropdown-dialog[role="dialog"]');
        await sortDialog.waitFor({ state: 'visible', timeout: 5000 });

        const seniorityLocator = sortDialog.locator('li[role="menuitem"][aria-label="Seniority Level"]');
        if(await seniorityLocator.isVisible()) {
            await seniorityLocator.click();
            console.log('Sorted by "seniority level" sucessfully');
            successful = true;
        } else  {
            console.log('"Seniority level" option is not visible - skipping');
        }
    } catch (err) {
        console.warn('Sort operation skipped - element not interactable');
    }

    return {page, successful};
}

export async function grabContactsFromZoomInfoSearchResults(page) {
    let successful = false;
    ({page, successful} = await sortResults(page));

    let preContacts = [];
    if (successful) {
        // Wait until at least one result row is in the DOM
        try {
            await page.waitForSelector('tr.result-row', { timeout: 5000 }); // waits up to 5 seconds
        } catch {
            console.log('⚠️ No result rows found.');
        }
            // Get total and visible rows
        const allRows = page.locator('tr.result-row');
        const totalCount = await allRows.count();

        if (totalCount === 0) {
            console.log('⚠️ No rows to process.');
            return; // or continue to next account, depending on your logic
        }

        const visibleRows = page.locator('tr.result-row:visible');
        const visibleCount = await visibleRows.count();

        console.log(`Found ${visibleCount} visible rows out of ${totalCount} total rows`);

        await randomDelay(1000, 2000);

        for (let i = 0; i < visibleCount; i++) {
            let preContact = {};
            console.log(`i value is: ${i}`);
            const row = visibleRows.nth(i);

            // Click the job title field in this row
            const jobDiv = await row.locator('div.job-title__container div[data-automation-id]');
            try {
                await jobDiv.click({ timeout: 5000 });
            } catch {
                console.warn(`Skipping visible row ${i}, jobDiv not clickable`);
                continue;
            }

            // Wait for Quick View panel to appear
            await page.getByRole('heading', { name: 'Quick View' }).waitFor();
            await randomDelay(2000, 4000);

            preContact.full_name = await page.locator('h2[data-automation-id="person-details-name"]').innerText();
            const { first_name, last_name } = await splitFullName(preContact.full_name);
            preContact.first_name = first_name;
            preContact.last_name = last_name;
            console.log(preContact.first_name);
            console.log(preContact.last_name);

            // Extract ZoomInfo URL
            const linkHandle = page.locator('div#personDetailsName a');
            if (await linkHandle.count() > 0) {
                const baseUrl = 'https://app.zoominfo.com';
                const href = await linkHandle.getAttribute('href');

                if (href) {
                    // Remove the hash (#), split off query params, and rebuild a clean URL
                    const cleanPath = href.split('?')[0];
                    preContact.zoominfo = `${baseUrl}/${cleanPath}`;
                } else {
                    preContact.zoominfo = null;
                }
            } else {
                preContact.zoominfo = null;
            }

            preContact.title = await page.locator('span[data-automation-id="person-details-title"]').innerText();
            
            preContact.company = await page.locator('button[data-automation-id="dialog-company-name"]').innerText();

            preContact.email = null;
            const emailBlock = page.locator('zi-entity-data[aria-label="Business Email"] a');
            if (await emailBlock.count() > 0) {
                preContact.email = await emailBlock.first().innerText();
                exitIfRedacted(preContact.email);
            }

            preContact.direct_phone = null;
            const directPhoneBlock = page.locator('zi-entity-data[aria-label="Direct Phone"] a');
            if (await directPhoneBlock.count() > 0) {
                preContact.direct_phone = await directPhoneBlock.first().innerText();
                exitIfRedacted(preContact.direct_phone);
            }

            preContact.mobile_phone = null;
            const mobilePhoneBlock = page.locator('zi-entity-data[aria-label="Mobile Phone"] a');
            if (await mobilePhoneBlock.count() > 0) {
                preContact.mobile_phone = await mobilePhoneBlock.first().innerText();
                exitIfRedacted(preContact.mobile_phone);
            }

            preContact.general_phone = null;
            const generalPhoneBlock = page.locator('zi-entity-data[aria-label="HQ Phone"] a');
            if (await generalPhoneBlock.count() > 0) {
                preContact.general_phone = await generalPhoneBlock.first().innerText();
                exitIfRedacted(preContact.general_phone);
            }

            preContacts.push(preContact);
        }
    }
    return {page, preContacts};
}

export async function closeZoomInfo(context) {
    await context.close();
}