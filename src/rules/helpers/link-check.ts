export type LinkCheckOutcome = "ok" | "fail" | "timeout";

/** HEAD с fallback на GET; 2xx/3xx = ok, 4xx/5xx = fail, сеть/таймаут = timeout. */
export async function checkHttpUrl(
  url: string,
  timeoutMs: number,
): Promise<LinkCheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { Range: "bytes=0-0" },
      });
    }

    if (response.status >= 200 && response.status < 400) {
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
