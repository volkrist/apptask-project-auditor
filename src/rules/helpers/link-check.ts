export type LinkCheckOutcome = "ok" | "fail" | "timeout";

const GET_PREFERRED_HOSTS =
  /(^|\.)google\.com$|(^|\.)googleusercontent\.com$|(^|\.)gstatic\.com$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function prefersGet(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return GET_PREFERRED_HOSTS.test(host);
}

async function fetchWithMethod(
  url: string,
  method: "HEAD" | "GET",
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method,
    signal,
    redirect: "follow",
    headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
  });
}

/** HEAD с fallback на GET; 2xx/3xx = ok, 4xx/5xx = fail, сеть/таймаут = timeout. */
export async function checkHttpUrl(
  url: string,
  timeoutMs: number,
): Promise<LinkCheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const firstMethod = prefersGet(url) ? "GET" : "HEAD";
    let response = await fetchWithMethod(url, firstMethod, controller.signal);

    if (
      firstMethod === "HEAD" &&
      (response.status === 405 || response.status === 501)
    ) {
      response = await fetchWithMethod(url, "GET", controller.signal);
    }

    if (response.status >= 200 && response.status < 400) {
      return "ok";
    }
    // Google Docs под логином часто отвечает 401/403 — ссылка существует.
    if (
      (response.status === 401 || response.status === 403) &&
      prefersGet(url)
    ) {
      return "ok";
    }
    return "fail";
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      return "timeout";
    }
    return "timeout";
  } finally {
    clearTimeout(timer);
  }
}
