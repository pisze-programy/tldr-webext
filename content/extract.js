function textOf(el) {
  return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
}

function findContainer() {
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
    if (el && textOf(el).length > 800) return el;
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
  return best && bestLen > 800 ? best : null;
}

function extractArticle() {
  const container = findContainer();
  if (!container) return null;

  let parsed = null;
  try {
    const clone = document.cloneNode(true);
    parsed = new Readability(clone).parse();
  } catch (e) {
    parsed = null;
  }
  if (!parsed || !parsed.textContent) return null;

  const published =
    (document.querySelector('meta[property="article:published_time"]') || {}).content || "";
  const byline =
    (document.querySelector('meta[property="article:author"]') || {}).content || parsed.byline || "";

  return {
    title: parsed.title || document.title,
    byline,
    published,
    text: parsed.textContent,
    container
  };
}
