const ROOT_ID = "qr-root";
const promptCache = new Map();
const cache = new Map();

const MENU_DEFS = [
  { id: ROOT_ID, title: "Quick Read", contexts: ["page", "selection"] },
  { id: "qr-summary", parentId: ROOT_ID, title: "Summary (TL;DR)", contexts: ["page", "selection"] },
  { id: "qr-relaxed", parentId: ROOT_ID, title: "Relaxed (key phrases)", contexts: ["page", "selection"] },
  { id: "qr-fast", parentId: ROOT_ID, title: "Fast (1-minute digest)", contexts: ["page", "selection"] },
  { id: "qr-settings", parentId: ROOT_ID, title: "Settings…", contexts: ["page", "selection"] }
];

let menusPromise = Promise.resolve();

function ensureMenus() {
  menusPromise = menusPromise
    .then(async () => {
      await browser.contextMenus.removeAll();
      for (const def of MENU_DEFS) {
        await browser.contextMenus.create(def);
      }
    })
    .catch((e) => console.error("[qr] context menu error:", e));
  return menusPromise;
}

browser.runtime.onInstalled.addListener(ensureMenus);
browser.runtime.onStartup.addListener(ensureMenus);
ensureMenus();

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

function splitChunks(text, maxLen) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) {
      const at = findParagraphBreak(text, end);
      if (at > start && at - start <= maxLen * 2) end = at;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function distributeLimit(totalLimit, lengths, floor) {
  if (!lengths.length) return [];
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const baseFloor = Math.min(floor, Math.max(1, Math.round(totalLimit / lengths.length)));
  const limits = lengths.map((len) => Math.max(baseFloor, Math.round((len / total) * totalLimit)));
  let sum = limits.reduce((a, b) => a + b, 0);
  let i = 0;
  while (sum > totalLimit && i < lengths.length * 2) {
    const idx = i % limits.length;
    if (limits[idx] > baseFloor) {
      limits[idx]--;
      sum--;
    }
    i++;
  }
  return limits;
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

function chunkNote(index, total) {
  return (
    "NOTE: This is part " + (index + 1) + " of " + total +
    " of a longer article. The excerpt below may begin or end in the middle of a sentence or paragraph. " +
    "Process ONLY the text provided; never invent text that would precede or follow this excerpt."
  );
}

async function buildUserPrompt(mode, article, opts) {
  const file = { summary: "summary.md", relaxed: "relaxed.md", fast: "fast.md" }[mode];
  let t = await loadPrompt(file);
  const note = (opts && opts.chunkNote) || "";
  t = t
    .split("{{title}}").join(article.title || "")
    .split("{{byline}}").join(article.byline || "")
    .split("{{published}}").join(article.published || "")
    .split("{{text}}").join(article.text || "");
  if (mode === "relaxed") {
    const limit = (opts && opts.phraseLimit) || phraseLimit(wordCount(article.text));
    t = t.split("{{phrase_limit}}").join(String(limit));
  }
  if (mode === "fast") {
    const tw = (opts && opts.targetWords) || targetWords(wordCount(article.text));
    t = t.split("{{target_words}}").join(String(tw));
  }
  t = t.split("{{chunk_note}}").join(note);
  return t;
}

async function doCall(body) {
  let apiKey = "";
  try {
    const data = await browser.storage.local.get("apiKey");
    apiKey = data.apiKey || "";
  } catch (e) {
    console.error("[qr] storage read failed:", e);
  }
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

function tryExtractJson(s) {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = s.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    return null;
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
  const finish = choice && choice.finish_reason;
  if (CONFIG.DEBUG) {
    console.log("[qr] api resp finish=" + finish + " len=" + content.length + " usage=" + JSON.stringify(r.json.usage));
  }

  const trimmed = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!trimmed) {
    if (CONFIG.DEBUG) console.warn("[qr] empty content finish=" + finish);
    return { ok: false, error: "EMPTY", reason: finish, usage };
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    const recovered = tryExtractJson(trimmed);
    if (recovered) {
      data = recovered;
    } else {
      if (CONFIG.DEBUG) console.warn("[qr] non-JSON content finish=" + finish + ":", trimmed.slice(0, 300));
      return { ok: false, error: "PARSE", snippet: trimmed.slice(0, 300), usage, reason: finish };
    }
  }
  return { ok: true, data, usage };
}

async function runCall(messages, mode) {
  let out = await callApi(messages, mode, CONFIG.MAX_TOKENS[mode]);
  if (!out.ok && (out.error === "EMPTY" || out.error === "PARSE")) {
    console.log("[qr] retry " + out.error + " with max_tokens=" + CONFIG.MAX_TOKENS_RETRY + " finish=" + out.reason);
    out = await callApi(messages, mode, CONFIG.MAX_TOKENS_RETRY);
  }
  return out;
}

async function callChunk(mode, system, article, chunkText, opts) {
  try {
    const user = await buildUserPrompt(mode, { ...article, text: chunkText }, opts);
    return await runCall([{ role: "system", content: system }, { role: "user", content: user }], mode);
  } catch (e) {
    console.error("[qr] chunk call failed:", e);
    return { ok: false, error: "INTERNAL", detail: (e && e.message) || String(e) };
  }
}

function mergeRelaxed(outs) {
  const phrases = [];
  let usage = null;
  for (const o of outs) {
    phrases.push(...(o.data.phrases || []));
    usage = mergeUsage(usage, o.usage);
  }
  return { data: { phrases }, usage };
}

function mergeSummary(outs) {
  const keywords = [];
  const seen = new Set();
  const sections = [];
  let tldr = "";
  let usage = null;
  for (const o of outs) {
    if (o.data.tldr && !tldr) tldr = o.data.tldr;
    for (const k of o.data.keywords || []) {
      const key = String(k).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        keywords.push(k);
      }
    }
    sections.push(...(o.data.sections || []));
    usage = mergeUsage(usage, o.usage);
  }
  return {
    data: { tldr, keywords: keywords.slice(0, 8), sections: sections.slice(0, 8) },
    usage
  };
}

function mergeFast(outs) {
  const sections = [];
  let tldr = "";
  let usage = null;
  for (const o of outs) {
    if (o.data.tldr && !tldr) tldr = o.data.tldr;
    sections.push(...(o.data.sections || []));
    usage = mergeUsage(usage, o.usage);
  }
  return { data: { tldr, sections: sections.slice(0, 10) }, usage };
}

function mergeByMode(mode, outs) {
  if (mode === "relaxed") return mergeRelaxed(outs);
  if (mode === "fast") return mergeFast(outs);
  return mergeSummary(outs);
}

async function processChunked(mode, article, system) {
  const text = article.text;
  const words = wordCount(text);
  const chunkSize = Math.max(CONFIG.CHUNK_SIZE, Math.ceil(text.length / CONFIG.MAX_CHUNKS));
  const chunks = splitChunks(text, chunkSize);
  const lengths = chunks.map((c) => c.length);

  let phraseLimits = null;
  let wordLimits = null;
  if (mode === "relaxed") phraseLimits = distributeLimit(phraseLimit(words), lengths, CONFIG.CHUNK_MIN_PHRASES);
  if (mode === "fast") wordLimits = distributeLimit(targetWords(words), lengths, CONFIG.CHUNK_MIN_WORDS);

  console.log(
    "[qr] chunked mode=" + mode + " chunks=" + chunks.length +
    " totalChars=" + text.length + " sizes=" + JSON.stringify(lengths)
  );

  const outs = await Promise.all(
    chunks.map((chunk, i) =>
      callChunk(mode, system, article, chunk, {
        phraseLimit: phraseLimits && phraseLimits[i],
        targetWords: wordLimits && wordLimits[i],
        chunkNote: chunkNote(i, chunks.length)
      })
    )
  );

  const ok = outs.filter((o) => o.ok);
  const bad = outs.filter((o) => !o.ok);

  if (bad.length === 0) {
    const merged = mergeByMode(mode, outs);
    return { ok: true, data: merged.data, usage: merged.usage };
  }

  console.error(
    "[qr] chunked partial failure mode=" + mode + " failed=" + bad.length + "/" + outs.length +
    " errors=" + bad.map((b) => b.error + (b.status ? " " + b.status : "")).join(", ")
  );

  if (ok.length === 0) {
    const first = bad[0];
    return { ok: false, error: first.error, status: first.status, detail: first.detail, reason: first.reason, snippet: first.snippet };
  }

  const merged = mergeByMode(mode, ok);
  merged.partial = true;
  merged.partialInfo = "Processed " + ok.length + "/" + chunks.length + " of the article.";
  return merged;
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

    const text = (msg.text || "").trim();
    const words = wordCount(text);
    const article = { title: msg.title, byline: msg.byline, published: msg.published, text };
    const system = await loadPrompt("system.md");

    const tApi = Date.now();
    let out;
    const shouldChunk = text.length > CONFIG.CHUNK_THRESHOLD;
    console.log("[qr] route mode=" + msg.mode + " chars=" + text.length + " chunk=" + shouldChunk);
    if (shouldChunk && (msg.mode === "relaxed" || msg.mode === "summary" || msg.mode === "fast")) {
      out = await processChunked(msg.mode, article, system);
    } else {
      const safe = smartTruncate(text, CONFIG.MAX_CHARS);
      const singleArticle = { ...article, text: safe };
      const user = await buildUserPrompt(msg.mode, singleArticle);
      const messages = [{ role: "system", content: system }, { role: "user", content: user }];
      out = await runCall(messages, msg.mode);
    }
    console.log(
      "[qr] api +" + (Date.now() - tApi) + "ms ok=" + out.ok +
      " error=" + (out.error || "") +
      (out.status ? " status=" + out.status : "") +
      (out.partial ? " partial=" + out.partialInfo : "")
    );

    const tw = msg.mode === "fast" ? targetWords(words) : 0;
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
      return { ok: true, data: out.data, targetWords: tw, partial: out.partial, partialInfo: out.partialInfo };
    }

    if (!out.ok) console.error("Quick Read API error:", out.error, out.status || "", out.reason || out.snippet || "");
    return out;
  } catch (e) {
    console.error("Quick Read internal error:", e, (e && e.stack) || "");
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
