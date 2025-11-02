import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });
import { chromium } from "playwright";
import { getNextEventToAutoFindContacts, updateEventFlag, splitFullName, verifyEmail, getOrCreateContact, checkTitle, associateWithEvent } from './rails.js';
import { openZoomInfoSearch, enterZoomInfoSearchParameters, grabContactsFromZoomInfoSearchResults, closeZoomInfo, clearAllFilters } from './zoomInfo.js';
import { saveOutput  } from './files.js';


// Get number of events from CLI, default to 1
const numEvents = parseInt(process.argv[2], 10) || 1;

async function checkEmailBeforeSaving(email) {
  try {
    const result = await verifyEmail(email);
    console.log("Verification result:", result);
    return result;
  } catch (error) {
    console.error("Error verifying email:", error);
    return { email_is_good: false, email_verification_result: "error" };
  }
}

async function findContactsForOneEvent(page) {
  const startTime = Date.now(); // Start timer
  let output = {};
  const event = await getNextEventToAutoFindContacts();
  output.event = event;
  console.log(`Target Event: ${event.id} - ${event.event_name}`);

  await clearAllFilters(page);

  let contacts = [];
  let preContacts = [];
  let titleWords = ["event", "meeting", "conference"];

  page = await enterZoomInfoSearchParameters(page, event.account.website, titleWords);
  ({page, preContacts} = await grabContactsFromZoomInfoSearchResults(page, event));

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
      const result = await checkEmailBeforeSaving(preContact.email);
      preContact.email_is_good = result.email_is_good;
      preContact.email_verification_result = result.email_verification_result;

      if (preContact.email_is_good) {
        console.log(`Valid email for ${preContact.full_name}: ${preContact.email}`);

        const result = await checkTitle(preContact.title);
        const titleIsUndesirable = result.undesirable;

        if (titleIsUndesirable === null) {
          // Error talking to Rails — treat as "unknown" but continue gracefully
          console.warn(`Could not verify title "${preContact.title}" due to error: ${result.error}`);
          preContact.desirable = false; // or true, depending on your fallback logic
        } else if (!titleIsUndesirable) {
          preContact.desirable = true;
          console.log(`This contact is desirable: ${preContact.full_name}`);
          break;
        } else {
          preContact.desirable = false;
        }

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
        if (contact.desirable) {
          const result = await associateWithEvent(contact.id, event.id);
          if (result?.success) {
            console.log(`Linked contact ${contact.id} with event ${event.id}`);
          }
        }
      }
    } catch (err) {
      console.error("Error creating contact:", err);
    }
  }

  output.contacts = contacts;
  output.desirableContact = contacts.find(c => c.desirable) || null;
  const endTime = Date.now();
  output.durationSec = (endTime - startTime)/1000;

  saveOutput(output, "contacts_for_one_event");
  await updateEventFlag(event.id, "auto_found_contacts", true);
  return { page, output };
}

async function findContacts(numEvents) {
  const overallStart = Date.now();
  let {context, page} = await openZoomInfoSearch();
  const allOutputs = [];

  for (let i = 0; i < numEvents; i++) {
    console.log(`\n========================================================\nProcessing event ${i + 1} of ${numEvents}`);
    const result = await findContactsForOneEvent(page);

    page = result.page;
    allOutputs.push(result.output);
  }

  await closeZoomInfo(context);

  const overallEnd = Date.now();
  const totalTimeMin = (overallEnd - overallStart)/1000/60;
  const avgTimeSec = totalTimeMin / allOutputs.length * 60;

  const finalOutput = {
    totalEvents: allOutputs.length,
    totalContacts: allOutputs.reduce((sum, o) => sum + o.contacts.length, 0),
    eventsWithDesirable: allOutputs.filter(o => o.desirableContact).length,
    totalTimeMin,
    avgTimeSec,
    events: allOutputs.map(o => ({
      id: o.event.id,
      name: o.event.event_name,
      contactsFound: o.contacts.length,
      desirableContact: o.desirableContact?.id || null, // <-- safe
      durationSec: o.durationSec
    }))
  };

  console.log(`\n===== Final Report =====`);
  console.log("Events processed:", finalOutput.totalEvents);
  console.log("Contacts found:", finalOutput.totalContacts);
  console.log("Events with desirable contact:", finalOutput.eventsWithDesirable);
  console.log("Total time (min):", finalOutput.totalTimeMin);
  console.log("Average time per event (sec):", finalOutput.avgTimeSec)
  console.table(finalOutput.events); // nice table view in terminal
  saveOutput(finalOutput, "found_contacts");
}

findContacts(numEvents)
  .then(() => console.log("Done processing events."))
  .catch(err => console.error("Error in findContacts:", err));
