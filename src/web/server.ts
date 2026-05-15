import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "../app/run-audit.js";
import { loadEnv } from "../config/env.js";
import {
  getAuditJobStatus,
  isAuditRunning,
  markAuditDone,
  markAuditError,
  markAuditRunning,
} from "./audit-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

const REPORT_FILE_NAMES = new Set(["audit.json", "audit.md", "summary.md"]);

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: import("node:http").ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function auditFolderSafe(folder: string): boolean {
  return /^audit-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(folder);
}

export function startWebServer(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = await readFile(path.join(__dirname, "pages", "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/audit/status") {
        sendJson(res, 200, getAuditJobStatus());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/audit") {
        if (isAuditRunning()) {
          sendJson(res, 409, { error: "Аудит уже выполняется" });
          return;
        }

        const body = (await readJsonBody(req)) as {
          boardUrl?: string;
          webhookUrl?: string;
        };
        const env = loadEnv();
        const boardUrl = body.boardUrl?.trim() || env.boardUrl;
        const webhookUrl = body.webhookUrl?.trim() || null;
        const maxCards = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");

        if (!boardUrl) {
          sendJson(res, 400, { error: "Укажите URL доски" });
          return;
        }

        markAuditRunning("Сбор карточек и проверка правил…");
        sendJson(res, 202, { ok: true, status: getAuditJobStatus() });

        void runAudit(boardUrl, webhookUrl, {
          maxCards: maxCards > 0 ? maxCards : undefined,
        })
          .then((result) => markAuditDone(result))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            markAuditError(message);
          });
        return;
      }

      const reportMatch = url.pathname.match(/^\/reports\/([^/]+)\/([^/]+)$/);
      if (req.method === "GET" && reportMatch) {
        const [, folder, fileName] = reportMatch;
        if (!folder || !fileName || !auditFolderSafe(folder) || !REPORT_FILE_NAMES.has(fileName)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const filePath = path.join(ROOT, "output", folder, fileName);
        const content = await readFile(filePath);
        const type =
          fileName.endsWith(".json")
            ? "application/json; charset=utf-8"
            : "text/markdown; charset=utf-8";
        res.writeHead(200, { "Content-Type": type });
        res.end(content);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Порт ${PORT} занят. Закройте другой процесс или задайте PORT=3001 npm run web`,
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Web UI: http://${HOST}:${PORT}/`);
    console.log(`         http://localhost:${PORT}/`);
    console.log("Оставьте этот терминал открытым, пока работаете с UI.");
  });
}

startWebServer();
