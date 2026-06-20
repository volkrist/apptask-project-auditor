import fs from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
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

const REPORT_FILE_NAMES = new Set([
  "audit.json",
  "audit.md",
  "summary.md",
  "audit-report.md",
  "audit-report.html",
]);

function findLatestAuditRunId(): string | null {
  const outputDir = path.join(ROOT, "output");
  if (!fs.existsSync(outputDir)) return null;
  const dirs = fs
    .readdirSync(outputDir)
    .filter(auditFolderSafe)
    .sort()
    .reverse();
  return dirs[0] ?? null;
}

function contentTypeForReportFile(fileName: string): string {
  if (fileName.endsWith(".json")) return "application/json; charset=utf-8";
  if (fileName.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/markdown; charset=utf-8";
}

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

/** 0 или пусто — все карточки; иначе лимит. Тело запроса имеет приоритет над env. */
function resolveMaxCards(bodyValue: unknown): { maxCards?: number; error?: string } {
  const envDefault = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");

  if (bodyValue === undefined || bodyValue === null || bodyValue === "") {
    if (Number.isInteger(envDefault) && envDefault > 0) {
      return { maxCards: envDefault };
    }
    return { maxCards: undefined };
  }

  const n = typeof bodyValue === "number" ? bodyValue : Number(bodyValue);
  if (!Number.isInteger(n) || n < 0) {
    return {
      error: "Лимит карточек: целое число ≥ 0 (0 — проверить все карточки на доске)",
    };
  }
  return { maxCards: n > 0 ? n : undefined };
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
          maxCards?: number | string;
        };
        const env = loadEnv();
        const boardUrl = body.boardUrl?.trim() || env.boardUrl;
        const webhookUrl = body.webhookUrl?.trim() || null;
        const { maxCards, error: maxCardsError } = resolveMaxCards(body.maxCards);

        if (!boardUrl) {
          sendJson(res, 400, { error: "Укажите URL доски" });
          return;
        }
        if (maxCardsError) {
          sendJson(res, 400, { error: maxCardsError });
          return;
        }

        const runningMessage =
          maxCards != null
            ? `Сбор до ${maxCards} карточек и проверка правил…`
            : "Сбор карточек и проверка правил…";
        markAuditRunning(runningMessage);
        sendJson(res, 202, { ok: true, status: getAuditJobStatus() });

        void runAudit(boardUrl, webhookUrl, { maxCards })
          .then((result) => markAuditDone(result))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            markAuditError(message);
          });
        return;
      }

      if (req.method === "GET" && url.pathname === "/reports/latest") {
        const latest = findLatestAuditRunId();
        if (!latest) {
          res.writeHead(404);
          res.end("No audit reports yet");
          return;
        }
        res.writeHead(302, { Location: `/reports/${latest}` });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/reports") {
        const latest = findLatestAuditRunId();
        if (!latest) {
          sendJson(res, 200, { runs: [], latest: null });
          return;
        }
        sendJson(res, 200, {
          latest,
          webUrl: `/reports/${latest}`,
          htmlUrl: `/reports/${latest}/audit-report.html`,
        });
        return;
      }

      const runOnlyMatch = url.pathname.match(/^\/reports\/([^/]+)$/);
      if (req.method === "GET" && runOnlyMatch) {
        const runId = runOnlyMatch[1]!;
        if (!auditFolderSafe(runId)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const htmlPath = path.join(ROOT, "output", runId, "audit-report.html");
        if (!fs.existsSync(htmlPath)) {
          res.writeHead(404);
          res.end("Report HTML not found");
          return;
        }
        res.writeHead(302, { Location: `/reports/${runId}/audit-report.html` });
        res.end();
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
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const content = await readFile(filePath);
        res.writeHead(200, { "Content-Type": contentTypeForReportFile(fileName) });
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
    console.log(`Reports: http://localhost:${PORT}/reports/latest`);
    console.log("Оставьте этот терминал открытым, пока работаете с UI.");
  });
}

startWebServer();
