export function escHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function linkOrText(
  url: string | null | undefined,
  label: string,
): string {
  const safe = escHtml(label);
  if (url?.trim()) {
    return `<a href="${escHtml(url)}" target="_blank" rel="noopener">${safe}</a>`;
  }
  return safe;
}

export function displayOrFallback(
  value: string | null | undefined,
  fallback: string,
): string {
  const v = value?.trim();
  return v && v !== "—" ? v : fallback;
}
