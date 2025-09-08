// test-reading.js
import fetch from "node-fetch";
import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

const BASE_URL = process.env.BASE_URL;


async function createReading(readingData) {
  const response = await fetch(`${BASE_URL}/readings.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reading: readingData }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to create reading: ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}

(async () => {
  try {
    const readingData = {
    //   event_name: "CHAINge",
    //   event_name_casual: "ASCM CONNECT",
    //   organization_name: "Association for Supply Chain Management",
    //   organization_name_abbreviated: "ASCM",
    //   organization_link: "https://www.ascm.org/",
    //   start_date: null,   // better than empty string
    //   end_date: null,
    //   city: null,
    //   state: null,
    //   venue: null,
    //   attendees: null,
    //   event_id: 20533,        // <-- must be a real event.id in your Rails DB
      link_id: 61728          // <-- must be a real link.id in your Rails DB
    };

    const saved = await createReading(readingData);
    console.log("✅ Created reading:", saved);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
