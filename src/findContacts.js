import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });
import { chromium } from "playwright";
import { getOrCreateContact, updateEventFlag, splitFullName } from './rails.js';


const BASE_URL = process.env.BASE_URL;

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

function randomDelay(min = 500, max = 1500) {
  return new Promise(resolve => {
    const timeout = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, timeout);
  });
}

async function openZoomInfoWithProfile() {
  let url;
  url = `${BASE_URL}/events/next_to_auto_find_contacts`;

  const response = await fetch(
      url,
      { headers: { "Accept": "application/json" } }
  );

  if (!response.ok) {
      throw new Error(`Failed to fetch event: ${response.statusText}`);
  }

  const event = await response.json();
  console.log("Target Event:", event);

  const userDataDir = "./user-data-zoominfo";

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--start-maximized"],
    viewport: null,
  });

  const [page] = context.pages().length ? context.pages() : [await context.newPage()];
  await page.goto("https://app.zoominfo.com/#/apps/search/v2", { waitUntil: "domcontentloaded" });

  // Open "Company Name" filter
  await page.waitForSelector('button[data-automation-id="companyNameUrlTicker_label"]', { state: "visible" });
  await page.click('button[data-automation-id="companyNameUrlTicker_label"]');

  // Input field inside autocomplete
  const inputSelector = 'zic-auto-complete input[placeholder="Enter company name, URL or ticker"]';
  const input = page.locator(inputSelector).first();

  await input.waitFor({ state: "visible" });

  // Usage in your playwright code
  const cleanedWebsite = normalizeWebsite(event.account.website);

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

  // --- open "Sort by" dropdown ---
  await page.waitForSelector('zic-input-select[label="Sort by"] .zic-input-select__input-container__input', { state: 'visible' });
  await page.click('zic-input-select[label="Sort by"] .zic-input-select__input-container__input');

  // Wait for the sort dialog to appear (this matches the HTML you pasted)
  await page.waitForSelector('.sort-dropdown-dialog[role="dialog"]', { state: 'visible', timeout: 5000 });
  const sortDialog = page.locator('.sort-dropdown-dialog[role="dialog"]');

  // Wait for the "Seniority Level" menu item inside that dialog
  const seniorityLocator = sortDialog.locator('li[role="menuitem"][aria-label="Seniority Level"]');
  await seniorityLocator.waitFor({ state: 'visible', timeout: 3000 });

  // Click the anchor/text inside the menu item (safe target)
  await sortDialog.getByRole('menuitem', { name: 'Seniority Level' }).click();

  // Wait until at least one result row is in the DOM
  await page.waitForSelector('tr.result-row', { timeout: 5000 }); // waits up to 5 seconds

  // Collect preliminary info while table is stable
  const rows = page.locator('tr.result-row');
  const count = await rows.count();

    // Get total and visible rows
  const allRows = page.locator('tr.result-row');
  const totalCount = await allRows.count();

  const visibleRows = page.locator('tr.result-row:visible');
  const visibleCount = await visibleRows.count();

  console.log(`Found ${visibleCount} visible rows out of ${totalCount} total rows`);

  // const preliminaryResults = [];
  // for (let i = 0; i < count; i++) {
  //   const row = rows.nth(i);
  //   const prelimName = await row.locator('a[data-automation-id="contact-column-contact-name"] span[data-automation-id="card-name"]').innerText();
  //   const prelimJobTitle = await row.locator('div.job-title__container span[data-automation-id="card-name"]').innerText();
  //   const prelimCompany = await row.locator('div.company-name-container a span[data-automation-id="card-name"]').innerText();
  //   const prelimAccuracy = await row.locator('zi-confidence-score .tooltip-content').innerText();
  //   preliminaryResults.push({ prelimName, prelimJobTitle, prelimCompany, prelimAccuracy });
  // }

  const results = [];
  for (let i = 0; i < visibleCount; i++) {
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
    await randomDelay(1500, 3000);

    const name = await page.locator('h2[data-automation-id="person-details-name"]').innerText();
    const { firstName, lastName } = await splitFullName(name);
    console.log(`First name: ${firstName}`);
    console.log(`Last name: ${lastName}`);
    const title = await page.locator('span[data-automation-id="person-details-title"]').innerText();
    const company = await page.locator('button[data-automation-id="dialog-company-name"]').innerText();

    let email = null;
    const emailBlock = page.locator('zi-entity-data[aria-label="Business Email"] a');
    if (await emailBlock.count() > 0) {
      email = await emailBlock.first().innerText();
    }

    let directPhone = null;
    const directPhoneBlock = page.locator('zi-entity-data[aria-label="Direct Phone"] a');
    if (await directPhoneBlock.count() > 0) {
      directPhone = await directPhoneBlock.first().innerText();
    }

    let mobilePhone = null;
    const mobilePhoneBlock = page.locator('zi-entity-data[aria-label="Mobile Phone"] a');
    if (await mobilePhoneBlock.count() > 0) {
      mobilePhone = await mobilePhoneBlock.first().innerText();
    }

    let generalPhone = null;
    const generalPhoneBlock = page.locator('zi-entity-data[aria-label="HQ Phone"] a');
    if (await generalPhoneBlock.count() > 0) {
      generalPhone = await generalPhoneBlock.first().innerText();
    }

    let preContact = {
      first_name: firstName?.trim() || null,
      last_name: lastName?.trim() || null,
      title: title?.trim() || null,
      direct_phone: directPhone?.trim() || null,
      mobile_phone: mobilePhone?.trim() || null,
      general_phone: generalPhone?.trim() || null,
      email: email?.trim() || null,
      account_id: event.account.id
    };
    let contact = null
    try {
      contact = await getOrCreateContact(preContact);
    } catch (err) {
      console.error("Error creating contact: ", err)
    }
    if(contact) {
      results.push(contact);
    }
  }

  console.log("Results:");
  console.log(results);

  await updateEventFlag(event.id, "auto_found_contacts", true);

  await context.close();
  // return { context, page };
}

openZoomInfoWithProfile().catch(console.error);
