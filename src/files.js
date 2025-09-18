import fs from "fs";
import path from "path";

function getDateParts() {
  const now = new Date();

  // Format in US Eastern Time
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23", // ensures 24-hour clock
  });

  const parts = formatter.formatToParts(now).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    time: `${parts.hour}-${parts.minute}-${parts.second}`,
  };
}

function getDatePath() {
  const { year, month, day } = getDateParts();
  return path.join("outputs", year, month, day);
}

export function saveMarkdownOutput(url, markdown) {
  const { time } = getDateParts();
  const safeName = url
    .replace(/^https?:\/\//i, "")     // remove http:// or https://
    .replace(/^www\./i, "")           // remove leading www.
    .replace(/[^a-z0-9]/gi, "_")      // replace non-alphanum with _
    .slice(0, 80);                    // trim length

  const dirPath = getDatePath();

  fs.mkdirSync(dirPath, { recursive: true });

  const mdFilePath = path.join(dirPath, `${time}_${safeName}.md`);
  fs.writeFileSync(mdFilePath, markdown, "utf-8");

  return { mdFilePath };
}

export function saveTextOutput(url, text) {
  const { time } = getDateParts();
  const safeName = url
    .replace(/^https?:\/\//i, "")     // remove http:// or https://
    .replace(/^www\./i, "")           // remove leading www.
    .replace(/[^a-z0-9]/gi, "_")      // replace non-alphanum with _
    .slice(0, 80);                    // trim length

  const dirPath = getDatePath();

  fs.mkdirSync(dirPath, { recursive: true });

  const textPath = path.join(dirPath, `${time}_${safeName}.txt`);
  fs.writeFileSync(textPath, text, "utf-8");

  return { textPath };
}

export function saveReadingsOutput(allReadings, event, totalInputTokens, totalOutputTokens, costInput, costOutput, totalCost) {
  if (allReadings.length > 0) {
    const { time } = getDateParts();
    const dirPath = getDatePath();

    fs.mkdirSync(dirPath, { recursive: true });

    const finalJsonPath = path.join(dirPath, `${time}_${event.id}_readings.json`);

    const output = {
      results: {
        totalInputTokens: totalInputTokens,
        totalOutputTokens: totalOutputTokens,
        costInput: costInput,
        costOutput: costOutput,
        totalCost: totalCost
      },
      event: {
        id: event.id,
        event_name: event.event_name,
        search_string: event.search_string
      },
      readings: allReadings
    };

    fs.writeFileSync(finalJsonPath, JSON.stringify(output, null, 2), "utf-8");
    console.log(`Saved all LLM readings to ${finalJsonPath}`);
  }
}

export function saveEventComparison(originalEvent, mergedEvent) {
  const { time } = getDateParts();
  const dirPath = getDatePath();

  fs.mkdirSync(dirPath, { recursive: true });

  const comparisonPath = path.join(dirPath, `${time}_${originalEvent.id}_event_comparison.json`);

  // Collect all unique keys from both objects
  const keys = new Set([...Object.keys(originalEvent), ...Object.keys(mergedEvent)]);
  const comparison = {};

  for (const key of keys) {
    comparison[key] = {
      original: originalEvent[key] ?? null,
      merged: mergedEvent[key] ?? null
    };
  }

  fs.writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2), "utf-8");
  console.log(`Saved event comparison to ${comparisonPath}`);
}

export function saveLoopOutput(runCount, grandInputTokens, grandOutputTokens, grandCost, avgInputTokens, avgOutputTokens, avgCost) {
  const { time } = getDateParts();
  const dirPath = getDatePath();

  fs.mkdirSync(dirPath, { recursive: true });

  const finalJsonPath = path.join(dirPath, `${time}_loop_summary.json`);

  const output = {
    results: {
      runCount: runCount,
      grandInputTokens: grandInputTokens,
      grandOutputTokens: grandOutputTokens,
      grandCost: grandCost.toFixed(6),
      avgInputTokens: avgInputTokens.toFixed(2),
      avgOutputTokens: avgOutputTokens.toFixed(2),
      avgCost: avgCost.toFixed(6)
    }
  };

  fs.writeFileSync(finalJsonPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Saved loop summary to ${finalJsonPath}`);
}