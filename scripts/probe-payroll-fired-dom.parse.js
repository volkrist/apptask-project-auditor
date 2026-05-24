/**
 * Browser-side: extract names from payroll table subheads («Уволены» / «Не работали»).
 */
function extractFiredFromDom() {
  const normalize = (s) => s.replace(/\s+/g, " ").trim();

  const firedNames = [];
  const seen = new Set();
  const subheadLabels = [];

  const addName = (name) => {
    const n = normalize(name);
    if (!n || n.length < 4 || seen.has(n.toLowerCase())) return;
    if (/^(добавить|итого|всего|сотрудник|участники|оплата|время|сумма)/i.test(n))
      return;
    seen.add(n.toLowerCase());
    firedNames.push(n);
  };

  const inactiveSectionRe = /^(уволены|уволенные|не\s*работали|не\s*работающие)$/i;
  const uvolenyRe = /уволен/i;

  for (const sub of document.querySelectorAll(".mimic-table__subhead")) {
    const label = normalize(sub.textContent ?? "");
    if (!label) continue;
    subheadLabels.push(label);
    if (!inactiveSectionRe.test(label)) continue;

    let row = sub.nextElementSibling;
    while (row && row.classList.contains("mimic-table__row")) {
      const nameEl = row.querySelector(".user-view__text");
      if (nameEl) addName(nameEl.textContent ?? "");
      row = row.nextElementSibling;
    }
  }

  const allText = document.body?.innerText ?? "";

  return {
    pageTitle: document.title,
    hasFiredHeading: uvolenyRe.test(allText) || subheadLabels.some((l) => uvolenyRe.test(l)),
    hasInactiveSection: subheadLabels.some((l) => inactiveSectionRe.test(l)),
    subheadLabels,
    firedNames,
    snippetAroundFired: (() => {
      const idx = allText.search(/уволен|не\s*работали/i);
      if (idx < 0) return null;
      return allText.slice(Math.max(0, idx - 80), idx + 600);
    })(),
  };
}
