const input = document.getElementById("apiKey");
const status = document.getElementById("status");
const tbody = document.querySelector("#usageTable tbody");
const totalsEl = document.getElementById("totals");
const dirSelect = document.getElementById("markDirection");

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

async function load() {
  try {
    const data = await browser.storage.local.get(["apiKey", "markDirection"]);
    if (data.apiKey) input.value = data.apiKey;
    if (data.markDirection) dirSelect.value = data.markDirection;
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

dirSelect.addEventListener("change", async () => {
  try {
    await browser.storage.local.set({ markDirection: dirSelect.value });
    flash("Saved.");
  } catch (e) {
    console.error("[qr] options markDirection:", e);
  }
});

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

load();
renderUsage();
