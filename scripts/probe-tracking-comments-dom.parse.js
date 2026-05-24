/**
 * Browser-side: activity/screenshot cards with «Комментарий:» on tracking page.
 */
function extractTrackingDomComments() {
  const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();

  const URL_RE = /https?:\/\/[^\s<>"']+/gi;
  const TIME_RANGE_RE = /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/;
  const PERCENT_RE = /\d{1,3}\s*%/;

  const cards = [];
  const seen = new Set();

  const extractLinks = (root) => {
    const links = new Set();
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href && /^https?:/i.test(href)) links.add(href.trim());
    });
    const text = root.textContent || "";
    const urlMatches = text.match(URL_RE);
    if (urlMatches) {
      for (const u of urlMatches) links.add(u.replace(/[.,;]+$/, ""));
    }
    return [...links];
  };

  const pickField = (root, labels) => {
    for (const label of labels) {
      const nodes = [...root.querySelectorAll("*")];
      for (const el of nodes) {
        const t = normalize(el.textContent);
        if (!t || t.length > 120) continue;
        if (t.toLowerCase().startsWith(label.toLowerCase())) {
          const val = t.slice(label.length).replace(/^[:：\s]+/, "").trim();
          if (val) return val;
        }
      }
    }
    return null;
  };

  const findCardRoot = (el) => {
    let node = el;
    for (let i = 0; i < 12 && node; i++) {
      const cls = node.className || "";
      if (
        typeof cls === "string" &&
        /activity|screenshot|screen|snapshot|tracking|card|tile|item|proof|report/i.test(
          cls,
        )
      ) {
        return node;
      }
      if (node.tagName === "ARTICLE" || node.getAttribute("data-activity")) {
        return node;
      }
      node = node.parentElement;
    }
    return el.closest(
      ".activity, .screenshot, [class*='activity'], [class*='screenshot'], [class*='tracking'], .card, article",
    );
  };

  const commentMarkers = [...document.querySelectorAll("*")].filter((el) => {
    const t = normalize(el.textContent);
    return (
      t.length <= 80 &&
      (/^комментарий\s*:?$/i.test(t) || /^comment\s*:?$/i.test(t))
    );
  });

  for (const marker of commentMarkers) {
    const card = findCardRoot(marker) || marker.parentElement;
    if (!card) continue;

    const blockText = normalize(card.textContent);
    if (!blockText || blockText.length < 10) continue;

    const key = blockText.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);

    let commentText = "";
    const markerParent = marker.parentElement;
    if (markerParent) {
      const siblings = [...markerParent.children];
      const idx = siblings.indexOf(marker);
      const after = siblings.slice(idx + 1);
      commentText = normalize(after.map((n) => n.textContent).join(" "));
      if (!commentText) {
        commentText = normalize(markerParent.textContent).replace(
          /^комментарий\s*:?\s*/i,
          "",
        );
      }
    }

    const userName =
      pickField(card, ["Сотрудник", "Пользователь", "User", "Исполнитель"]) ||
      normalize(
        card.querySelector(
          ".user-view__text, [class*='user-name'], [class*='employee']",
        )?.textContent,
      ) ||
      null;

    const projectName =
      pickField(card, ["Проект", "Project", "Доска", "Board"]) ||
      normalize(
        card.querySelector("[class*='project'], [class*='board']")?.textContent,
      ) ||
      null;

    const taskName =
      pickField(card, ["Задача", "Task", "Карточка"]) ||
      normalize(
        card.querySelector("a[href*='/board/'], [class*='task']")?.textContent,
      ) ||
      null;

    const timeMatch = blockText.match(TIME_RANGE_RE);
    const percentMatch = blockText.match(PERCENT_RE);

    const skipComment =
      !commentText ||
      /^(очистить|применить|отмена|добавить|сохранить|закрыть)/i.test(commentText);
    if (skipComment && extractLinks(card).length === 0) continue;

    cards.push({
      userName: userName || null,
      projectName: projectName || null,
      taskName: taskName || null,
      timeRange: timeMatch ? timeMatch[0] : null,
      activityPercent: percentMatch ? percentMatch[0] : null,
      commentText: commentText || null,
      links: extractLinks(card),
    });
  }

  if (cards.length === 0) {
    const blocks = [...document.querySelectorAll("*")].filter((el) => {
      const t = el.textContent || "";
      return /комментарий\s*:/i.test(t) && t.length < 2000;
    });
    for (const block of blocks.slice(0, 30)) {
      const card = findCardRoot(block) || block;
      const text = normalize(card.textContent);
      if (!text || seen.has(text.slice(0, 150))) continue;
      seen.add(text.slice(0, 150));
      const commentPart = text.split(/комментарий\s*:/i)[1];
      if (!commentPart) continue;
      cards.push({
        userName: null,
        projectName: null,
        taskName: null,
        timeRange: (text.match(TIME_RANGE_RE) || [])[0] || null,
        activityPercent: (text.match(PERCENT_RE) || [])[0] || null,
        commentText: normalize(commentPart).slice(0, 500) || null,
        links: extractLinks(card),
      });
    }
  }

  return {
    pageTitle: document.title,
    pageUrl: location.href,
    commentMarkerCount: commentMarkers.length,
    cards,
  };
}
