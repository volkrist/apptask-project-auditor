import type {
  DiscordSummary,
  ReportArtifact,
  ReportPublisher,
} from "./publisher.js";

const DISCORD_CONTENT_MAX = 2000;
const DEFAULT_RETRY_MS = 2000;

export class DiscordPublishError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DiscordPublishError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDiscord(
  url: string,
  init: RequestInit,
  retries = 1,
): Promise<Response> {
  const response = await fetch(url, init);

  if (response.status === 429 && retries > 0) {
    const retryHeader = response.headers.get("retry-after");
    const retryMs = retryHeader
      ? Math.ceil(Number(retryHeader) * 1000)
      : DEFAULT_RETRY_MS;
    await sleep(Number.isFinite(retryMs) ? retryMs : DEFAULT_RETRY_MS);
    return fetchDiscord(url, init, retries - 1);
  }

  return response;
}

function assertOk(response: Response, step: string): void {
  if (response.ok) return;
  const retryAfter = response.headers.get("retry-after");
  throw new DiscordPublishError(
    `Discord ${step}: HTTP ${response.status} ${response.statusText}`,
    response.status,
    retryAfter ? Math.ceil(Number(retryAfter) * 1000) : undefined,
  );
}

export class WebhookPublisher implements ReportPublisher {
  constructor(private readonly webhookUrl: string) {}

  async publish(
    summary: DiscordSummary,
    artifacts: ReportArtifact[] = [],
  ): Promise<void> {
    const content =
      summary.text.length > DISCORD_CONTENT_MAX
        ? `${summary.text.slice(0, DISCORD_CONTENT_MAX - 20)}… (сокращено)`
        : summary.text;

    const summaryRes = await fetchDiscord(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    assertOk(summaryRes, "summary message");

    if (artifacts.length === 0) return;

    for (const artifact of artifacts) {
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({
          content: `📎 ${artifact.filename}`,
        }),
      );
      const blob = new Blob([new Uint8Array(artifact.content)], {
        type: artifact.mimeType,
      });
      form.append("files[0]", blob, artifact.filename);

      const fileRes = await fetchDiscord(this.webhookUrl, {
        method: "POST",
        body: form,
      });
      assertOk(fileRes, `file upload (${artifact.filename})`);
    }
  }
}
