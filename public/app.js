
const $ = (selector) => document.querySelector(selector);

const loginView = $("#login-view");
const appView = $("#app-view");
const userLabel = $("#user-label");
const logoutButton = $("#logout");

let currentPlatforms = [];

const API = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const messages = {
        LOGIN_REQUIRED: "Inicia sesión con Discord.",
        GUILD_MEMBERSHIP_REQUIRED: "Debes pertenecer al servidor.",
        ADMIN_REQUIRED: "Solo los administradores pueden hacer esto.",
        OUT_OF_STOCK: "Esta plataforma no tiene stock disponible.",
        ONLY_SYNTHETIC_TEST_ENTRIES_ALLOWED:
          "Solo se permiten entradas sintéticas TEST:."
      };

      throw new Error(
        messages[data.error] || data.message || data.error || "Error de solicitud."
      );
    }

    return data;
  }
};

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#ff8b9b" : "";
}

function getPlatformId(platform) {
  const id = platform._id ?? platform.id;
  return typeof id === "string" ? id : id?.toString?.();
}

async function loadPlatforms() {
  const data = await API.request("/api/platforms");
  currentPlatforms = data.platforms || [];

  const totalStock = currentPlatforms.reduce(
    (sum, platform) => sum + (platform.stock || 0), 0
  );

  $("#platform-count").textContent = currentPlatforms.length;
  $("#stock-count").textContent = totalStock.toLocaleString();

  const list = $("#platform-list");
  const select = $("#import-platform");

  list.replaceChildren();
  select.replaceChildren(new Option("Select a platform", ""));

  $("#empty-state").classList.toggle(
    "hidden", currentPlatforms.length !== 0
  );

  for (const platform of currentPlatforms) {
    const id = getPlatformId(platform);
    if (!id) continue;

    select.add(new Option(platform.name, id));

    const card = document.createElement("article");
    card.className = "platform-card";

    const head = document.createElement("div");
    head.className = "platform-head";

    const icon = document.createElement("div");
    icon.className = "platform-icon";
    icon.textContent = "◈";

    const nameWrap = document.createElement("div");
    const name = document.createElement("div");
    name.className = "platform-name";
    name.textContent = platform.name;

    const type = document.createElement("div");
    type.className = "muted small";
    type.textContent = "Synthetic test inventory";

    nameWrap.append(name, type);
    head.append(icon, nameWrap);

    const description = document.createElement("p");
    description.className = "platform-description";
    description.textContent = platform.description || "No description provided.";

    const row = document.createElement("div");
    row.className = "stock-row";

    const stockWrap = document.createElement("div");
    const number = document.createElement("div");
    number.className = "stock-number";
    number.textContent = Number(platform.stock || 0).toLocaleString();

    const caption = document.createElement("div");
    caption.className = "stock-caption";
    caption.textContent = "ENTRIES AVAILABLE";
    stockWrap.append(number, caption);

    const generate = document.createElement("button");
    generate.className = "button button-primary";
    generate.textContent = "Generate one";
    generate.disabled = Number(platform.stock || 0) <= 0;

    generate.addEventListener("click", async () => {
      if (!confirm(`Consume one test entry from ${platform.name}?`)) return;

      generate.disabled = true;
      generate.textContent = "Processing…";

      try {
        const result = await API.request(
          `/api/platforms/${encodeURIComponent(id)}/generate`,
          { method: "POST" }
        );

        alert(`Test entry:\n\n${result.value}\n\nRemaining: ${result.remaining}`);
        await loadPlatforms();
      } catch (error) {
        alert(error.message);
        await loadPlatforms().catch(() => {});
      } finally {
        generate.disabled = false;
        generate.textContent = "Generate one";
      }
    });

    row.append(stockWrap, generate);

    const meter = document.createElement("div");
    meter.className = "stock-meter";

    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, Number(platform.stock || 0))}%`;
    meter.append(fill);

    card.append(head, description, row, meter);
    list.append(card);
  }
}

async function refreshSession() {
  try {
    const data = await API.request("/api/auth/me");

    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    logoutButton.classList.remove("hidden");
    userLabel.textContent = data.user.username;

    await loadPlatforms();
  } catch (error) {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    logoutButton.classList.add("hidden");
    userLabel.textContent = "Not signed in";

    if (error.message.includes("servidor")) {
      $("#login-message").textContent = error.message;
    }
  }
}

$("#create-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#admin-message");
  showMessage(message, "Creating platform…");

  try {
    await API.request("/api/platforms", {
      method: "POST",
      body: JSON.stringify({
        name: $("#platform-name").value,
        description: $("#platform-description").value
      })
    });

    $("#create-form").reset();
    showMessage(message, "Platform created.");
    await loadPlatforms();
  } catch (error) {
    showMessage(message, error.message, true);
  }
});

$("#import-button").addEventListener("click", async () => {
  const message = $("#admin-message");
  const platformId = $("#import-platform").value;
  const file = $("#import-file").files[0];

  if (!platformId || !file) {
    return showMessage(message, "Choose a platform and a TXT file.", true);
  }

  if (file.size > 1024 * 1024) {
    return showMessage(message, "The TXT file must be smaller than 1 MB.", true);
  }

  showMessage(message, "Reading file…");

  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    if (!lines.length) {
      throw new Error("The file is empty.");
    }

    await API.request(
      `/api/platforms/${encodeURIComponent(platformId)}/import`,
      {
        method: "POST",
        body: JSON.stringify({ lines })
      }
    );

    $("#import-file").value = "";
    showMessage(message, `Imported ${lines.length} test entries.`);
    await loadPlatforms();
  } catch (error) {
    showMessage(message, error.message, true);
  }
});

$("#refresh").addEventListener("click", async () => {
  try {
    await loadPlatforms();
  } catch (error) {
    alert(error.message);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await API.request("/api/auth/logout", { method: "POST" });
  } finally {
    location.reload();
  }
});

// Replace this with your own Discord server invite.
$("#join-link").href = "https://discord.gg/YOUR_INVITE";

const params = new URLSearchParams(location.search);

if (params.get("error") === "not_member") {
  $("#login-message").textContent =
    "You must join our Discord server before accessing AeoGen.";
}

refreshSession().catch(() => {
  $("#login-message").textContent = "Unable to verify access. Please try again.";
});
