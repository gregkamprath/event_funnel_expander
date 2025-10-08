import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });
import { chromium } from "playwright";
import { getNextEventToAutoFindContacts, updateEventFlag, splitFullName, verifyEmail, getOrCreateContact } from './rails.js';
import { openZoomInfoSearch, enterZoomInfoSearchParameters, grabContactsFromZoomInfoSearchResults, closeZoomInfo } from './zoomInfo.js';

async function checkEmailBeforeSaving(email) {
  try {
    const result = await verifyEmail(email);
    console.log("Verification result:", result);

    if (result.status === "ok") {
      console.log("Email is valid, proceeding to save contact...");
      return true;
      // continue your logic here
    } else {
      console.log("Email may not be valid:", result.message);
      return false;
    }
  } catch (error) {
    console.error("Error verifying email:", error);
  }
}

async function findContacts() {
  const event = await getNextEventToAutoFindContacts();
  console.log("Target Event:", event);

  let {context, page} = await openZoomInfoSearch();

  let contacts = [];
  let preContacts = [];
  let titleWords = ["event", "meeting", "conference"];

  page = await enterZoomInfoSearchParameters(page, event.account.website, titleWords);
  ({page, preContacts} = await grabContactsFromZoomInfoSearchResults(page, event));
  console.log("preContacts:")
  console.log(preContacts);

  // If no results, retry with different title
  if(preContacts.length === 0) {
    console.log('No contacts found for initial titles, retrying with "marketing"...');
    titleWords = ["marketing"];
    page = await enterZoomInfoSearchParameters(page, event.account.website, titleWords);
    ({page, preContacts} = await grabContactsFromZoomInfoSearchResults(page, event));
  }

  // Checking email
  for (const preContact of preContacts) {
    if (!preContact.email) {
      console.log(`${preContact.full_name} does not have email`);
      preContact.desirable = false;
      continue;
    } else {
      console.log(`Verifying email for ${preContact.full_name}: ${preContact.email}`);
      preContact.email_is_good = await checkEmailBeforeSaving(preContact.email);
      if (preContact.email_is_good) {
        console.log(`Valid email for ${preContact.full_name}: ${preContact.email}`);
        break;
      } else {
        console.log(`Invalid email for ${preContact.full_name}: ${preContact.email}`);
        preContact.desirable = false;
      }
    }
  }

  for (const preContact of preContacts) {
    if (!event.account?.id) {
      console.error("No account associated with event; cannot assign account_id.");
    } else {
      preContact.account_id = event.account.id;
    }


    try {
      const contact = await getOrCreateContact(preContact);
      if (contact) {
        contacts.push(contact);
      }
    } catch (err) {
      console.error("Error creating contact:", err);
    }
  }


  console.log("Results:");
  console.log(contacts);

  await updateEventFlag(event.id, "auto_found_contacts", true);
  await closeZoomInfo(context);
}

findContacts().catch(console.error);
