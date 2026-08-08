(function () {
  const MODES = ["summary", "relaxed", "fast"];
  const state = { active: null, container: null, scope: null, originalHTML: null, marks: [], extra: [] };

  function toast(text, isError) {
    const el = document.createElement("div");
    el.className = "qr-toast" + (isError ? " qr-toast-error" : "");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function loading(on) {
    let el = document.querySelector(".qr-loading");
    if (on) {
      if (!el) {
        el = document.createElement("div");
        el.className = "qr-loading";
        el.textContent = "Quick Read…";
        document.body.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  }

  function errMessage(res) {
    if (res.detail) return "Quick Read: " + res.detail;
    switch (res.error) {
      case "NO_KEY": return "Quick Read: set your API key in Add-ons → Settings.";
      case "NO_RESPONSE": return "Quick Read: background not responding — reload the add-on and the page.";
      case "NETWORK": return "Quick Read: network error.";
      case "EMPTY": return "Quick Read: the model returned an empty response.";
      case "PARSE": return "Quick Read: unexpected response from the model.";
      case "TIMEOUT": return "Quick Read: request timed out.";
      case "API": return "Quick Read: API error " + (res.status || "");
      default: return "Quick Read: unexpected error.";
    }
  }

  function restore() {
    if (state.active === "fast") {
      if (state.container && state.originalHTML) {
        state.container.innerHTML = state.originalHTML;
      }
    } else if (state.active === "relaxed") {
      QRMark.clear(state.marks);
      state.marks = [];
    }
    state.extra.forEach((e) => e.remove());
    state.extra = [];
    state.active = null;
  }

  function placeSummary(el, container) {
    if (!container) {
      document.body.prepend(el);
      return;
    }
    const first = container.firstElementChild;
    if (first && /^H[1-6]$/i.test(first.tagName)) {
      container.insertBefore(el, first.nextSibling);
    } else {
      container.parentNode.insertBefore(el, container);
    }
  }

  function apply(mode, data, article, targetWords, markOpts) {
    state.active = mode;
    if (mode === "summary") {
      const el = QRRender.summary(data, article);
      placeSummary(el, article.container);
      state.extra = [el];
    } else if (mode === "relaxed") {
      const scope = article.container || document.body;
      const result = QRMark.apply(scope, data.phrases || [], markOpts);
      state.marks = result.marks;
      const total = (data.phrases || []).length;
      browser.runtime
        .sendMessage({
          type: "metrics",
          mode: "relaxed",
          host: location.hostname,
          hits: result.marks.length,
          misses: result.misses,
          total
        })
        .catch((e) => log("metrics fail: " + e));
    } else if (mode === "fast") {
      const originalWords = (article.text || "").trim().split(/\s+/).filter(Boolean).length;
      const meta = {
        targetWords,
        originalWords,
        seconds: Math.round((targetWords || 0) / 250)
      };
      if (article.container) {
        if (!state.originalHTML) state.originalHTML = article.container.innerHTML;
        article.container.innerHTML = QRRender.fast(data, meta);
      } else {
        const el = QRRender.fastBox(data, meta);
        document.body.prepend(el);
        state.extra = [el];
      }
    }
  }

  function log(msg) {
    console.log("[qr] " + msg);
  }

  async function sendMessageRetry(msg, attempts) {
    for (let i = 1; i <= attempts; i++) {
      try {
        return await browser.runtime.sendMessage(msg);
      } catch (e) {
        if (i === attempts) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  async function run(mode) {
    if (state.active === mode) {
      restore();
      return;
    }
    restore();
    loading(true);
    const t0 = Date.now();
    let phase = "extract";
    try {
      const article = await extractArticle();
      if (!article) {
        loading(false);
        toast("Quick Read: no readable content on this page.", true);
        log("no article +" + (Date.now() - t0) + "ms");
        return;
      }
      log("extract +" + (Date.now() - t0) + "ms chars=" + article.text.length);
      if (!state.originalHTML && article.container) state.originalHTML = article.container.innerHTML;
      state.container = article.container || null;
      state.scope = article.container || document.body;

      const t1 = Date.now();
      phase = "sendMessage";
      const res = await sendMessageRetry(
        {
          type: "process",
          mode,
          host: location.hostname,
          title: article.title,
          byline: article.byline,
          published: article.published,
          text: article.text
        },
        3
      );
      log("sendMessage +" + (Date.now() - t1) + "ms ok=" + !!(res && res.ok === true));

      if (!res || res.ok !== true) {
        loading(false);
        toast(errMessage(res || { error: "NO_RESPONSE" }), true);
        return;
      }
      const t2 = Date.now();
      phase = "apply";
      const markOpts = await browser.storage.local.get(["markStyle", "markColor", "markIntensity", "markDirection"]);
      apply(mode, res.data, article, res.targetWords, markOpts);
      log("apply +" + (Date.now() - t2) + "ms mode=" + mode);
    } catch (e) {
      console.error("[qr] fail mode=" + mode + " phase=" + phase + ":", e);
      loading(false);
      toast("Quick Read: " + ((e && e.message) || "unexpected error") + " (see console)", true);
    } finally {
      loading(false);
    }
  }

  function flashAnchor(anchor) {
    if (!state.scope || !anchor) return;
    const loc = QRMark.locate(state.scope, anchor);
    if (!loc) return;
    try {
      const range = document.createRange();
      range.setStart(loc.startNode, loc.startOffset);
      range.setEnd(loc.endNode, loc.endOffset);
      range.startContainer.parentNode.scrollIntoView({ behavior: "smooth", block: "center" });
      const mark = document.createElement("mark");
      mark.className = "qr-flash";
      range.surroundContents(mark);
      setTimeout(() => {
        if (mark.isConnected) {
          const p = mark.parentNode;
          mark.replaceWith(...mark.childNodes);
          if (p) p.normalize();
        }
      }, 1600);
    } catch (e) {
      console.warn("[qr] flash fail:", e);
    }
  }

  document.addEventListener("click", (ev) => {
    const link = ev.target.closest && ev.target.closest("a.qr-jump");
    if (link && link.dataset && link.dataset.anchor) {
      ev.preventDefault();
      flashAnchor(link.dataset.anchor);
    }
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "trigger" && MODES.includes(msg.mode)) {
      log("trigger " + msg.mode);
      run(msg.mode);
    }
  });
})();
