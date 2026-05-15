import fs from "node:fs";

const tracePath = "output/trace-extract/0-trace.network";
const raw = fs.readFileSync(tracePath, "utf8");
const lines = raw.split("\n").filter(Boolean);

type Entry = { method: string; url: string; status: number; mimeType?: string };

const entries: Entry[] = [];
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    const s = o.snapshot;
    if (!s?.request?.url) continue;
    entries.push({
      method: s.request.method,
      url: s.request.url,
      status: s.response?.status ?? 0,
      mimeType: s.response?.content?.mimeType,
    });
  } catch {
    // skip
  }
}

const failed = entries.filter((e) => e.status >= 400);
const api = entries.filter(
  (e) =>
    /board|445|task|card|project|kanban|api/i.test(e.url) &&
    !e.url.endsWith(".js") &&
    !e.url.endsWith(".css"),
);

console.log("=== trace network summary ===");
console.log("total requests:", entries.length);
console.log("failed (4xx/5xx):", failed.length);
if (failed.length) console.log(failed);

const boardHtml = entries.find((e) => e.url.includes("/board/445"));
console.log("\nboard document:", boardHtml);

console.log("\nboard/api related (top 30):");
for (const e of api.slice(0, 30)) {
  console.log(`  ${e.status} ${e.method} ${e.url}`);
}

console.log("\nlast 20 responses:");
for (const e of entries.slice(-20)) {
  console.log(`  ${e.status} ${e.method} ${e.url.slice(0, 100)}`);
}
