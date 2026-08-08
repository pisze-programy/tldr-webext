(function () {
  const MODES = ["summary", "relaxed", "fast"];
  const state = { active: null, container: null, originalHTML: null, marks: [], extra: [] };

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

  function restore() {
    if (!state.container) return;
    if (state.active === "fast" && state.originalHTML) {
      state.container.innerHTML = state.originalHTML;
    } else if (state.active === "relaxed") {
      QRMark.clear(state.marks);
      state.marks = [];
    } else if (state.active === "summary") {
      state.extra.forEach((e) => e.remove());
      state.extra = [];
    }
    state.active = null;
  }

  function apply(mode, data, article) {
    state.active = mode;
    if (mode === "summary") {
      const el = QRRender.summary(data, article);
      article.container.parentNode.insertBefore(el, article.container);
      state.extra = [el];
    } else if (mode === "relaxed") {
      state.marks = QRMark.apply(article.container, data.phrases || []);
    } else if (mode === "fast") {
      state.extra = [];
      article.container.innerHTML = QRRender.fast(data, article);
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
      const article = extractArticle();
      if (!article) {
        toast("Quick Read: no article found on this page.", true);
        return;
      }
      if (!state.originalHTML) state.originalHTML = article.container.innerHTML;
      state.container = article.container;

      const res = await browser.runtime.sendMessage({
        type: "process",
        mode,
        title: article.title,
        byline: article.byline,
        published: article.published,
        text: article.text
      });

      if (!res || res.ok !== true) {
        toast(
          res && res.error === "NO_KEY"
            ? "Quick Read: set your API key in Add-ons → Settings."
            : "Quick Read: LLM request failed.",
          true
        );
        return;
      }
      apply(mode, res.data, article);
    } catch (e) {
      toast("Quick Read: unexpected error.", true);
    } finally {
      loading(false);
    }
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "trigger" && MODES.includes(msg.mode)) {
      run(msg.mode);
    }
  });
})();
