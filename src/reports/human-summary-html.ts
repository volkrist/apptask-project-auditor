import type { AuditResult } from "../rules/rule-types.js";
import { buildManagementSummary } from "./management-summary.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHumanSummaryHtml(result: AuditResult): string {
  const { meta } = result;
  const mgmt = buildManagementSummary(result);
  const status =
    meta.failCount > 0
      ? "Требует доработки"
      : meta.warnCount > 0
        ? "Есть предупреждения"
        : "Проблем не найдено";
  const statusClass =
    meta.failCount > 0 ? "bad" : meta.warnCount > 0 ? "warn" : "ok";

  const riskBlocks = mgmt.risks
    .map(
      (risk, idx) => `
      <section class="risk">
        <h3>${idx + 1}. ${escapeHtml(risk.title)}</h3>
        <p><strong>Количество:</strong> ${risk.count}</p>
        <p><strong>Почему это важно:</strong> ${escapeHtml(risk.whyImportant)}</p>
        <p><strong>Что сделать:</strong> ${escapeHtml(risk.action)}</p>
      </section>`,
    )
    .join("");

  const taskBlocks = mgmt.topTasks
    .map(
      (task) => `
      <section class="task">
        <h3>№${escapeHtml(task.id)} — ${escapeHtml(task.title)}</h3>
        <p><a href="${escapeHtml(task.url)}" target="_blank" rel="noopener">Открыть в AppTask</a></p>
        <p><strong>Проблема:</strong> ${escapeHtml(task.problem)}</p>
        <p><strong>Кто:</strong> ${escapeHtml(task.assignees)}</p>
        <p><strong>Что сделать:</strong> ${escapeHtml(task.action)}</p>
      </section>`,
    )
    .join("");

  const highlightItems = mgmt.highlights
    .map((h) => `<li>${escapeHtml(h.text)}</li>`)
    .join("");

  const priorityItems = mgmt.priorities
    .map((p, i) => `<li>${i + 1}. ${escapeHtml(p)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Аудит ${escapeHtml(meta.projectName)} — краткий отчёт</title>
  <style>
    :root { --bg: #f6f7fb; --card: #fff; --text: #1a1d21; --muted: #5c6370; --accent: #5865f2; --bad: #ed4245; --warn: #fee75c; --ok: #57f287; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    .wrap { max-width: 900px; margin: 0 auto; padding: 24px 16px 48px; }
    header { background: var(--card); border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    h1 { margin: 0 0 8px; font-size: 1.6rem; }
    .meta { color: var(--muted); font-size: .95rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 16px; }
    .stat { background: #f0f2f8; border-radius: 8px; padding: 12px; }
    .stat strong { display: block; font-size: 1.4rem; }
    .status { display: inline-block; margin-top: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: .9rem; }
    .status.bad { background: #fde8e8; color: #b42318; }
    .status.warn { background: #fff8db; color: #8a6d00; }
    .status.ok { background: #e8f8ee; color: #1a7f37; }
    section.card { background: var(--card); border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    h2 { margin: 0 0 12px; font-size: 1.2rem; color: var(--accent); }
    h3 { margin: 0 0 8px; font-size: 1.05rem; }
    ul { margin: 0; padding-left: 1.2rem; }
    .risk, .task { border-left: 3px solid var(--accent); padding-left: 12px; margin: 16px 0; }
    a { color: var(--accent); }
    footer { color: var(--muted); font-size: .9rem; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Аудит ${escapeHtml(meta.projectName)}</h1>
      <div class="meta">${escapeHtml(meta.auditedAt)} · ${escapeHtml(meta.boardUrl)}</div>
      <div class="stats">
        <div class="stat"><strong>${meta.cardsChecked}</strong>проверено задач</div>
        <div class="stat"><strong>${meta.failCount}</strong>критичных</div>
        <div class="stat"><strong>${meta.warnCount}</strong>предупреждений</div>
      </div>
      <span class="status ${statusClass}">${escapeHtml(status)}</span>
    </header>

    <section class="card">
      <h2>Итог</h2>
      <p>${escapeHtml(mgmt.introNarrative)}</p>
    </section>

    <section class="card">
      <h2>Что важно сейчас</h2>
      <ul>${highlightItems || "<li>Существенных рисков не выявлено</li>"}</ul>
    </section>

    <section class="card">
      <h2>Что сделать в первую очередь</h2>
      <ol>${priorityItems || "<li>Дополнительных действий не требуется</li>"}</ol>
    </section>

    <section class="card">
      <h2>Главные риски</h2>
      ${riskBlocks || "<p>Существенных рисков не выявлено.</p>"}
    </section>

    <section class="card">
      <h2>Топ задач для разбора</h2>
      ${taskBlocks || "<p>Задач, требующих срочного разбора, не найдено.</p>"}
    </section>

    <section class="card">
      <h2>Scrum / смета</h2>
      <ul>${mgmt.scrumBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
    </section>

    <section class="card">
      <h2>Фактическое время</h2>
      <ul>${mgmt.trackingBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
    </section>

    <footer>
      Полный технический отчёт — в файле <strong>audit-report.md</strong>.
    </footer>
  </div>
</body>
</html>
`;
}
