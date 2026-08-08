function textOf(el) {
  return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function wordSet(s) {
  return new Set(s.split(/\s+/).filter((w) => w.length > 2));
}

function overlap(target, candidate) {
  const t = wordSet(target);
  if (!t.size) return 0;
  const c = wordSet(candidate);
  let hit = 0;
  for (const w of t) if (c.has(w)) hit++;
  return hit / t.size;
}

function candidateElements() {
  const els = [];
  const selectors = [
    "article",
    "[role=main]",
    ".post-content",
    ".article-content",
    ".article-body",
    ".entry-content",
    ".blog-content",
    ".post",
    "main"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) els.push(el);
  }
  let best = null;
  let bestLen = 0;
  for (const el of document.querySelectorAll("div, section, p")) {
    const len = textOf(el).length;
    if (len > bestLen) {
      bestLen = len;
      best = el;
    }
  }
  if (best) els.push(best);
  return els;
}

function findContainer(parsed) {
  const target = parsed.textContent;
  let best = null;
  let bestScore = 0;
  for (const el of candidateElements()) {
    if (textOf(el).length < CONFIG.MIN_ARTICLE_CHARS) continue;
    const score = overlap(target, textOf(el));
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return bestScore >= CONFIG.CONTAINER_OVERLAP ? best : null;
}

let readabilityWarned = false;

function tryParse() {
  try {
    const clone = document.cloneNode(true);
    const parsed = new Readability(clone).parse();
    if (parsed && parsed.textContent && parsed.textContent.length >= CONFIG.MIN_ARTICLE_CHARS) {
      return parsed;
    }
  } catch (e) {
    if (!readabilityWarned) {
      readabilityWarned = true;
      console.warn("[qr] Readability failed:", e);
    }
  }
  return null;
}

async function extractArticle() {
  for (const delay of CONFIG.EXTRACT_RETRY_MS) {
    if (delay) await sleep(delay);
    const parsed = tryParse();
    if (parsed) {
      const published =
        (document.querySelector('meta[property="article:published_time"]') || {}).content || "";
      const byline =
        (document.querySelector('meta[property="article:author"]') || {}).content || parsed.byline || "";
      return {
        title: parsed.title || document.title,
        byline,
        published,
        text: parsed.textContent,
        container: findContainer(parsed)
      };
    }
  }
  const bodyText = textOf(document.body);
  if (bodyText.length >= CONFIG.MIN_ARTICLE_CHARS) {
    return {
      title: document.title,
      byline: "",
      published: "",
      text: bodyText.slice(0, CONFIG.MAX_CHARS),
      container: null
    };
  }
  return null;
}
