const QRMark = (() => {
  function normalizeChar(c) {
    return c
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201C|\u201D/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .toLowerCase();
  }

  function normalizeText(s) {
    return normalizeChar(s).replace(/\s+/g, " ").trim();
  }

  function stripLeadingArticle(s) {
    return s.replace(/^(the|a|an)\s+/i, "").trim();
  }

  function textNodes(scope) {
    const out = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
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

  function buildMap(scope) {
    const chars = [];
    const map = [];
    let lastWasSpace = true;
    for (const node of textNodes(scope)) {
      const s = node.data;
      for (let j = 0; j < s.length; j++) {
        const c = s[j];
        if (/\s/.test(c)) {
          if (!lastWasSpace) {
            chars.push(" ");
            map.push({ node, offset: j });
            lastWasSpace = true;
          }
        } else {
          chars.push(normalizeChar(c));
          map.push({ node, offset: j });
          lastWasSpace = false;
        }
      }
    }
    return { text: chars.join(""), map };
  }

  function match(map, target) {
    let idx = map.text.indexOf(target);
    let len = target.length;
    if (idx === -1) {
      const alt = stripLeadingArticle(target);
      if (alt && alt !== target) {
        idx = map.text.indexOf(alt);
        len = alt.length;
      }
    }
    if (idx === -1) return null;
    return { start: idx, end: idx + len };
  }

  function rangeFor(map, start, end) {
    const arr = map.map;
    const s = arr[start];
    const e = arr[end - 1];
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset + 1);
    return range;
  }

  function locate(scope, text) {
    const target = normalizeText(text);
    if (!target) return null;
    const map = buildMap(scope);
    const m = match(map, target);
    if (!m) return null;
    const arr = map.map;
    const s = arr[m.start];
    const e = arr[m.end - 1];
    return { startNode: s.node, startOffset: s.offset, endNode: e.node, endOffset: e.offset + 1 };
  }

  function apply(scope, items) {
    const map = buildMap(scope);
    const marks = [];
    const spans = [];
    let misses = 0;

    const prepared = [];
    for (const it of items || []) {
      const target = normalizeText(it.text || "");
      if (target.length < 2) {
        misses++;
        continue;
      }
      const m = match(map, target);
      if (!m) {
        misses++;
        continue;
      }
      prepared.push({ start: m.start, end: m.end, weight: it.weight === 3 ? 3 : it.weight === 2 ? 2 : 1 });
    }
    prepared.sort((a, b) => b.start - a.start);

    for (const p of prepared) {
      let clash = false;
      for (const sp of spans) {
        if (p.start < sp.end && p.end > sp.start) {
          clash = true;
          break;
        }
      }
      if (clash) {
        misses++;
        continue;
      }
      const range = rangeFor(map, p.start, p.end);
      const mark = document.createElement("mark");
      mark.className = "qr-w" + p.weight;
      try {
        range.surroundContents(mark);
        marks.push(mark);
        spans.push({ start: p.start, end: p.end });
      } catch (e) {
        try {
          const frag = range.extractContents();
          mark.appendChild(frag);
          range.insertNode(mark);
          marks.push(mark);
          spans.push({ start: p.start, end: p.end });
        } catch (e2) {
          misses++;
        }
      }
    }
    return { marks, misses };
  }

  function clear(marks) {
    for (const mark of marks) {
      if (mark && mark.isConnected) {
        const p = mark.parentNode;
        mark.replaceWith(...mark.childNodes);
        if (p) p.normalize();
      }
    }
  }

  return { apply, clear, locate };
})();
