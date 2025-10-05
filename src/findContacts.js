import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });
import { chromium } from "playwright";
import { getNextEventToAutoFindContacts, updateEventFlag } from './rails.js';
import { openZoomInfoSearch, enterZoomInfoSearchParameters, grabContactsFromZoomInfoSearchResults, closeZoomInfo } from './zoomInfo.js';

async function findContacts() {
  const event = await getNextEventToAutoFindContacts();
  console.log("Target Event:", event);

  let {context, page} = await openZoomInfoSearch();

  let contacts = [];
  let titleWords = ["event", "meeting", "conference"];

  page = await enterZoomInfoSearchParameters(page, event.account.website, titleWords);
  ({page, contacts} = await grabContactsFromZoomInfoSearchResults(page, event));

  // If no results, retry with different title
  if(contacts.length === 0) {
    console.log('No contacts found for initial titles, retrying with "marketing"...');
    titleWords = ["marketing"];
    page = await enterZoomInfoSearchParameters(page, event.account.website, titleWords);
    ({page, contacts} = await grabContactsFromZoomInfoSearchResults(page, event));
  }

  console.log("Results:");
  console.log(contacts);

  await updateEventFlag(event.id, "auto_found_contacts", true);
  await closeZoomInfo(context);
}

findContacts().catch(console.error);
