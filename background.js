const ROOT_ID = "qr-root";
const promptCache = new Map();
const cache = new Map();

function createMenus() {
  browser.contextMenus.removeAll(() => {
    browser.contextMenus.create({ id: ROOT_ID, title: "Quick Read", contexts: ["page", "selection"] });
    browser.contextMenus.create({ id: "qr-summary", parentId: ROOT_ID, title: "Summary (TL;DR)", contexts: ["page", "selection"] });
    browser.contextMenus.create({ id: "qr-relaxed", parentId: ROOT_ID, title: "Relaxed (key phrases)", contexts: ["page", "selection"] });
    browser.contextMenus.create({ id: "qr-fast", parentId: ROOT_ID, title: "Fast (1-minute digest)", contexts: ["page", "selection"] });
    browser.contextMenus.create({ id: "qr-settings", parentId: ROOT_ID, title: "Settings…", contexts: ["page", "selection"] });
  });
}

browser.runtime.onInstalled.addListener(createMenus);
browser.runtime.onStartup.addListener(createMenus);

browser.tabs.onRemoved.addListener((id) => cache.delete(id));
browser.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading") cache.delete(id);
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "qr-settings") {
    browser.runtime.openOptionsPage();
    return;
  }
  const mode = info.menuItemId.replace("qr-", "");
  browser.tabs.sendMessage(tab.id, { type: "trigger", mode }).catch(() => {});
});

async function loadPrompt(file) {
  if (promptCache.has(file)) return promptCache.get(file);
  const res = await fetch(browser.runtime.getURL("prompts/" + file));
  const text = await res.text();
  promptCache.set(file, text);
  return text;
}

function wordCount(s) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function phraseLimit(count) {
  return clamp(Math.round(count / CONFIG.PHRASE_PER_WORDS), CONFIG.PHRASE_MIN, CONFIG.PHRASE_MAX);
}

function targetWords(count) {
  return clamp(Math.round(count * CONFIG.FAST_WORD_RATIO), CONFIG.FAST_WORD_MIN, CONFIG.FAST_WORD_MAX);
}

async function buildUserPrompt(mode, article) {
  const file = { summary: "summary.md", relaxed: "relaxed.md", fast: "fast.md" }[mode];
  let t = await loadPrompt(file);
  t = t
    .split("{{title}}").join(article.title || "")
    .split("{{byline}}").join(article.byline || "")
    .split("{{published}}").join(article.published || "")
    .split("{{text}}").join(article.text || "");
  if (mode === "relaxed") t = t.split("{{phrase_limit}}").join(String(phraseLimit(wordCount(article.text))));
  if (mode === "fast") t = t.split("{{target_words}}").join(String(targetWords(wordCount(article.text))));
  return t;
}

async function callApi(messages, mode, maxTokens) {
  const { apiKey } = await browser.storage.local.get("apiKey");
  if (!apiKey) return { ok: false, error: "NO_KEY" };

  let res;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: CONFIG.MODEL,
        messages,
        temperature: CONFIG.TEMPERATURE[mode],
        max_tokens: maxTokens,
        response_format: { type: "json_object" }
      })
    });
  } catch (e) {
    return { ok: false, error: "NETWORK" };
  }
  if (!res.ok) return { ok: false, error: "API", status: res.status };

  let json;
  try {
    json = await res.json();
  } catch (e) {
    return { ok: false, error: "PARSE" };
  }

  const choice = json.choices && json.choices[0];
  const message = choice && choice.message;
  const usage = json.usage || null;
  const content = (message && message.content) || "";
  const trimmed = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!trimmed) {
    return { ok: false, error: "EMPTY", reason: choice && choice.finish_reason, usage };
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: "PARSE", snippet: trimmed.slice(0, 200), usage };
  }
  return { ok: true, data, usage };
}

async function handleProcess(msg, sender) {
  try {
    const tabId = sender.tab ? sender.tab.id : -1;
    const entry = cache.get(tabId) || cache.set(tabId, { results: {} }).get(tabId);
    if (entry.results[msg.mode]) {
      return { ok: true, data: entry.results[msg.mode].data, targetWords: entry.results[msg.mode].targetWords };
    }

    const text = (msg.text || "").slice(0, CONFIG.MAX_CHARS);
    const article = { title: msg.title, byline: msg.byline, published: msg.published, text };
    const system = await loadPrompt("system.md");
    const user = await buildUserPrompt(msg.mode, article);
    const messages = [{ role: "system", content: system }, { role: "user", content: user }];

    const tw = msg.mode === "fast" ? targetWords(wordCount(text)) : 0;
    let out = await callApi(messages, msg.mode, CONFIG.MAX_TOKENS[msg.mode]);
    if (!out.ok && out.error === "EMPTY") {
      out = await callApi(messages, msg.mode, CONFIG.MAX_TOKENS_RETRY);
    }

    if (out.ok && out.usage) {
      QRUsage.record({
        ts: Date.now(),
        host: msg.host || "",
        mode: msg.mode,
        promptTokens: out.usage.prompt_tokens || 0,
        completionTokens: out.usage.completion_tokens || 0,
        reasoningTokens: (out.usage.completion_tokens_details && out.usage.completion_tokens_details.reasoning_tokens) || 0,
        costUsd: QRUsage.costOf(out.usage)
      });
      entry.results[msg.mode] = { data: out.data, targetWords: tw };
      return { ok: true, data: out.data, targetWords: tw };
    }

    if (!out.ok) console.error("Quick Read API error:", out.error, out.status || "", out.reason || out.snippet || "");
    return out;
  } catch (e) {
    console.error("Quick Read internal error:", e);
    return { ok: false, error: "INTERNAL" };
  }
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "process") return handleProcess(msg, sender);
  if (msg && msg.type === "metrics") {
    QRUsage.attachMetrics(msg.host, msg.mode, { hits: msg.hits, misses: msg.misses, total: msg.total }).catch(() => {});
  }
});
