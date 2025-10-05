import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });
import { chromium } from "playwright";
import { getNextEventToAutoFindContacts, updateEventFlag } from './rails.js';
import { openZoomInfoSearch, enterZoomInfoSearchParameters, grabContactsFromZoomInfoSearchResults, closeZoomInfo } from './zoomInfo.js';

async function openZoomInfoWithProfile() {
  const event = await getNextEventToAutoFindContacts();
  console.log("Target Event:", event);

  let {context, page} = await openZoomInfoSearch();
  const titleWords = ["event", "meeting", "conference"];
  page = await enterZoomInfoSearchParameters(page, event.account.website, titleWords);

  let contacts = [];
  ({page, contacts} = await grabContactsFromZoomInfoSearchResults(page, event));
  console.log("Results:");
  console.log(contacts);
  await closeZoomInfo(context);

  await updateEventFlag(event.id, "auto_found_contacts", true);
}

openZoomInfoWithProfile().catch(console.error);
