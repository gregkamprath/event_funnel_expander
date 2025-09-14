import fetch from "node-fetch";
import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

const BASE_URL = process.env.BASE_URL;

export async function getOrCreateLink(url) {
  const response = await fetch(`${BASE_URL}/links/find_or_create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

export async function getOrCreateAccount(name, abbr, website) {
    if (!name) return null; // no org info provided

    const url = `${BASE_URL}/accounts/find_or_create`;
    const payload = {
        account: {
            account_name: name,
            account_name_abbr: abbr || null,
            website: website || null
        }
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Failed to find/create account: ${response.statusText}`);
        }

        return await response.json(); // should return the account object
    } catch (err) {
        console.error("Error in getOrCreateAccount:", err.message);
        return null;
    }
}


export async function createReading(readingData) {
  const response = await fetch(`${BASE_URL}/readings.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reading: readingData })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create reading: ${response.status} - ${errText}`);
  }

  return response.json();
}

export async function checkReadingMatch(readingId, eventId) {
  const response = await fetch(
    `${BASE_URL}/readings/${readingId}/check_match?event_id=${eventId}`
  );
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create reading: ${response.status} - ${errText}`);
  }

  return response.json();
}

export async function eventMergeReadings(eventId) {
  const response = await fetch(
    `${BASE_URL}/events/${eventId}/merge_readings`,
    {
      headers: {
        "Accept": "application/json"
      }
    }
  );
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to merge readings: ${response.status} - ${errText}`);
  }

  return response.json();
}



export async function updateEventAutoExpanded(eventId, value = true) {
  const response = await fetch(`${BASE_URL}/events/${eventId}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { auto_expanded: value } }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to update event: ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}
