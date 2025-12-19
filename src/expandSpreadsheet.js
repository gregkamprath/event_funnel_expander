import readline from "node:readline";
import process from "node:process";
import fs from "fs";
import XLSX from "xlsx";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: "./src/.env" });

import { chromium } from "playwright";

import {
  openZoomInfoSearch,
  enterZoomInfoSearchParameters,
  grabContactsFromZoomInfoSearchResults,
  closeZoomInfo,
  clearAllFilters,
  randomDelay
} from "./zoomInfo.js";

import { saveOutput } from "./files.js";

export function openSpreadsheet(filePath) {
  const absolutePath = path.resolve(filePath);

  const workbook = XLSX.readFile(absolutePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: ""
  });

  return rows;
}

function writeSpreadsheetByDate(rows, baseFolder = "./outputs", baseFilename = "expanded_contacts.xlsx") {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0"); // 0-indexed
  const day = String(now.getDate()).padStart(2, "0");

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  // Build folder path: outputs/2025/12/19
  const folderPath = path.join(baseFolder, year.toString(), month, day);

  // Make sure the folder exists
  fs.mkdirSync(folderPath, { recursive: true });

  // Full file path

  // Filename with time prefix: 11-18-12_expanded_contacts.xlsx
  const filename = `${hours}-${minutes}-${seconds}_${baseFilename}`;

  const filePath = path.join(folderPath, filename);

  // Write the spreadsheet
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Expanded Contacts");
  XLSX.writeFile(workbook, filePath);

  console.log(`✅ Spreadsheet saved to ${filePath}`);
}

function removeProcessedRows(originalFilePath, numRowsProcessed) {
  const absolutePath = path.resolve(originalFilePath);
  const workbook = XLSX.readFile(absolutePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read all rows
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  // Remove the processed rows
  const remainingRows = rows.slice(numRowsProcessed);

  // Write back only remaining rows
  const newWorksheet = XLSX.utils.json_to_sheet(remainingRows);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);

  XLSX.writeFile(newWorkbook, absolutePath);
  console.log(`✅ Removed ${numRowsProcessed} rows, remaining ${remainingRows.length} rows saved to input.xlsx`);
}

function flattenExpandedContact(row, output) {
  const contact = output.contact || {};

  return {
    // original row (spread it so you keep ALL original columns)
    ...row,

    // metadata
    zoominfo_status: output.status,
    zoominfo_duration_sec: output.durationSec,

    // zoominfo fields (explicit = predictable columns)
    zi_full_name: contact.full_name || "",
    zi_first_name: contact.first_name || "",
    zi_last_name: contact.last_name || "",
    zi_title: contact.title || "",
    zi_company: contact.company || "",
    zi_email: contact.email || "",
    zi_direct_phone: contact.direct_phone || "",
    zi_mobile_phone: contact.mobile_phone || "",
    zi_general_phone: contact.general_phone || "",
    zi_zoominfo_url: contact.zoominfo || ""
  };
}

async function expandContact(row, page) {
    let preContacts = [];
    const startTime = Date.now();

    const output = {
        input: {
            first: row.first,
            last: row.last,
            company: row.company
        },
        status: "not_found",
        contact: null,
        durationSec: null
    };

    const targetFirstInitial = row.first?.[0]?.toLowerCase();

    async function runSearch(nameQuery) {
        await clearAllFilters(page);
        await enterZoomInfoSearchParameters(page, "", [], nameQuery, row.company);
        const result = await grabContactsFromZoomInfoSearchResults(page, false);
        return result?.preContacts || [];
    }

    // Attempt full name search
    let contacts = await runSearch(`${row.first} ${row.last}`);

    // Retry with last name only if nothing found
    if (contacts.length === 0) {
        output.attempt = "last_name_only";
        contacts = await runSearch(row.last);
    }
  
    // Filter by first-initial match
    if (contacts.length > 0 && targetFirstInitial) {
        contacts = contacts.filter(c => {
            const returnedInitial = c.first_name?.[0]?.toLowerCase();
            return returnedInitial === targetFirstInitial;
        });
    }

    // Accept best match (if any remain)
    if (contacts.length > 0) {
        output.contact = contacts[0];
        output.status = "found";
    }

    output.durationSec = (Date.now() - startTime) / 1000;

    return { output };
}

async function expandContacts(rows) {
    const overallStart = Date.now();
    const expandedRows = [];
    const numRows = rows.length;

    let context, page;
    try {
        ({context, page} = await openZoomInfoSearch());
        for (let i = 0; i < numRows; i++) {
            await randomDelay(1500, 4000);
            console.log(`\n========================================================\nProcessing row ${i + 1} of ${numRows}`);
            const { output } = await expandContact(rows[i], page);
            const flattened = flattenExpandedContact(rows[i], output);
            expandedRows.push(flattened);
        }
    } finally {
        if(context) {
            await closeZoomInfo(context);
        }
    }

    const overallEnd = Date.now();
    const totalTimeMin = (overallEnd - overallStart)/1000/60;
    const avgTimeSec = totalTimeMin / expandedRows.length * 60;

    const finalOutput = {
        totalTimeMin,
        avgTimeSec,
        rowsProcessed: expandedRows.length
    };

    console.log(`\n===== Final Report =====`);
    console.log("Total time (min):", finalOutput.totalTimeMin);
    console.log("Average time per row (sec):", finalOutput.avgTimeSec)
    saveOutput(expandedRows, "expanded_contacts");
    writeSpreadsheetByDate(expandedRows);
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function start() {
  const answer = await askQuestion("Is the VPN turned off? (y/n): ");

  if (answer !== "y") {
    console.log("Please turn off the VPN and try again.");
    process.exit(1);
  }

  try {
    const rows = openSpreadsheet("./inputs/input.xlsx");

    // Read limit from command-line, default to 50
    const argLimit = parseInt(process.argv[2], 10);
    const limit = !isNaN(argLimit) && argLimit > 0 ? argLimit : 50;

    console.log(`Processing ${limit} rows...`);

    // Slice the array so we only expand the requested number of rows
    const rowsToProcess = rows.slice(0, limit);

    await expandContacts(rowsToProcess);
    console.log("Done expanding contacts.");

    // Only remove processed rows if everything succeeded
    removeProcessedRows("./inputs/input.xlsx", rowsToProcess.length);
  } catch (err) {
    console.error("Error in expanding contacts:", err);
    console.log("Processed rows not removed due to error.");
  }
}

start();
