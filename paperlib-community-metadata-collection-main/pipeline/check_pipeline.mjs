import { formatCheck } from "./_utils/format-check.mjs";
import { readFileSync } from "fs";
import path from "path";

async function main() {
  const filePath = process.argv[2];
  console.log(`Processing ${filePath}...`);
  const source = path.join("GITHUB", filePath);
  const jsonCollection = JSON.parse(readFileSync(filePath, "utf8"));

  // ==========================
  // 1. Format check
  formatCheck(jsonCollection);

  console.log("==========================");
  console.log("Format check passed:");
  console.log(`Source: ${source}`);
  console.log(`Collection: ${jsonCollection.info.name}`);
  console.log(`Collection Date: ${jsonCollection.info.date}`);
  console.log(`Collection Item Count: ${jsonCollection.collection.length}`);
  console.log("==========================");

  process.exit(0);
}

await main();
