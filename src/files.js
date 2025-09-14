import fs from "fs";
import path from "path";

export function saveMarkdownOutput(url, markdown) {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const safeName = url.replace(/[^a-z0-9]/gi, "_").slice(0, 80);
  fs.mkdirSync("outputs", { recursive: true });

  const mdFilePath = path.join("outputs", `${timestamp}_${safeName}.md`);
  fs.writeFileSync(mdFilePath, markdown, "utf-8");
  
  return { mdFilePath};
}

export function saveReadingsOutput(allReadings) {
  if (allReadings.length > 0) {
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const finalJsonPath = path.join("outputs", `all_readings_${timestamp}.json`);
    fs.writeFileSync(finalJsonPath, JSON.stringify(allReadings, null, 2), "utf-8");
    console.log(`Saved all LLM readings to ${finalJsonPath}`);
  }
}