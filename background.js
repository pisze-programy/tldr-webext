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

function smartTruncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars);
  const lastSent = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );
  const cutAt = lastSent > maxChars * 0.75 ? lastSent + 1 : maxChars;
  return text.slice(0, cutAt).trimEnd();
}

function findParagraphBreak(text, near) {
  for (const sep of ["\n\n", "\n", ". ", "! ", "? "]) {
    const before = text.lastIndexOf(sep, near);
    const after = text.indexOf(sep, near);
    if (before === -1 && after === -1) continue;
    if (before === -1) return after + sep.length;
    if (after === -1) return before + sep.length;
    return (near - before) < (after - near) ? before + sep.length : after + sep.length;
  }
  return near;
}

function mergeUsage(a, b) {
  const pick = (u, f) => (u && u[f]) || 0;
  const reasoning = (u) => (u && u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
  return {
    prompt_tokens: pick(a, "prompt_tokens") + pick(b, "prompt_tokens"),
    completion_tokens: pick(a, "completion_tokens") + pick(b, "completion_tokens"),
    completion_tokens_details: {
      reasoning_tokens: reasoning(a) + reasoning(b)
    }
  };
}

async function buildUserPrompt(mode, article, phraseLimitOverride) {
  const file = { summary: "summary.md", relaxed: "relaxed.md", fast: "fast.md" }[mode];
  let t = await loadPrompt(file);
  t = t
    .split("{{title}}").join(article.title || "")
    .split("{{byline}}").join(article.byline || "")
    .split("{{published}}").join(article.published || "")
    .split("{{text}}").join(article.text || "");
  if (mode === "relaxed") {
    const limit = phraseLimitOverride || phraseLimit(wordCount(article.text));
    t = t.split("{{phrase_limit}}").join(String(limit));
  }
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

async function runCall(messages, mode) {
  let out = await callApi(messages, mode, CONFIG.MAX_TOKENS[mode]);
  if (!out.ok && out.error === "EMPTY") {
    out = await callApi(messages, mode, CONFIG.MAX_TOKENS_RETRY);
  }
  return out;
}

async function callRelaxedChunk(system, article, chunkText, limit) {
  const user = await buildUserPrompt("relaxed", { ...article, text: chunkText }, limit);
  return runCall([{ role: "system", content: system }, { role: "user", content: user }], "relaxed");
}

async function callRelaxedChunked(article, system, baseLimit) {
  const mid = findParagraphBreak(article.text, Math.floor(article.text.length / 2));
  const chunkA = article.text.slice(0, mid);
  const chunkB = article.text.slice(mid);
  const limitA = Math.round(baseLimit * 0.55);
  const limitB = Math.round(baseLimit * 0.45);

  const [outA, outB] = await Promise.all([
    callRelaxedChunk(system, article, chunkA, limitA),
    callRelaxedChunk(system, article, chunkB, limitB)
  ]);

  if (!outA.ok || !outB.ok) {
    const ok = outA.ok ? outA : outB;
    const bad = outA.ok ? outB : outA;
    console.error("[qr] relaxed chunk failed:", outA.ok ? "chunkB" : "chunkA", "error=", bad.error, bad.status || "");
    return ok;
  }

  return {
    ok: true,
    data: { phrases: [...(outA.data.phrases || []), ...(outB.data.phrases || [])] },
    usage: mergeUsage(outA.usage, outB.usage)
  };
}

async function handleProcess(msg, sender) {
  try {
    const tabId = sender.tab ? sender.tab.id : -1;
    const entry = cache.get(tabId) || cache.set(tabId, { results: {} }).get(tabId);
    if (entry.results[msg.mode]) {
      console.log("[qr] cache hit mode=" + msg.mode);
      QRUsage.recordHit();
      return { ok: true, data: entry.results[msg.mode].data, targetWords: entry.results[msg.mode].targetWords };
    }

    const text = smartTruncate(msg.text || "", CONFIG.MAX_CHARS);
    const article = { title: msg.title, byline: msg.byline, published: msg.published, text };
    const system = await loadPrompt("system.md");

    const tApi = Date.now();
    let out;
    if (msg.mode === "relaxed" && text.length > CONFIG.CHUNK_THRESHOLD) {
      out = await callRelaxedChunked(article, system, phraseLimit(wordCount(text)));
    } else {
      const user = await buildUserPrompt(msg.mode, article);
      const messages = [{ role: "system", content: system }, { role: "user", content: user }];
      out = await runCall(messages, msg.mode);
    }
    console.log(
      "[qr] api +" + (Date.now() - tApi) + "ms ok=" + out.ok +
      " error=" + (out.error || "") +
      (out.status ? " status=" + out.status : "")
    );

    const tw = msg.mode === "fast" ? targetWords(wordCount(text)) : 0;
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
