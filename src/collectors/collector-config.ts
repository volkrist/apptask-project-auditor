export type CollectorMode = "playwright" | "api" | "db";
export type ApiDetailsMode = "off" | "candidates" | "all";

export type CollectorConfig = {
  collector: CollectorMode;
  apiConcurrency: number;
  detailsMode: ApiDetailsMode;
  apiFallbackToPlaywright: boolean;
  dbFallbackToPlaywright: boolean;
};

function parseCollector(raw: string | undefined): CollectorMode {
  const v = raw?.trim().toLowerCase();
  if (v === "api") return "api";
  if (v === "db") return "db";
  return "playwright";
}

function parseDetailsMode(raw: string | undefined): ApiDetailsMode {
  const v = raw?.trim().toLowerCase();
  if (v === "off" || v === "all") return v;
  return "candidates";
}

function parseConcurrency(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? String(fallback));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 10);
}

export function loadCollectorConfig(
  overrides: Partial<CollectorConfig> = {},
): CollectorConfig {
  return {
    collector: overrides.collector ?? parseCollector(process.env.APPTASK_COLLECTOR),
    apiConcurrency: overrides.apiConcurrency ?? parseConcurrency(
      process.env.API_COLLECTOR_CONCURRENCY,
      3,
    ),
    detailsMode: overrides.detailsMode ?? parseDetailsMode(
      process.env.API_DETAILS_MODE,
    ),
    apiFallbackToPlaywright:
      process.env.APPTASK_API_FALLBACK?.trim().toLowerCase() !== "false",
    dbFallbackToPlaywright:
      process.env.APPTASK_DB_FALLBACK?.trim().toLowerCase() !== "false",
  };
}
