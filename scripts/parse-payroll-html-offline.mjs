import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join("output", "debug", "payroll-page.html");
const usersApiPath = path.join("output", "debug", "users-api-response.json");
const outUsers = path.join("output", "debug", "payroll-fired-users.json");
const outSummary = path.join("output", "debug", "payroll-fired-summary.json");

const html = fs.readFileSync(htmlPath, "utf8");

function normalizeName(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const subheadRe =
  /mimic-table__subhead[^>]*>\s*([^<]+?)\s*<\/div>/gi;
const groups = [];
let m;
while ((m = subheadRe.exec(html)) !== null) {
  groups.push(m[1].trim());
}

const groupSections = [];
const parts = html.split(/mimic-table__subhead/);
for (let i = 1; i < parts.length; i++) {
  const chunk = parts[i];
  const labelM = chunk.match(/>\s*([^<]+?)\s*<\/div/);
  const label = labelM ? labelM[1].trim() : "";
  const names = [...chunk.matchAll(/user-view__text[^>]*>([^<]+)</g)].map(
    (x) => x[1].trim(),
  );
  groupSections.push({ label, names });
}

const inactiveLabels = /уволен|не\s*работа/i;
const firedSection =
  groupSections.find((g) => inactiveLabels.test(g.label)) ?? null;

const firedUsers = (firedSection?.names ?? []).map((name) => ({
  name,
  userId: null,
  email: null,
  sourcePath: `dom:mimic-table__subhead:${firedSection?.label ?? ""}`,
  sourceUrl: "https://apptask.ru/c/7/reports/payment",
  rawKeys: ["domName"],
}));

let blockedUsers = [];
if (fs.existsSync(usersApiPath)) {
  const api = JSON.parse(fs.readFileSync(usersApiPath, "utf8"));
  const data = Array.isArray(api.data) ? api.data : [];
  blockedUsers = data
    .filter((u) => u.blocked === true)
    .map((u) => ({
      id: String(u.id),
      realName: String(u.realName ?? "").trim(),
    }));
}

const blockedByName = new Map(
  blockedUsers.map((u) => [normalizeName(u.realName), u]),
);

const matched = [];
const onlyFired = [];
for (const f of firedUsers) {
  if (blockedByName.has(normalizeName(f.name))) matched.push(f.name);
  else onlyFired.push(f.name);
}
const onlyBlocked = blockedUsers
  .filter((u) => !firedUsers.some((f) => normalizeName(f.name) === normalizeName(u.realName)))
  .map((u) => u.realName);

const summary = {
  generatedAt: new Date().toISOString(),
  note: "Post-processed from payroll-page.html; UI label may be «Не работали» not «Уволены»",
  tableSubheads: groups,
  groupSections: groupSections.map((g) => ({ label: g.label, count: g.names.length })),
  firedSectionLabel: firedSection?.label ?? null,
  firedUsersCount: firedUsers.length,
  usersApiBlockedCount: blockedUsers.length,
  compare: {
    matchedByName: matched,
    matchedCount: matched.length,
    onlyInPayrollInactive: onlyFired,
    onlyInBlocked: onlyBlocked,
    exactNameMatch: onlyFired.length === 0 && onlyBlocked.length === 0,
  },
  canUseBlockedAsExactSource: {
    verdict:
      firedUsers.length === 0
        ? "unknown"
        : onlyFired.length === 0 && onlyBlocked.length === 0
          ? "yes — payroll inactive section matches blocked=true by name"
          : onlyFired.length === 0 || matched.length >= Math.min(firedUsers.length, blockedUsers.length) * 0.9
            ? "mostly — review onlyInBlocked / onlyInPayrollInactive"
            : "partial — payroll «не работали» ≠ blocked set",
  },
  payrollProvidesUserId: false,
  usersApiProvidesUserId: true,
};

fs.writeFileSync(
  outUsers,
  JSON.stringify(
    {
      extractedAt: new Date().toISOString(),
      pageUrl: "https://apptask.ru/c/7/reports/payment",
      group: firedSection
        ? { label: firedSection.label, memberCount: firedUsers.length }
        : null,
      users: firedUsers,
    },
    null,
    2,
  ),
  "utf8",
);
fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
