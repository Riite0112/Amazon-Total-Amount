import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "src", "amazon-annual-total.js");
const outputPath = resolve(root, "dist", "bookmarklet.txt");

const source = await readFile(sourcePath, "utf8");

const compact = source
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{}()[\];,:?+\-*/<>=|&])\s*/g, "$1")
  .trim();

await writeFile(outputPath, `javascript:${encodeURIComponent(compact)}`, "utf8");
console.log(`Wrote ${outputPath}`);
