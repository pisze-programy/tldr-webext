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
    el.className = "qr-digest";

    const head = document.createElement("header");
    head.className = "qr-digest-head";

    const label = document.createElement("span");
    label.className = "qr-digest-label";
    label.textContent = "Summary";

    const metaEl = document.createElement("span");
    metaEl.className = "qr-digest-meta";
    metaEl.textContent = [meta.title, meta.byline, meta.published].filter(Boolean).join(" · ");

    head.append(label, metaEl);

    const tldr = document.createElement("p");
    tldr.className = "qr-tldr";
    tldr.textContent = data.tldr || "";

    const list = document.createElement("ul");
    for (const b of data.bullets || []) {
      const li = document.createElement("li");
      li.textContent = b;
      list.append(li);
    }

    el.append(head, tldr, list);
    return el;
  }

  function fast(data, meta) {
    const html = [];
    html.push(
      '<div class="qr-fast-head">' +
        '<span class="qr-fast-label">Fast digest</span>' +
        '<span class="qr-fast-meta">' +
        esc(meta.targetWords) + " words · ~" + esc(meta.seconds) + " s read · original ~" + esc(meta.originalWords) + " words" +
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

  return { summary, fast };
})();
