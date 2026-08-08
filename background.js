const ROOT_ID = "qr-root";
const promptCache = new Map();
const cache = new Map();

let menusReady = false;
let menusPromise = null;

function createMenus() {
  if (menusReady) return;
  if (!menusPromise) {
    menusPromise = browser.contextMenus
      .removeAll()
      .then(() => {
        browser.contextMenus.create({ id: ROOT_ID, title: "Quick Read", contexts: ["page", "selection"] });
        browser.contextMenus.create({ id: "qr-summary", parentId: ROOT_ID, title: "Summary (TL;DR)", contexts: ["page", "selection"] });
        browser.contextMenus.create({ id: "qr-relaxed", parentId: ROOT_ID, title: "Relaxed (key phrases)", contexts: ["page", "selection"] });
        browser.contextMenus.create({ id: "qr-fast", parentId: ROOT_ID, title: "Fast (1-minute digest)", contexts: ["page", "selection"] });
        browser.contextMenus.create({ id: "qr-settings", parentId: ROOT_ID, title: "Settings…", contexts: ["page", "selection"] });
      })
      .then(() => {
        menusReady = true;
      })
      .catch((e) => {
        console.error("[qr] context menu error:", e);
      });
  }
  return menusPromise;
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
  browser.tabs
    .sendMessage(tab.id, { type: "trigger", mode })
    .catch((e) => console.log("[qr] menu click: no content script:", e.message));
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

async function doCall(body) {
  const { apiKey } = await browser.storage.local.get("apiKey");
  if (!apiKey) return { error: "NO_KEY" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        detail = (errBody && errBody.error && errBody.error.message) || "";
      } catch (e) {
        detail = "";
      }
      return { error: "API", status: res.status, detail };
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      return { error: "PARSE", detail: "invalid JSON from API" };
    }
    return { json };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") return { error: "TIMEOUT" };
    return { error: "NETWORK", detail: (e && e.message) || "" };
  }
}

async function callApi(messages, mode, maxTokens) {
  const body = {
    model: CONFIG.MODEL,
    messages,
    temperature: CONFIG.TEMPERATURE[mode],
    max_tokens: maxTokens,
    response_format: { type: "json_object" }
  };
  if (CONFIG.THINKING_DISABLE) body.thinking = { type: "disabled" };

  let r = await doCall(body);
  if (r.error === "API" && r.status === 400 && CONFIG.THINKING_DISABLE) {
    delete body.thinking;
    console.log("[qr] thinking param rejected, retrying without it");
    r = await doCall(body);
  }
  if (r.error) return { ok: false, error: r.error, status: r.status, detail: r.detail };

  const choice = r.json.choices && r.json.choices[0];
  const message = choice && choice.message;
  const usage = r.json.usage || null;
  const content = (message && message.content) || "";
  const trimmed = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!trimmed) {
    if (CONFIG.DEBUG) console.warn("[qr] empty content finish=" + (choice && choice.finish_reason));
    return { ok: false, error: "EMPTY", reason: choice && choice.finish_reason, usage };
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    if (CONFIG.DEBUG) console.warn("[qr] non-JSON content:", trimmed.slice(0, 200));
    return { ok: false, error: "PARSE", snippet: trimmed.slice(0, 200), usage };
  }
  return { ok: true, data, usage };
}

async function handleProcess(msg, sender) {
  try {
    const tabId = sender.tab ? sender.tab.id : -1;
    const entry = cache.get(tabId) || cache.set(tabId, { results: {} }).get(tabId);
    if (entry.results[msg.mode]) {
      console.log("[qr] cache hit mode=" + msg.mode);
      return { ok: true, data: entry.results[msg.mode].data, targetWords: entry.results[msg.mode].targetWords };
    }

    const text = (msg.text || "").slice(0, CONFIG.MAX_CHARS);
    const article = { title: msg.title, byline: msg.byline, published: msg.published, text };
    const tPrompt = Date.now();
    const system = await loadPrompt("system.md");
    const user = await buildUserPrompt(msg.mode, article);
    const messages = [{ role: "system", content: system }, { role: "user", content: user }];
    console.log("[qr] prompt +" + (Date.now() - tPrompt) + "ms");
    if (CONFIG.DEBUG) console.log("[qr] prompt system=" + system.length + " user=" + user.length);

    const tw = msg.mode === "fast" ? targetWords(wordCount(text)) : 0;
    const tApi = Date.now();
    let out = await callApi(messages, msg.mode, CONFIG.MAX_TOKENS[msg.mode]);
    if (!out.ok && out.error === "EMPTY") {
      out = await callApi(messages, msg.mode, CONFIG.MAX_TOKENS_RETRY);
    }
    console.log(
      "[qr] api +" + (Date.now() - tApi) + "ms ok=" + out.ok +
      " error=" + (out.error || "") +
      (out.status ? " status=" + out.status : "")
    );

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
    return { ok: false, error: "INTERNAL", detail: (e && e.message) || String(e) };
  }
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "process") {
    console.log("[qr] process mode=" + msg.mode + " chars=" + (msg.text || "").length);
    return handleProcess(msg, sender);
  }
  if (msg && msg.type === "metrics") {
    QRUsage.attachMetrics(msg.host, msg.mode, { hits: msg.hits, misses: msg.misses, total: msg.total }).catch((e) =>
      console.warn("[qr] metrics fail:", e)
    );
  }
});

console.log("[qr] background ready");
