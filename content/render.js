const QRRender = (() => {
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function summary(data, meta) {
    const el = document.createElement("article");
    el.className = "qr-summary";

    const head = document.createElement("header");
    head.className = "qr-summary-head";
    const label = document.createElement("span");
    label.className = "qr-summary-label";
    label.textContent = "Summary";
    const metaEl = document.createElement("span");
    metaEl.className = "qr-summary-meta";
    metaEl.textContent = [meta.title, meta.byline, meta.published].filter(Boolean).join(" · ");
    head.append(label, metaEl);

    const tldr = document.createElement("p");
    tldr.className = "qr-summary-tldr";
    tldr.textContent = data.tldr || "";

    const kw = document.createElement("div");
    kw.className = "qr-summary-keywords";
    for (const k of data.keywords || []) {
      const s = document.createElement("span");
      s.className = "qr-kw";
      s.textContent = k;
      kw.append(s);
    }

    const secs = document.createElement("div");
    secs.className = "qr-summary-sections";
    for (const s of data.sections || []) {
      const sec = document.createElement("section");
      sec.className = "qr-sec";
      const h = document.createElement("h4");
      h.textContent = s.heading || "";
      sec.append(h);
      const ul = document.createElement("ul");
      for (const p of s.points || []) {
        const li = document.createElement("li");
        const txt = document.createElement("span");
        txt.textContent = p.text || "";
        li.append(txt);
        if (p.anchor) {
          const a = document.createElement("a");
          a.className = "qr-jump";
          a.href = "#";
          a.textContent = "more ›";
          a.dataset.anchor = p.anchor;
          li.append(a);
        }
        ul.append(li);
      }
      sec.append(ul);
      secs.append(sec);
    }

    el.append(head, tldr, kw, secs);
    return el;
  }

  function fastHtml(data, meta) {
    const tw = meta.targetWords || 0;
    const ow = meta.originalWords || 0;
    const sec = meta.seconds || Math.round(tw / 250);
    const html = [];
    html.push(
      '<div class="qr-fast-head">' +
        '<span class="qr-fast-label">Fast digest</span>' +
        '<span class="qr-fast-meta">' +
        esc(tw) + " words · ~" + esc(sec) + " s read · original ~" + esc(ow) + " words" +
        "</span>" +
        "</div>"
    );
    html.push('<p class="qr-tldr"><strong>TL;DR</strong> — ' + esc(data.tldr || "") + "</p>");
    for (const s of data.sections || []) {
      html.push("<h2>" + esc(s.heading) + "</h2>");
      html.push("<ul>");
      for (const p of s.points || []) html.push("<li>" + esc(p) + "</li>");
      html.push("</ul>");
    }
    html.push(
      '<p class="qr-fast-note">LLM-generated digest. Right-click → Quick Read → pick another mode to switch.</p>'
    );
    return html.join("");
  }

  function fast(data, meta) {
    return fastHtml(data, meta);
  }

  function fastBox(data, meta) {
    const el = document.createElement("article");
    el.className = "qr-fastbox";
    el.innerHTML = fastHtml(data, meta);
    return el;
  }

  return { summary, fast, fastBox };
})();
