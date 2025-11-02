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

export async function getOrCreateContact(contact) {
  if (!contact) return null; // no org info provided

  const url = `${BASE_URL}/contacts/find_or_create`;
  const payload = {
    contact
  };

  try {
      const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(payload)
      });

      if (!response.ok) {
          throw new Error(`Failed to find/create contact (status: ${response.status})`);
      }

      return await response.json(); // should return the contact object
  } catch (err) {
      console.error("Error in getOrCreateContact:", err.message);
      return null;
  }
}

export async function associateWithEvent(id, event_id) {
  if (!id || !event_id) return null; // need both contact and event id

  const url = `${BASE_URL}/contacts/${id}/associate_with_event`;
  const payload = {
    event_id
  };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to association contact with event (status: ${response.status})`);
      }

      return await response.json();
    } catch (err) {
      console.error("Error in associateWithEvent:", err.message);
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

export async function getNextEventToAutoFindContacts() {
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
  return event;
}

export async function updateEventFlag(eventId, field, value = true) {
  const response = await fetch(`${BASE_URL}/events/${eventId}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { [field]: value } }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to update event: ${response.status} - ${text}`);
  }

  console.log(`For event ${eventId}, set field ${field} to ${value}`);
  return JSON.parse(text);
}

export async function splitFullName(fullName) {
  const response = await fetch(`${BASE_URL}/contacts/split_full_name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: fullName }),
  });

  const data = await response.json();
  return {
    first_name: data.first_name,
    last_name: data.last_name,
  };
}

export async function verifyEmail(email) {
  const response = await fetch(`${BASE_URL}/contacts/verify_email_temp.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(`Email verification failed: ${response.status}`);
  }

  const data = await response.json();
  return data; // contains { status, email_is_good, message }
}

export async function checkTitle(title) {
  try {
    const response = await fetch(`${BASE_URL}/undesirable_titles/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });

    // Handle non-OK responses (e.g. 422, 500)
    if (!response.ok) {
      console.error(`Rails error ${response.status} while checking title: "${title}"`);
      return { undesirable: null, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    console.log(`"${title}" is undesirable? ${data.undesirable}`);
    return data;

  } catch (err) {
    // Handle network or JSON parse errors
    console.error(`Error checking title "${title}": ${err.message}`);
    return { undesirable: null, error: err.message };
  }
}
