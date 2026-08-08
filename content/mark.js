const QRMark = (() => {
  function normalizeChar(c) {
    return c
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201C|\u201D/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .toLowerCase();
  }

  function buildMap(s) {
    const chars = [];
    const map = [];
    let inWs = true;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) {
        if (!inWs) {
          chars.push(" ");
          map.push(i);
          inWs = true;
        }
      } else {
        chars.push(normalizeChar(c));
        map.push(i);
        inWs = false;
      }
    }
    return { norm: chars.join(""), map };
  }

  function stripLeadingArticle(s) {
    return s.replace(/^(the|a|an)\s+/i, "").trim();
  }

  function findRange(node, target) {
    const t = normalizeChar(target).replace(/\s+/g, " ").trim();
    if (!t) return null;
    const { norm, map } = buildMap(node.data);
    let idx = norm.indexOf(t);
    if (idx === -1) {
      const alt = stripLeadingArticle(t);
      if (alt && alt !== t) idx = norm.indexOf(alt);
      if (idx === -1) return null;
      return { start: map[idx], end: map[idx + alt.length - 1] + 1 };
    }
    return { start: map[idx], end: map[idx + t.length - 1] + 1 };
  }

  function textNodes(container) {
    const out = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (p && (p.tagName === "SCRIPT" || p.tagName === "STYLE" || p.tagName === "MARK")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  function apply(container, phrases) {
    const marks = [];
    for (const phrase of phrases || []) {
      const target = normalizeChar(phrase.text || "").replace(/\s+/g, " ").trim();
      if (target.length < 2) continue;
      const weight = phrase.weight === 3 ? 3 : phrase.weight === 2 ? 2 : 1;      for (const node of textNodes(container)) {
        const r = findRange(node, target);
        if (!r || r.start >= r.end) continue;
        try {
          const range = document.createRange();
          range.setStart(node, r.start);
          range.setEnd(node, r.end);
          const mark = document.createElement("mark");
          mark.className = "qr-w" + weight;
          range.surroundContents(mark);
          marks.push(mark);
        } catch (e) {
        }
        break;
      }
    }
    return marks;
  }

  function clear(marks) {
    for (const mark of marks) {
      if (mark && mark.isConnected) {
        const parent = mark.parentNode;
        mark.replaceWith(...mark.childNodes);
        if (parent) parent.normalize();
      }
    }
  }

  return { apply, clear };
})();
