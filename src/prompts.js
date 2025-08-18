import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load a prompt by filename (without extension)
export function loadPrompt(name) {
  const promptPath = path.join(__dirname, "../prompts", `${name}.txt`);
  try {
    return fs.readFileSync(promptPath, "utf8");
  } catch (err) {
    console.error(`Error loading prompt "${name}":`, err.message);
    return "";
  }
}
