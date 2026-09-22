"use strict";

const FREE_DAILY_LIMIT = 15;
let state = {
  isScraping: false,
  scrapedCount: 0,
  activeTabId: null,
  isPaidUser: false,
  leads: [],
};

const el = {
  planBadge: document.getElementById("planBadge"),
  licenseSection: document.getElementById("licenseSection"),
  licenseInput: document.getElementById("licenseInput"),
  activateBtn: document.getElementById("activateBtn"),
  usageValue: document.getElementById("usageValue"),
  usageFill: document.getElementById("usageFill"),
  limitNotice: document.getElementById("limitNotice"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  liveCounter: document.getElementById("liveCounter"),
  exportBtn: document.getElementById("exportBtn"),
  themeToggle: document.getElementById("themeToggle"),
};

// Initialize Application UI Contexts
document.addEventListener("DOMContentLoaded", async () => {
  // Check Payment Status Locally
  const sync = await chrome.storage.local.get([
    "isPaidUser",
    "dailyScrapeCount",
    "lastScrapeDate",
    "theme",
  ]);
  state.isPaidUser = !!sync.isPaidUser;

  // Apply System Visual Styles
  if (sync.theme === "dark")
    document.documentElement.setAttribute("data-theme", "dark");

  // Verify and Reset Usage Quotas at Local Midnight
  const todayStr = new Date().toISOString().split("T")[0];
  let dailyCount = sync.dailyScrapeCount || 0;
  if (sync.lastScrapeDate !== todayStr) {
    dailyCount = 0;
    await chrome.storage.local.set({
      dailyScrapeCount: 0,
      lastScrapeDate: todayStr,
    });
  }

  updateUI(dailyCount);

  // Resolve Target Execution Viewport
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes("google.com/maps")) {
    state.activeTabId = tab.id;
  } else {
    state.activeTabId = null;
    el.startBtn.disabled = true;
    el.startBtn.innerText = "Open Google Maps First";
  }
});

// UI View Update Module
function updateUI(dailyCount) {
  if (state.isPaidUser) {
    el.planBadge.innerText = "Pro Plan";
    el.planBadge.style.color = "var(--upgrade)";
    el.licenseSection.style.display = "none";
    el.usageValue.innerText = "Unlimited";
    el.usageFill.style.width = "100%";
    el.usageFill.classList.remove("limit-reached");
    el.limitNotice.style.display = "none";
  } else {
    el.planBadge.innerText = "Free Tier";
    el.usageValue.innerText = `${dailyCount} / ${FREE_DAILY_LIMIT}`;
    const percentage = Math.min((dailyCount / FREE_DAILY_LIMIT) * 100, 100);
    el.usageFill.style.width = `${percentage}%`;
    if (dailyCount >= FREE_DAILY_LIMIT) {
      el.usageFill.classList.add("limit-reached");
      el.limitNotice.style.display = "block";
      el.startBtn.disabled = true;
    }
  }
}

// Redirect User to your Lemon Squeezy Store Checkout
el.limitNotice.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://rzp.io/rzp/NfNnmMg" });
});

// Lemon Squeezy API Verification Method
el.activateBtn.addEventListener("click", async () => {
  const key = el.licenseInput.value.trim();
  if (!key) return alert("Please enter a license key.");

  el.activateBtn.disabled = true;
  el.activateBtn.innerText = "Verifying...";

  try {
    const response = await fetch(
      "https://api.lemonsqueezy.com/v1/licenses/activate",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          license_key: key,
          instance_name: "Chrome Extension User",
        }),
      },
    );
    const data = await response.json();

    if (data.activated === true) {
      await chrome.storage.local.set({ isPaidUser: true, userLicense: key });
      alert("Pro features unlocked successfully!");
      location.reload();
    } else {
      alert("Invalid license key. Please check your purchase email receipt.");
      el.activateBtn.disabled = false;
      el.activateBtn.innerText = "Activate";
    }
  } catch (err) {
    alert("Connection to license validation API failed. Try again.");
    el.activateBtn.disabled = false;
    el.activateBtn.innerText = "Activate";
  }
});

// Start Scraping Action
el.startBtn.addEventListener("click", () => {
  if (!state.activeTabId) return;
  state.isScraping = true;
  el.startBtn.style.display = "none";
  el.stopBtn.style.display = "block";

  const maxLeads = state.isPaidUser ? Infinity : FREE_DAILY_LIMIT;
  chrome.tabs.sendMessage(state.activeTabId, {
    action: "START_SCRAPE",
    maxLeads,
    isPaidUser: state.isPaidUser,
  });
});

// Stop Scraping Action
el.stopBtn.addEventListener("click", () => {
  if (!state.activeTabId) return;
  chrome.tabs.sendMessage(state.activeTabId, { action: "STOP_SCRAPE" }, () => {
    state.isScraping = false;
    el.startBtn.style.display = "block";
    el.stopBtn.style.display = "none";
  });
});

// Listen for Extraction Pipeline updates
chrome.runtime.onMessage.addListener(async (message) => {
  if (!message) return;

  if (message.action === "SCRAPE_PROGRESS") {
    el.liveCounter.innerText = `${message.count} found`;
  }

  if (message.action === "SCRAPE_LIMIT_HIT") {
    el.limitNotice.style.display = "block";
    el.usageFill.classList.add("limit-reached");
  }

  if (message.action === "SCRAPE_COMPLETE") {
    state.isScraping = false;
    el.startBtn.style.display = "block";
    el.stopBtn.style.display = "none";
    state.leads = message.leads || [];
    el.liveCounter.innerText = `${state.leads.length} captured`;

    if (state.leads.length > 0) {
      el.exportBtn.disabled = false;
      if (!state.isPaidUser) {
        const sync = await chrome.storage.local.get("dailyScrapeCount");
        const currentCount = (sync.dailyScrapeCount || 0) + state.leads.length;
        await chrome.storage.local.set({ dailyScrapeCount: currentCount });
        updateUI(currentCount);
      }
    }
  }
});

// Convert JSON Arrays to Structured Local CSV Downloads
el.exportBtn.addEventListener("click", () => {
  if (state.leads.length === 0) return;

  const headers = [
    "Business Name",
    "Rating",
    "Review Count",
    "Phone Number",
    "Website URL",
    "Maps URL",
  ];
  const rows = state.leads.map((lead) => [
    `"${lead.name.replace(/"/g, '""')}"`,
    lead.rating,
    lead.reviews,
    `"${lead.phone}"`,
    `"${lead.website}"`,
    `"${lead.mapsUrl}"`,
  ]);

  const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join(
    "\n",
  );
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: `maps_leads_${new Date().toISOString().split("T")[0]}.csv`,
    saveAs: true,
  });
});

// Clean Theme Toggle Engine
el.themeToggle.addEventListener("click", async () => {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";

  if (newTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  await chrome.storage.local.set({ theme: newTheme });
});
