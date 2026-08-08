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
    switch (res.error) {
      case "NO_KEY": return "Quick Read: set your API key in Add-ons → Settings.";
      case "NETWORK": return "Quick Read: network error.";
      case "EMPTY": return "Quick Read: the model returned an empty response.";
      case "PARSE": return "Quick Read: unexpected response from the model.";
      case "API": return "Quick Read: API error " + (res.status || "") + " — check the model name and API key.";
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

  function apply(mode, data, article, targetWords) {
    state.active = mode;
    if (mode === "summary") {
      const el = QRRender.summary(data, article);
      if (article.container) {
        article.container.parentNode.insertBefore(el, article.container);
      } else {
        document.body.prepend(el);
      }
      state.extra = [el];
    } else if (mode === "relaxed") {
      const scope = article.container || document.body;
      const result = QRMark.apply(scope, data.phrases || []);
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
        .catch(() => {});
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

  async function run(mode) {
    if (state.active === mode) {
      restore();
      return;
    }
    restore();
    loading(true);
    try {
      const article = await extractArticle();
      if (!article) {
        toast("Quick Read: no readable content on this page.", true);
        return;
      }
      if (!state.originalHTML && article.container) state.originalHTML = article.container.innerHTML;
      state.container = article.container || null;
      state.scope = article.container || document.body;

      const res = await browser.runtime.sendMessage({
        type: "process",
        mode,
        host: location.hostname,
        title: article.title,
        byline: article.byline,
        published: article.published,
        text: article.text
      });

      if (!res || res.ok !== true) {
        toast(errMessage(res || {}), true);
        return;
      }
      apply(mode, res.data, article, res.targetWords);
    } catch (e) {
      console.error(e);
      toast("Quick Read: unexpected error.", true);
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
      run(msg.mode);
    }
  });
})();
