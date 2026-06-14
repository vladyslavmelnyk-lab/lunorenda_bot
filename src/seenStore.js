import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";

const SEEN_PATH = new URL("../seen.json", import.meta.url);

export async function loadSeen() {
  try {
    const raw = await readFile(SEEN_PATH, "utf8");
    const data = JSON.parse(raw);
    return new Set(data.ids || []);
  } catch {
    return new Set();
  }
}

// Зберігаємо seen, обрізаючи до seenLimit (лишаємо найсвіжіші — кінець масиву).
export async function saveSeen(seenSet) {
  const ids = [...seenSet].slice(-config.seenLimit);
  await writeFile(SEEN_PATH, JSON.stringify({ ids }, null, 0) + "\n", "utf8");
}
