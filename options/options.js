const input = document.getElementById("apiKey");
const status = document.getElementById("status");

function flash(msg) {
  status.textContent = msg;
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

async function load() {
  const { apiKey } = await browser.storage.local.get("apiKey");
  if (apiKey) input.value = apiKey;
}

document.getElementById("save").addEventListener("click", async () => {
  await browser.storage.local.set({ apiKey: input.value.trim() });
  flash("Saved.");
});

load();
