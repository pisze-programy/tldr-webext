const PALETTES = {
  orange: [255, 140, 0],
  yellow: [255, 213, 79],
  green: [76, 175, 80],
  blue: [66, 133, 244],
  purple: [156, 93, 229],
  gray: [128, 128, 128]
};

const NORMAL_ALPHA = [0.18, 0.3, 0.42, 0.55, 0.68, 0.82];
const LIGHT_ALPHA = [0.1, 0.17, 0.25, 0.34, 0.44, 0.55];

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
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.tagName === "SCRIPT" || p.tagName === "STYLE" || p.tagName === "MARK") {
          return NodeFilter.FILTER_REJECT;
        }
        if (p.closest("time") || p.closest("figcaption")) {
          return NodeFilter.FILTER_REJECT;
        }
        const h1 = p.closest("h1");
        if (h1) {
          const t = document.title.trim();
          const h = h1.textContent.trim();
          if (t && (t === h || t.startsWith(h))) {
            return NodeFilter.FILTER_REJECT;
          }
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

  function apply(scope, items, opts) {
    const map = buildMap(scope);
    const color = PALETTES[(opts && opts.color) || "orange"] || PALETTES.orange;
    const direction = (opts && opts.direction) || "strong";
    const ramp = (opts && opts.intensity) === "light" ? LIGHT_ALPHA : NORMAL_ALPHA;
    const style = (opts && opts.style) || "marker";
    const wrapped = [];
    const spans = [];
    let misses = 0;
    let wrapWarned = false;

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
      prepared.push({ start: m.start, end: m.end, weight: Math.max(1, Math.min(6, it.weight | 0)) });
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
      const idx = Math.max(0, Math.min(5, direction === "inverse" ? 6 - p.weight : p.weight - 1));
      const bg = "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + ramp[idx] + ")";
      if (style === "underline") {
        const ua = 0.45 + ramp[idx] * 0.5;
        const ubg = "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + ua + ")";
        mark.style.background = "transparent";
        mark.style.backgroundImage = "linear-gradient(90deg," + ubg + "," + ubg + ")";
        mark.style.backgroundRepeat = "no-repeat";
        mark.style.backgroundPosition = "0 100%";
        mark.style.backgroundSize = "0% 2px";
        mark.classList.add("qr-style-underline");
      } else if (style === "sweep") {
        mark.style.backgroundImage = "linear-gradient(90deg," + bg + "," + bg + ")";
        mark.style.backgroundRepeat = "no-repeat";
        mark.style.backgroundSize = "0% 100%";
        mark.classList.add("qr-style-sweep");
      } else {
        mark.style.background = bg;
        if ((direction === "strong" && p.weight === 6) || (direction === "inverse" && p.weight === 1)) {
          mark.style.boxShadow = "0 0 0 1px rgba(" + color[0] + "," + color[1] + "," + color[2] + ",0.4)";
        }
        mark.classList.add("qr-reveal");
      }
      try {
        range.surroundContents(mark);
        wrapped.push({ mark, start: p.start });
        spans.push({ start: p.start, end: p.end });
      } catch (e) {
        try {
          const frag = range.extractContents();
          mark.appendChild(frag);
          range.insertNode(mark);
          wrapped.push({ mark, start: p.start });
          spans.push({ start: p.start, end: p.end });
        } catch (e2) {
          if (!wrapWarned) {
            wrapWarned = true;
            console.warn("[qr] mark wrap failed:", e2);
          }
          misses++;
        }
      }
    }

    wrapped.sort((a, b) => a.start - b.start);
    wrapped.forEach((w, i) => {
      w.mark.style.animationDelay = i * CONFIG.MARK_STAGGER_MS + "ms";
    });

    return { marks: wrapped.map((w) => w.mark), misses };
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
