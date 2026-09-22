"use strict";

/* ============================================================
   CONFIGURATION
   ============================================================
   Replace this with the extension name you registered at
   https://extensionpay.com (Dashboard -> your extension's slug).
   This is the same string you use in background.js.
   ============================================================ */
const EXTPAY_EXTENSION_ID = "google-maps-scraper-lead-exporter-to-csv";

const FREE_DAILY_LIMIT = 15;

const extpay = ExtPay(EXTPAY_EXTENSION_ID);

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
const state = {
  isPaidUser: false,
  isScraping: false,
  leads: [],
  todayUsedCount: 0,
  activeTabId: null,
  isMapsTab: false,
};

// ---------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------
const el = {
  app: document.getElementById("app"),
  themeToggle: document.getElementById("themeToggle"),
  themeIconMoon: document.getElementById("themeIconMoon"),
  themeIconSun: document.getElementById("themeIconSun"),
  planBadge: document.getElementById("planBadge"),
  notMapsNotice: document.getElementById("notMapsNotice"),
  usageValue: document.getElementById("usageValue"),
  usageBarFill: document.getElementById("usageBarFill"),
  usageHint: document.getElementById("usageHint"),
  statusCard: document.getElementById("statusCard"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  resultsCount: document.getElementById("resultsCount"),
  resultsList: document.getElementById("resultsList"),
  emptyState: document.getElementById("emptyState"),
  clearBtn: document.getElementById("clearBtn"),
  exportBtn: document.getElementById("exportBtn"),
  upgradeBtn: document.getElementById("upgradeBtn"),
  footerPlanText: document.getElementById("footerPlanText"),
  manageBtn: document.getElementById("manageBtn"),
};

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function setStatus(text, kind) {
  el.statusText.textContent = text;
  el.statusDot.className = "status-dot" + (kind ? ` ${kind}` : "");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------
// Usage tracking (chrome.storage.local, keyed by date)
// ---------------------------------------------------------------
async function loadDailyUsage() {
  const data = await getStorage(["dailyUsage"]);
  const usage = data.dailyUsage;
  const key = todayKey();
  if (usage && usage.date === key) {
    state.todayUsedCount = usage.count;
  } else {
    state.todayUsedCount = 0;
    await setStorage({ dailyUsage: { date: key, count: 0 } });
  }
}

async function addToDailyUsage(n) {
  const key = todayKey();
  state.todayUsedCount += n;
  await setStorage({ dailyUsage: { date: key, count: state.todayUsedCount } });
  renderUsage();
}

function remainingFreeQuota() {
  return Math.max(0, FREE_DAILY_LIMIT - state.todayUsedCount);
}

function renderUsage() {
  if (state.isPaidUser) {
    el.usageValue.textContent = "Unlimited";
    el.usageBarFill.style.width = "100%";
    el.usageBarFill.classList.remove("limit-reached");
    el.usageHint.textContent =
      "Pro plan: unlimited leads and unlimited scrolling.";
    return;
  }
  const used = Math.min(state.todayUsedCount, FREE_DAILY_LIMIT);
  const pct = Math.round((used / FREE_DAILY_LIMIT) * 100);
  el.usageValue.textContent = `${used} / ${FREE_DAILY_LIMIT} leads`;
  el.usageBarFill.style.width = `${pct}%`;
  el.usageBarFill.classList.toggle("limit-reached", used >= FREE_DAILY_LIMIT);
  el.usageHint.textContent =
    used >= FREE_DAILY_LIMIT
      ? "Daily limit reached. Upgrade to Pro for unlimited leads."
      : "Free plan resets daily at midnight, local time.";
}

// ---------------------------------------------------------------
// Theme
// ---------------------------------------------------------------
async function initTheme() {
  const data = await getStorage(["theme"]);
  const theme = data.theme || "light";
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  el.themeIconMoon.style.display = theme === "dark" ? "none" : "block";
  el.themeIconSun.style.display = theme === "dark" ? "block" : "none";
}

el.themeToggle.addEventListener("click", async () => {
  const current =
    document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  await setStorage({ theme: next });
});

// ---------------------------------------------------------------
// ExtensionPay
// ---------------------------------------------------------------
async function initPayments() {
  try {
    const user = await extpay.getUser();
    state.isPaidUser = !!user.paid;
    renderPlan();
  } catch (err) {
    console.error("ExtensionPay getUser failed:", err);
    state.isPaidUser = false;
    renderPlan();
  }

  extpay.onPaid.addListener((user) => {
    state.isPaidUser = true;
    renderPlan();
    renderUsage();
    setStatus("Upgrade successful! Unlimited scraping unlocked.", "success");
  });
}

function renderPlan() {
  if (state.isPaidUser) {
    el.planBadge.textContent = "Pro plan";
    el.footerPlanText.textContent = "Pro plan · Unlimited leads";
    el.upgradeBtn.hidden = true;
    el.manageBtn.hidden = false;
  } else {
    el.planBadge.textContent = "Free plan";
    el.footerPlanText.textContent = `Free plan · ${FREE_DAILY_LIMIT} leads / day`;
    el.upgradeBtn.hidden = false;
    el.manageBtn.hidden = true;
  }
}

el.upgradeBtn.addEventListener("click", () => {
  extpay.openPaymentPage();
});

el.manageBtn.addEventListener("click", (e) => {
  e.preventDefault();
  extpay.openPaymentPage();
});

// ---------------------------------------------------------------
// Active tab detection
// ---------------------------------------------------------------
async function detectActiveTab() {
  const tabs = await new Promise((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, resolve),
  );
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) {
    state.isMapsTab = false;
    el.notMapsNotice.hidden = false;
    el.startBtn.disabled = true;
    return;
  }
  state.activeTabId = tab.id;
  state.isMapsTab = !!(tab.url && tab.url.includes("google.com/maps"));
  el.notMapsNotice.hidden = state.isMapsTab;
  el.startBtn.disabled = !state.isMapsTab;
}

// ---------------------------------------------------------------
// Rendering leads list
// ---------------------------------------------------------------
function renderLeads() {
  el.resultsCount.textContent = `${state.leads.length} lead${state.leads.length === 1 ? "" : "s"} captured this session`;
  el.exportBtn.disabled = state.leads.length === 0;

  if (state.leads.length === 0) {
    el.resultsList.innerHTML = "";
    el.resultsList.appendChild(el.emptyState);
    return;
  }

  el.resultsList.innerHTML = state.leads
    .map(
      (lead) => `
      <div class="lead-item">
        <div class="lead-name">${escapeHtml(lead.name)}</div>
        <div class="lead-meta">
          <span>⭐ ${escapeHtml(lead.rating)} (${escapeHtml(lead.reviews)})</span>
          <span>${escapeHtml(lead.phone)}</span>
        </div>
      </div>
    `,
    )
    .join("");
}

// ---------------------------------------------------------------
// Start / Stop scraping
// ---------------------------------------------------------------
el.startBtn.addEventListener("click", async () => {
  if (!state.isMapsTab || !state.activeTabId) {
    setStatus("Open a Google Maps search results page first.", "error");
    return;
  }

  if (!state.isPaidUser && remainingFreeQuota() <= 0) {
    setStatus(
      "Daily limit reached (15/15). Upgrade to Pro for unlimited leads.",
      "error",
    );
    return;
  }

  const maxLeads = state.isPaidUser ? Infinity : remainingFreeQuota();

  state.isScraping = true;
  el.startBtn.hidden = true;
  el.stopBtn.hidden = false;
  setStatus("Scraping... 0 leads found", "working");

  chrome.tabs.sendMessage(
    state.activeTabId,
    { action: "START_SCRAPE", maxLeads, isPaidUser: state.isPaidUser },
    (response) => {
      if (chrome.runtime.lastError) {
        state.isScraping = false;
        el.startBtn.hidden = false;
        el.stopBtn.hidden = true;
        setStatus(
          "Could not reach the Maps page. Refresh the Google Maps tab.",
          "error",
        );
        return;
      }
      // Confirm script execution receipt safely
      if (response && response.started) {
        setStatus("Scraping initialized...", "working");
      }
    },
  );
});

el.stopBtn.addEventListener("click", () => {
  if (!state.activeTabId) return;
  chrome.tabs.sendMessage(state.activeTabId, { action: "STOP_SCRAPE" });
  setStatus("Stopping...", "working");
});

el.clearBtn.addEventListener("click", () => {
  state.leads = [];
  renderLeads();
  setStatus("Results cleared. Ready to scrape.", null);
});

// ---------------------------------------------------------------
// Messages from content script
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  if (message.action === "SCRAPE_PROGRESS") {
    setStatus(
      `Scraping... ${message.count} lead${message.count === 1 ? "" : "s"} found`,
      "working",
    );
  }

  if (message.action === "SCRAPE_LIMIT_HIT") {
    setStatus(
      `Free daily limit reached (${FREE_DAILY_LIMIT}/${FREE_DAILY_LIMIT}). Upgrade to Pro to keep scraping.`,
      "error",
    );
  }

  if (message.action === "SCRAPE_COMPLETE") {
    handleScrapeComplete(message.leads || []);
  }

  if (message.action === "SCRAPE_ERROR") {
    state.isScraping = false;
    el.startBtn.hidden = false;
    el.stopBtn.hidden = true;
    setStatus(
      message.message || "Something went wrong while scraping.",
      "error",
    );
  }
});

async function handleScrapeComplete(newLeads) {
  state.isScraping = false;
  el.startBtn.hidden = false;
  el.stopBtn.hidden = true;

  const allowed = state.isPaidUser ? newLeads.length : remainingFreeQuota();
  const accepted = newLeads.slice(0, allowed);
  const overflow = newLeads.length - accepted.length;

  // De-duplicate against leads already captured this session (by Maps URL, fallback to name+phone)
  const existingKeys = new Set(
    state.leads.map((l) => l.mapsUrl || `${l.name}|${l.phone}`),
  );
  const deduped = accepted.filter((l) => {
    const key = l.mapsUrl || `${l.name}|${l.phone}`;
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });

  state.leads = state.leads.concat(deduped);

  if (!state.isPaidUser && deduped.length > 0) {
    await addToDailyUsage(deduped.length);
  }

  renderLeads();

  if (!state.isPaidUser && overflow > 0) {
    setStatus(
      `Limit reached! Captured ${deduped.length} lead${deduped.length === 1 ? "" : "s"} (daily cap hit). Upgrade to Pro for unlimited.`,
      "error",
    );
  } else {
    setStatus(
      `Done. Captured ${deduped.length} new lead${deduped.length === 1 ? "" : "s"} (${state.leads.length} total this session).`,
      "success",
    );
  }
}

// ---------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------
function toCsvValue(value) {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(leads) {
  const headers = [
    "Business Name",
    "Rating",
    "Total Reviews",
    "Phone Number",
    "Website",
    "Google Maps URL",
  ];
  const rows = leads.map((lead) => [
    lead.name,
    lead.rating,
    lead.reviews,
    lead.phone,
    lead.website,
    lead.mapsUrl,
  ]);

  const lines = [headers, ...rows].map((row) => row.map(toCsvValue).join(","));
  return lines.join("\r\n");
}

el.exportBtn.addEventListener("click", () => {
  if (state.leads.length === 0) return;

  const csv = buildCsv(state.leads);
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `google-maps-leads-${timestamp}.csv`;

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true,
    },
    () => {
      if (chrome.runtime.lastError) {
        setStatus("Export failed. Please try again.", "error");
      } else {
        setStatus(`Exported ${state.leads.length} leads to CSV.`, "success");
      }
      // Revoke after a short delay to ensure the download has started
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  );
});

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
(async function init() {
  await initTheme();
  await loadDailyUsage();
  await detectActiveTab();
  await initPayments();
  renderUsage();
  renderLeads();
  if (state.isMapsTab) {
    setStatus("Ready to scrape.", null);
  } else {
    setStatus("Navigate to a Google Maps search results page.", null);
  }
})();
