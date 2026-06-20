import type { AuditResult, CardAudit } from "../rules/rule-types.js";
import {
  buildReportViewModel,
  outcomeClass,
  type CheckBlockView,
  type TaskViolationRow,
} from "./report-data.js";
import { escHtml, linkOrText, formatStatusAssigneeLine } from "./report-html-utils.js";
import { ruleLabel } from "./rule-labels.js";
import { BANNED_USER_REPORT_TERMS } from "./rule-verification-methods.js";
import { simplifyReasonText, humanizeDiscordInReportText } from "./report-presentation.js";
import { isEntityRule } from "../rules/rule-scopes.js";

const REPORT_CSS = `
:root {
  --bg: #0f1117;
  --panel: #1a1d27;
  --text: #e8eaef;
  --muted: #9aa3b2;
  --ok: #3dd68c;
  --fail: #f2555a;
  --warn: #f5b942;
  --skip: #8b93a7;
  --link: #6cb6ff;
  --border: #2d3344;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}
a { color: var(--link); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 8px; }
h2 { font-size: 1.25rem; margin: 32px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
h3 { font-size: 1.05rem; margin: 20px 0 8px; }
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.summary-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.summary-card .label { color: var(--muted); font-size: 12px; }
.summary-card .value { font-size: 18px; font-weight: 600; margin-top: 4px; }
.toc { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.toc ol { margin: 0; padding-left: 20px; }
.toc li { margin: 8px 0; }
.toc a { text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.toc-stats { color: var(--muted); font-size: 13px; margin-left: 6px; }
.sub-sources { margin: 8px 0 0; padding-left: 20px; font-size: 13px; color: var(--muted); }
.sub-sources li { margin: 4px 0; }
.check {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  margin: 12px 0;
}
.check-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
.check-title { font-weight: 600; flex: 1 1 240px; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.badge.ok { background: rgba(61,214,140,.15); color: var(--ok); }
.badge.fail { background: rgba(242,85,90,.15); color: var(--fail); }
.badge.warn { background: rgba(245,185,66,.15); color: var(--warn); }
.badge.skip { background: rgba(139,147,167,.15); color: var(--skip); }
.counters { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0 0; }
.ok-brief { margin: 10px 0 0; font-size: 13px; }
.counter-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--text);
  font: inherit;
}
.counter-btn.ok { border-color: rgba(61,214,140,.4); color: var(--ok); }
.counter-btn.fail { border-color: rgba(242,85,90,.4); color: var(--fail); }
.counter-btn.warn { border-color: rgba(245,185,66,.4); color: var(--warn); }
.counter-btn:hover { filter: brightness(1.1); }
.panel { display: none; margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
.panel.open { display: block; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border: 1px solid var(--border); padding: 8px; text-align: left; vertical-align: top; }
th { background: #12151d; color: var(--muted); font-weight: 600; }
.violation-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 8px 0;
  background: #12151d;
}
.violation-card .meta { color: var(--muted); font-size: 12px; margin-top: 6px; }
.registry-table { margin-top: 16px; }
.search { width: 100%; max-width: 420px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: #12151d; color: var(--text); margin: 8px 0 16px; }
.hidden { display: none !important; }
.muted { color: var(--muted); }
.section-anchor { scroll-margin-top: 16px; }
`;

const REPORT_JS = `
document.querySelectorAll('[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-toggle');
    const panel = id ? document.getElementById(id) : null;
    if (panel) panel.classList.toggle('open');
  });
});
const search = document.getElementById('report-search');
if (search) {
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('[data-search]').forEach((el) => {
      const text = (el.getAttribute('data-search') || el.textContent || '').toLowerCase();
      el.classList.toggle('hidden', q.length > 0 && !text.includes(q));
    });
  });
}
`;

function renderViolationRow(v: TaskViolationRow): string {
  const t = v.card.task;
  const id = t.id ? `№${t.id}` : "без номера";
  const title = t.title ?? "(без названия)";
  const cardLine = linkOrText(t.url, `${id} — ${title}`);
  const statusLine = formatStatusAssigneeLine(t.status, t.assignees);
  return `<article class="violation-card" data-search="${escHtml(`${id} ${title} ${v.actual}`)}">
  <div><strong>${escHtml(ruleLabel(v.rule.ruleId))}</strong> <span class="badge ${v.rule.status === "FAIL" ? "fail" : "warn"}">${escHtml(v.rule.status)}</span></div>
  <div>Карточка: ${cardLine}</div>
  <div class="meta">${escHtml(statusLine)}</div>
  <div class="meta"><strong>Факт:</strong> ${escHtml(v.actual)}</div>
  <div class="meta"><strong>Ожидание:</strong> ${escHtml(v.expected)}</div>
  <div class="meta"><strong>Источник:</strong> ${escHtml(v.source)}</div>
</article>`;
}

function renderEntityFinding(f: import("../rules/rule-types.js").EntityFinding): string {
  const actual = humanizeDiscordInReportText(
    f.actualValue?.trim() || simplifyReasonText(f.reason),
  );
  const expected = humanizeDiscordInReportText(
    f.expectedValue?.trim() || f.reason,
  );
  const source = humanizeDiscordInReportText(
    f.source?.trim() || "AppTask / рабочая таблица",
  );
  const link = f.link ? linkOrText(f.link, "открыть источник") : "";
  return `<article class="violation-card">
  <div><strong>${escHtml(ruleLabel(f.ruleId))}</strong> <span class="badge ${f.status === "FAIL" ? "fail" : "warn"}">${escHtml(f.status)}</span></div>
  <div>Объект: ${escHtml(f.objectLabel)}</div>
  <div class="meta"><strong>Факт:</strong> ${escHtml(actual)}</div>
  <div class="meta"><strong>Ожидание:</strong> ${escHtml(expected)}</div>
  <div class="meta"><strong>Источник:</strong> ${escHtml(source)}</div>
  ${link ? `<div class="meta">${link}</div>` : ""}
</article>`;
}

function renderCheckBlock(check: CheckBlockView): string {
  const id = `check-${check.entry.num}`;
  const failPanel = `${id}-fail`;

  let countersHtml = "";
  if (check.showViolationsPanel) {
    const btnClass = check.failCount > 0 ? "fail" : "warn";
    countersHtml = `<div class="counters"><button type="button" class="counter-btn ${btnClass}" data-toggle="${failPanel}">Нарушения: ${check.violationCount}</button></div>`;
  } else {
    countersHtml = `<div class="ok-brief muted">${escHtml(check.okBrief)}</div>`;
  }

  const failParts = [
    ...check.violations.map(renderViolationRow),
    ...check.entityFindings.map(renderEntityFinding),
  ];
  const failHtml =
    failParts.length > 0
      ? failParts.join("")
      : `<p class="muted">Нет детализированных нарушений.</p>`;

  const failPanelHtml = check.showViolationsPanel
    ? `<div class="panel" id="${failPanel}">${failHtml}</div>`
    : "";

  return `<article class="check section-anchor" id="${id}" data-search="${escHtml(`${check.entry.num} ${check.entry.title} ${check.label}`)}">
  <div class="check-head">
    <div class="check-title">${check.entry.num}. ${escHtml(check.entry.title)}</div>
    <span class="badge ${outcomeClass(check.registry.outcome)}">${escHtml(check.registry.outcome)}</span>
  </div>
  <div class="muted">Проверка: ${escHtml(check.label)}</div>
  <div class="muted">Область: ${escHtml(check.entry.scope)} · Проверено: ${escHtml(check.registry.checked)} · Кандидатов: ${escHtml(check.registry.candidates)}</div>
  <div class="muted">Условие: ${escHtml(check.condition)}</div>
  <div class="muted">Метод проверки: ${escHtml(check.verificationMethod)}</div>
  ${check.subSources?.length ? `<ul class="sub-sources">${check.subSources.map((s) => `<li><strong>${escHtml(s.label)}:</strong> ${escHtml(s.status)} — ${escHtml(s.detail)}</li>`).join("")}</ul>` : ""}
  ${countersHtml}
  ${failPanelHtml}
</article>`;
}

function renderRegistryTable(checks: CheckBlockView[]): string {
  const rows = checks
    .map(
      (c) => `<tr data-search="${escHtml(c.entry.title)}">
  <td>${c.entry.num}</td>
  <td><a href="#check-${c.entry.num}">${escHtml(c.entry.title)}</a></td>
  <td>${escHtml(c.entry.scope)}</td>
  <td>${escHtml(c.registry.checked)}</td>
  <td>${escHtml(c.registry.candidates)}</td>
  <td>${escHtml(c.registry.violations)}</td>
  <td><span class="badge ${outcomeClass(c.registry.outcome)}">${escHtml(c.registry.outcome)}</span></td>
</tr>`,
    )
    .join("");
  return `<table class="registry-table"><thead><tr>
  <th>№</th><th>Проверка</th><th>Область</th><th>Проверено</th><th>Кандидатов</th><th>Нарушения</th><th>Итог</th>
</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCardDetails(cards: CardAudit[]): string {
  if (cards.length === 0) {
    return `<p class="muted">Проблемных карточек нет.</p>`;
  }
  return cards
    .map((card) => {
      const t = card.task;
      const id = t.id ? `№${t.id}` : "без номера";
      const title = t.title ?? "(без названия)";
      const violations = card.results.filter(
        (r) =>
          (r.status === "FAIL" || r.status === "WARN") && !isEntityRule(r.ruleId),
      );
      const vHtml = violations
        .map(
          (r) =>
            `<li><strong>${escHtml(ruleLabel(r.ruleId))}</strong> (${escHtml(r.status)}): ${escHtml(simplifyReasonText(r.reason))}</li>`,
        )
        .join("");
      const statusLine = formatStatusAssigneeLine(t.status, t.assignees);
      return `<article class="check" data-search="${escHtml(`${id} ${title}`)}">
  <h3>${linkOrText(t.url, `${id} — ${title}`)}</h3>
  <div class="muted">${escHtml(statusLine)}</div>
  <ul>${vHtml}</ul>
</article>`;
    })
    .join("");
}

export function buildContractAuditHtml(
  result: AuditResult,
  extras: { ignoredCount?: number } = {},
): string {
  const vm = buildReportViewModel(result, extras);
  const s = vm.summary;

  const tocSections = vm.sections
    .map(
      (sec, i) => `<li><a href="#section-${sec.sectionId}">${i + 1}. ${escHtml(sec.section)}</a>
  <span class="toc-stats">· Проверок OK: <span style="color:var(--ok)">${sec.checksOk}</span> · Проверок с нарушениями: <span style="color:var(--fail)">${sec.checksWithViolations}</span></span></li>`,
    )
    .join("");

  const classificationToc = `<li><a href="#classification">${vm.sections.length + 1}. Классификация задач</a>
  <span class="toc-stats">· Потоковые: ${vm.classificationCounts.flow} · UI/front: ${vm.classificationCounts.ui} · Обычные: ${vm.classificationCounts.regular} · Неизвестно: ${vm.classificationCounts.unknown}</span></li>`;

  const sectionBlocks = vm.sections
    .map((sec) => {
      const sectionChecks = vm.checks.filter((c) =>
        sec.checkNums.includes(c.entry.num),
      );
      if (sectionChecks.length === 0) return "";
      return `<section class="section-anchor" id="section-${sec.sectionId}">
  <h2>${escHtml(sec.section)}</h2>
  ${sectionChecks.map(renderCheckBlock).join("")}
</section>`;
    })
    .join("");

  const classificationRows = vm.classificationRows
    .map(
      (row) => `<tr data-search="${escHtml(`${row.id} ${row.title} ${row.bucketLabel}`)}">
  <td>${linkOrText(row.url, `№${row.id}`)}</td>
  <td>${escHtml(row.title)}</td>
  <td>${escHtml(row.bucketLabel)}</td>
  <td>${escHtml(row.reason)}</td>
  <td>${escHtml(row.appliedRules)}</td>
</tr>`,
    )
    .join("");

  const excludedRows =
    vm.excludedCards.length === 0
      ? `<p class="muted">Нет исключённых карточек.</p>`
      : `<ul>${vm.excludedCards
          .map((ex) => {
            const id = ex.id ? `№${ex.id}` : "без номера";
            const line = linkOrText(ex.url, `${id} — ${ex.title}`);
            return `<li>${line} · ${escHtml(ex.status ?? "не указан")} · ${escHtml(ex.assignee ?? "не назначен")}</li>`;
          })
          .join("")}</ul>`;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(vm.title)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="wrap">
    <h1>${escHtml(vm.title)}</h1>
    <p class="muted">Интерактивный отчёт аудита AppTask · ${escHtml(s.auditedAt)}</p>

    <h2>Общая сводка</h2>
    <div class="summary-grid">
      <div class="summary-card"><div class="label">Проект</div><div class="value">${escHtml(s.projectName)}</div></div>
      <div class="summary-card"><div class="label">Доска</div><div class="value" style="font-size:14px">${escHtml(s.boardUrl)}</div></div>
      <div class="summary-card"><div class="label">Карточек на доске</div><div class="value">${s.totalOnBoard}</div></div>
      <div class="summary-card"><div class="label">Проверено</div><div class="value">${s.cardsChecked}</div></div>
      <div class="summary-card"><div class="label">Исключено потоковых</div><div class="value">${s.excludedFlow}</div></div>
      <div class="summary-card"><div class="label">Потоковые / сервисные</div><div class="value">${vm.classificationCounts.flow}</div></div>
      <div class="summary-card"><div class="label">UI / front</div><div class="value">${vm.classificationCounts.ui}</div></div>
      <div class="summary-card"><div class="label">Обычные</div><div class="value">${vm.classificationCounts.regular}</div></div>
      <div class="summary-card"><div class="label">Неизвестно</div><div class="value">${vm.classificationCounts.unknown}</div></div>
      ${s.ignoredManual > 0 ? `<div class="summary-card"><div class="label">Исключено вручную</div><div class="value">${s.ignoredManual}</div></div>` : ""}
      <div class="summary-card"><div class="label">FAIL</div><div class="value" style="color:var(--fail)">${s.failCount}</div></div>
      <div class="summary-card"><div class="label">WARN</div><div class="value" style="color:var(--warn)">${s.warnCount}</div></div>
      <div class="summary-card"><div class="label">CHECKED</div><div class="value">${s.registryChecked}</div></div>
      <div class="summary-card"><div class="label">SKIP</div><div class="value">${s.registrySkip}</div></div>
      <div class="summary-card"><div class="label">NOT_APPLICABLE</div><div class="value">${s.registryNotApplicable}</div></div>
      <div class="summary-card"><div class="label">Статус</div><div class="value" style="font-size:14px">${escHtml(s.status)}</div></div>
    </div>
    <p class="muted">Профиль: ${escHtml(s.profile)} · Источники: ${escHtml(s.sources)}</p>

    <h2 id="toc">Оглавление</h2>
    <nav class="toc"><ol>${tocSections}${classificationToc}</ol></nav>

    <input type="search" id="report-search" class="search" placeholder="Поиск по карточкам и проверкам…" />

    <h2>Реестр проверок</h2>
    ${renderRegistryTable(vm.checks)}

    ${sectionBlocks}

    <section class="section-anchor" id="classification">
      <h2>Классификация задач</h2>
      <table>
        <thead><tr><th>№</th><th>Название</th><th>Тип</th><th>Причина</th><th>Применённые правила</th></tr></thead>
        <tbody>${classificationRows}</tbody>
      </table>
    </section>

    <section id="excluded">
      <h2>Исключённые карточки</h2>
      ${excludedRows}
    </section>

    <section id="cards">
      <h2>Детализация по карточкам</h2>
      ${renderCardDetails(vm.problematicCards)}
    </section>
  </div>
  <script>${REPORT_JS}</script>
</body>
</html>`;

  for (const term of BANNED_USER_REPORT_TERMS) {
    if (html.toLowerCase().includes(term)) {
      throw new Error(`HTML report contains banned term: ${term}`);
    }
  }

  return html;
}
