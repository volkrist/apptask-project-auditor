/**
 * Browser-side parser (plain JS — loaded via addScriptTag, not tsx-transpiled).
 */
function parseUsersInPage() {
  const normalize = (s) => s.replace(/\s+/g, " ").trim();

  const TIME_TRACKING_RE =
    /уч[её]т\s*времени\s*:?\s*(включен|выключен|enabled|disabled)/i;
  const INACTIVE_RE =
    /\b(неактивен|не\s*активен|уволен|заблокирован|inactive|deactivated|disabled\s*user|заблокирован)\b/i;
  const ACTIVE_RE = /\b(активен|active\s*user|enabled)\b/i;

  const extractTimeTracking = (text) => {
    const m = text.match(TIME_TRACKING_RE);
    if (!m) return "";
    return normalize(m[1] ?? "");
  };

  const deriveIsActive = (statusText) => {
    const t = normalize(statusText);
    if (!t || TIME_TRACKING_RE.test(t)) return null;
    if (INACTIVE_RE.test(t)) return false;
    if (ACTIVE_RE.test(t)) return true;
    return null;
  };

  const findProfileUrl = (root) => {
    const link = root.querySelector(
      "a[href*='user'], a[href*='profile'], a[href*='/u/']",
    );
    if (!link || !link.href) return null;
    try {
      return new URL(link.href, window.location.href).href;
    } catch {
      return link.href;
    }
  };

  const headerIndexMap = (table) => {
    const headers = [];
    const headCells = table.querySelectorAll("thead th, thead td");
    if (headCells.length > 0) {
      headCells.forEach((cell) =>
        headers.push(normalize(cell.textContent || "").toLowerCase()),
      );
    } else {
      const firstRow = table.querySelector("tr");
      if (firstRow) {
        firstRow.querySelectorAll("th, td").forEach((cell) =>
          headers.push(normalize(cell.textContent || "").toLowerCase()),
        );
      }
    }

    const map = {};
    headers.forEach((h, i) => {
      if (/имя|фио|сотрудник|пользователь|name|full/.test(h)) map.name = i;
      if (/роль|должност|role/.test(h)) map.role = i;
      if (/проект/.test(h)) map.projects = i;
      if (/уч[её]т\s*времени|time\s*track|трекинг/.test(h)) map.time = i;
      if (/статус|status|состояние/.test(h) && !/уч[её]т/.test(h)) map.status = i;
    });
    return map;
  };

  const rowFromCells = (cells, map, rowEl) => {
    const joined = cells.join(" | ");
    const nameIdx = map.name !== undefined ? map.name : 0;
    const fullName = normalize(cells[nameIdx] || cells[0] || "");
    if (!fullName || fullName.length < 2) return null;
    if (/^(имя|пользователь|сотрудник|name)$/i.test(fullName)) return null;

    const role = normalize(cells[map.role !== undefined ? map.role : 1] || "");
    const projectsCount = normalize(
      cells[map.projects !== undefined ? map.projects : 2] || "",
    );
    let timeTrackingStatus = "";
    if (map.time !== undefined) {
      timeTrackingStatus = extractTimeTracking(cells[map.time] || "");
      if (!timeTrackingStatus) timeTrackingStatus = extractTimeTracking(joined);
    } else {
      timeTrackingStatus = extractTimeTracking(joined);
    }

    const statusCell =
      map.status !== undefined ? cells[map.status] || "" : "";
    const visibleStatusText = statusCell ? normalize(statusCell) : null;
    const isActive = deriveIsActive(visibleStatusText || "");

    return {
      fullName,
      role,
      projectsCount,
      timeTrackingStatus,
      profileUrl: findProfileUrl(rowEl),
      visibleStatusText,
      isActive,
    };
  };

  const pickText = (el) => normalize(el && el.textContent ? el.textContent : "");

  const parseFlexTableUsers = () => {
    const out = [];
    const flexRows = document.querySelectorAll(
      ".flex-table--users .flex-table__body > .flex-table__row",
    );
    flexRows.forEach((row) => {
      if (row.classList.contains("flex-table__row--head")) return;
      if (row.querySelector(".flex-table__col--caption")) return;

      const nameEl = row.querySelector(
        ".flex-table__col--users .user-view__text.text-truncate",
      );
      const fullName = pickText(nameEl);
      if (!fullName || fullName.length < 2 || /^\d+$/.test(fullName)) return;

      const roleEl = row.querySelector(".flex-table__col--roles .user-view__text");
      const role = pickText(roleEl).replace(/\s+/g, " ").trim();

      const projectEl = row.querySelector(
        ".flex-table__col--project .user-view__text",
      );
      const projectsRaw = pickText(projectEl);
      const projectsCount = (projectsRaw.match(/\d+/) || [""])[0];

      const timeEl = row.querySelector(".flex-table__col--time .is-timeable");
      const timeTrackingStatus = pickText(timeEl);

      const profileLink = row.querySelector(
        ".flex-table__col--users a[href], a[href*='profile']",
      );
      let profileUrl = null;
      if (profileLink && profileLink.href) {
        try {
          profileUrl = new URL(profileLink.href, window.location.href).href;
        } catch {
          profileUrl = profileLink.href;
        }
      }

      let visibleStatusText = null;
      const statusCol = row.querySelector('[data-title*="Статус"]');
      if (statusCol) {
        const t = pickText(statusCol);
        if (t && !TIME_TRACKING_RE.test(t)) visibleStatusText = t;
      }

      const isActive = deriveIsActive(visibleStatusText || "");

      out.push({
        fullName,
        role,
        projectsCount,
        timeTrackingStatus,
        profileUrl,
        visibleStatusText,
        isActive,
      });
    });
    return out;
  };

  const rows = parseFlexTableUsers();
  if (rows.length > 0) {
    const seen = new Set();
    return rows.filter((r) => {
      const key = r.fullName + "|" + r.role;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const tables = Array.from(document.querySelectorAll("table"));
  for (const table of tables) {
    const map = headerIndexMap(table);
    const bodyRows = table.querySelectorAll("tbody tr");
    const trList =
      bodyRows.length > 0
        ? bodyRows
        : table.querySelectorAll("tr:not(:first-child)");

    trList.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td, th")).map((c) =>
        normalize(c.textContent || ""),
      );
      if (cells.length < 2) return;
      const row = rowFromCells(cells, map, tr);
      if (row) rows.push(row);
    });
  }

  if (rows.length === 0) {
    const rowLike = document.querySelectorAll(
      "[class*='user-row'], [class*='users-list'] > *, [class*='employee']",
    );
    rowLike.forEach((el) => {
      const text = normalize(el.textContent || "");
      if (text.length < 4) return;
      const lines = text
        .split("\n")
        .map((l) => normalize(l))
        .filter(Boolean);
      const fullName = lines[0] || "";
      if (!fullName || fullName.length < 2) return;
      const timeTrackingStatus = extractTimeTracking(text);
      const visibleStatusText =
        lines.find(
          (l) => /статус/i.test(l) && !/уч[её]т\s*времени/i.test(l),
        ) || null;
      rows.push({
        fullName,
        role: lines[1] || "",
        projectsCount: lines.find((l) => /\d+\s*проект/i.test(l)) || "",
        timeTrackingStatus,
        profileUrl: findProfileUrl(el),
        visibleStatusText,
        isActive: deriveIsActive(visibleStatusText || ""),
      });
    });
  }

  const seen = new Set();
  return rows.filter((r) => {
    const key = r.fullName + "|" + r.role;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

window.parseUsersInPage = parseUsersInPage;
