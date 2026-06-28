import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import {
  collectLinkCheckTargets,
  formatLinkCheckPassReason,
} from "../../src/rules/helpers.js";
import { linksReachableRule } from "../../src/rules/hard/links-reachable.js";

test("collectLinkCheckTargets: ссылки из links и description", () => {
  const task = {
    ...emptyRawTask(),
    links: ["https://example.com/a"],
    descriptionText: "ТЗ https://docs.google.com/document/d/abc/edit",
  };
  const targets = collectLinkCheckTargets(task);
  assert.equal(targets.length, 2);
});

test("linksReachableRule: нет ссылок → PASS", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: true });
  const r = await linksReachableRule.evaluate(emptyRawTask(), { config, allTasks: [] });
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /для проверки нет/i);
});

test("linksReachableRule: linkCheck отключён → SKIP", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: false });
  const task = {
    ...emptyRawTask(),
    links: ["https://example.com"],
  };
  const r = await linksReachableRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "SKIP");
  assert.match(r.reason, /LINK_CHECK_ENABLED/i);
});

test("linksReachableRule: вложение без URL → FAIL", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: false });
  const task = {
    ...emptyRawTask(),
    attachments: [{ name: "file.pdf", url: null }],
  };
  const r = await linksReachableRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /вложение без ссылки/i);
});

test("linksReachableRule: битая ссылка → FAIL", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: true });
  const task = {
    ...emptyRawTask(),
    links: ["http://nonexistent-domain-name-12345.ru"],
  };
  const r = await linksReachableRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /недоступн/i);
});

test("linksReachableRule: example.com → PASS с деталями", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: true });
  const task = {
    ...emptyRawTask(),
    links: ["https://example.com"],
  };
  const r = await linksReachableRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /Проверено ссылок: 1/i);
});

test("formatLinkCheckPassReason lists urls", () => {
  assert.match(
    formatLinkCheckPassReason(["https://a.com", "https://b.com"]),
    /Проверено ссылок: 2/,
  );
});
