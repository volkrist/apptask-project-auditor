import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

export function startWebServer(): void {
  const server = createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      const html = await readFile(path.join(__dirname, "pages", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.url === "/audit" && req.method === "POST") {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Audit endpoint not implemented" }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    console.log(`Web UI: http://localhost:${PORT}`);
  });
}

startWebServer();
