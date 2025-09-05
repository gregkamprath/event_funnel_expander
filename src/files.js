import fs from "fs";
import path from "path";

export function saveOutputs(url, markdown, result) {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const safeName = url.replace(/[^a-z0-9]/gi, "_").slice(0, 80);
  fs.mkdirSync("outputs", { recursive: true });

  const mdFilePath = path.join("outputs", `${timestamp}_${safeName}.md`);
  fs.writeFileSync(mdFilePath, markdown, "utf-8");

  const jsonFilePath = path.join("outputs", `${timestamp}_${safeName}.json`);
  fs.writeFileSync(jsonFilePath, result, "utf-8");

  return { mdFilePath, jsonFilePath };
}
