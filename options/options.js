const input = document.getElementById("apiKey");
const status = document.getElementById("status");
const tbody = document.querySelector("#usageTable tbody");
const totalsEl = document.getElementById("totals");

const paletteToggle = document.getElementById("paletteToggle");
const paletteMenu = document.getElementById("paletteMenu");
const paletteGrid = document.getElementById("paletteGrid");
const paletteCurrentChip = document.getElementById("paletteCurrentChip");
const paletteCurrentName = document.getElementById("paletteCurrentName");

const markSelects = {
  markStyle: document.getElementById("markStyle"),
  markDirection: document.getElementById("markDirection")
};

const PALETTE_ORDER = ["orange", "yellow", "green", "blue", "purple", "gray"];
const PALETTE_NAMES = {
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  gray: "Gray"
};

document.getElementById("modelHint").textContent =
  "Model: " + CONFIG.MODEL + " · " + CONFIG.COST_PER_M_INPUT + "$/1M input · " + CONFIG.COST_PER_M_OUTPUT + "$/1M output";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(v) {
  return "$" + v.toFixed(6);
}

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

function chipBg(color, intensity) {
  const a = intensity === "light" ? 0.35 : 0.75;
  return "rgba(" + CONFIG.PALETTES[color].join(",") + "," + a + ")";
}

function labelFor(color, intensity) {
  return PALETTE_NAMES[color] + (intensity === "light" ? " · light" : "");
}

function reflectCurrent(color, intensity) {
  paletteCurrentChip.style.background = chipBg(color, intensity);
  paletteCurrentName.textContent = labelFor(color, intensity);
  for (const b of paletteGrid.querySelectorAll(".palette-chip")) {
    b.classList.toggle("selected", b.dataset.color === color && b.dataset.intensity === intensity);
  }
}

function buildPalette() {
  for (const color of PALETTE_ORDER) {
    for (const intensity of ["normal", "light"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "palette-chip";
      b.dataset.color = color;
      b.dataset.intensity = intensity;
      b.title = labelFor(color, intensity);
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = chipBg(color, intensity);
      const lb = document.createElement("span");
      lb.className = "chip-label";
      lb.textContent = labelFor(color, intensity);
      b.append(sw, lb);
      b.addEventListener("click", async () => {
        try {
          await browser.storage.local.set({ markColor: color, markIntensity: intensity });
          reflectCurrent(color, intensity);
          paletteMenu.hidden = true;
          flash("Saved.");
        } catch (e) {
          console.error("[qr] options palette:", e);
        }
      });
      paletteGrid.appendChild(b);
    }
  }
}

paletteToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  paletteMenu.hidden = !paletteMenu.hidden;
});

document.addEventListener("click", (e) => {
  if (!paletteMenu.hidden && e.target !== paletteToggle && !paletteMenu.contains(e.target)) {
    paletteMenu.hidden = true;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") paletteMenu.hidden = true;
});

async function load() {
  try {
    const data = await browser.storage.local.get(["apiKey", "markColor", "markIntensity", "markStyle", "markDirection"]);
    if (data.apiKey) input.value = data.apiKey;
    reflectCurrent(data.markColor || "orange", data.markIntensity || "normal");
    for (const key of Object.keys(markSelects)) {
      if (data[key]) markSelects[key].value = data[key];
    }
  } catch (e) {
    console.error("[qr] options load:", e);
    flash("Failed to load settings.");
  }
}

document.getElementById("save").addEventListener("click", async () => {
  try {
    await browser.storage.local.set({ apiKey: input.value.trim() });
    flash("Saved.");
  } catch (e) {
    console.error("[qr] options save:", e);
    flash("Failed to save.");
  }
});

for (const key of Object.keys(markSelects)) {
  markSelects[key].addEventListener("change", async () => {
    try {
      await browser.storage.local.set({ [key]: markSelects[key].value });
      flash("Saved.");
    } catch (e) {
      console.error("[qr] options " + key + ":", e);
    }
  });
}

async function renderUsage() {
  try {
    const data = await browser.storage.local.get(["usageLog", "usageTotals"]);
    const usageTotals = data.usageTotals || { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
    totalsEl.textContent =
      "Calls: " + usageTotals.calls +
      " · Input: " + usageTotals.promptTokens +
      " · Output: " + usageTotals.completionTokens +
      " · Cost: " + money(usageTotals.costUsd);

    tbody.innerHTML = "";
    for (const e of (data.usageLog || []).slice(-100).reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + esc(new Date(e.ts).toLocaleString()) + "</td>" +
        "<td>" + esc(e.host) + "</td>" +
        "<td>" + esc(e.mode) + "</td>" +
        "<td>" + e.promptTokens + "</td>" +
        "<td>" + e.completionTokens + "</td>" +
        "<td>" + (e.reasoningTokens || 0) + "</td>" +
        "<td>" + money(e.costUsd) + "</td>";
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error("[qr] options usage:", e);
    totalsEl.textContent = "Failed to load usage log.";
  }
}

document.getElementById("clearUsage").addEventListener("click", async () => {
  await browser.storage.local.set({
    usageLog: [],
    usageTotals: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }
  });
  renderUsage();
  flash("Usage log cleared.");
});

buildPalette();
load();
renderUsage();
