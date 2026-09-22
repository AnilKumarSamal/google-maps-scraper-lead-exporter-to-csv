# Maps Lead Scraper (Chrome Extension, Manifest V3)

Extracts Business Name, Rating, Total Reviews, Phone Number, Website, and
Google Maps URL from a Google Maps search results sidebar, auto-scrolls to
load more results, and exports everything to CSV. Free tier is capped at
15 leads/day (tracked in `chrome.storage.local`); paid users get unlimited
scrolling/extraction via [ExtensionPay](https://extensionpay.com).

## Files

```
maps-lead-scraper/
├── manifest.json     # MV3 config
├── popup.html        # Dashboard UI
├── style.css          # Dark/light theme styling
├── popup.js           # UI logic, ExtensionPay, usage tracking, CSV export
├── content.js          # Injected into google.com/maps — scraping + auto-scroll
├── background.js       # Required MV3 service worker for ExtPay's background listener
├── extpay.js            # Official ExtensionPay client library (see below)
└── icons/icon16.png, icon48.png, icon128.png
```

`extpay.js` in this folder is the real, unmodified browser bundle from the
official `extpay` npm package (`node_modules/extpay/dist/ExtPay.js`), which
is exactly what ExtensionPay's own docs tell you to copy into your project
(https://github.com/Glench/ExtPay — "copy the `dist/ExtPay.js` file into
your project"). It is **not** a placeholder or a rewritten stand-in — it's
the vendor's actual client library, dropped in locally because Chrome's
Manifest V3 policy forbids loading remote `<script src="https://...">`
tags for extension pages.

## 1. Register on ExtensionPay (one-time)

1. Go to https://extensionpay.com and sign up (free).
2. Click "Register an Extension." Give it a name/slug — e.g. `maps-lead-scraper`.
3. Set your price/plan for the paid tier (e.g. a one-time payment or monthly
   subscription — your choice, configured entirely on their dashboard).
4. Copy the **extension ID / slug** ExtensionPay gives you.

## 2. Configure the extension

Open **both** of these files and replace the placeholder ID with the exact
slug from step 1 (it must match in both places):

- `popup.js` → `const EXTPAY_EXTENSION_ID = 'maps-lead-scraper';`
- `background.js` → `const extpay = ExtPay('maps-lead-scraper');`

That's the only required configuration — everything else works out of the box.

## 3. Load into Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this `maps-lead-scraper/` folder.
4. Pin the extension from the toolbar puzzle-piece icon for quick access.

## 4. Using it

1. Go to `https://www.google.com/maps`, search for something (e.g.
   "plumbers in Austin TX") so the results sidebar is showing.
2. Click the extension icon.
3. Click **Start Scraping**. Keep the popup open — the live "X leads found"
   counter and auto-scroll only run while the popup is open (this is a
   standard Chrome extension limitation: popups stop scripts when closed,
   so the content script talks to whichever popup happens to be listening).
4. When scrolling reaches the end of the list, or your daily/paid limit is
   hit, click **Export CSV** to download the leads as a `.csv` file.
5. Free accounts get 15 total leads/day, tracked by calendar date and reset
   at local midnight. Click **Upgrade to Pro** to open the ExtensionPay
   checkout page for unlimited leads and unlimited auto-scroll.

## Notes on data quality

- **Name, rating, review count, and Maps URL** are read from Google's
  accessible ARIA markup on each result card (`aria-label`, `role="img"`
  rating widgets), which is the most stable part of Maps' DOM and rarely
  changes shape.
- **Phone** and **Website** are only present in the compact sidebar card for
  some business categories/regions. The scraper extracts them with pattern
  matching (phone regex + external link detection) when Maps renders them
  inline; when a listing doesn't show them in the list view, the field is
  written as `N/A` rather than guessed. (Full detail-pane scraping — opening
  every single result — was intentionally left out per the "standard DOM
  scraping of the active sidebar" requirement, since it's an order of
  magnitude slower and easy to add later as a "deep scrape" mode if needed.)
- Google occasionally changes class names; this scraper deliberately avoids
  relying on obfuscated class names as its _only_ signal and layers ARIA
  roles → semantic classes → text-pattern fallbacks, in that order.

## Permissions used

- `storage` — daily usage counter + theme preference.
- `downloads` — triggers the local CSV file download.
- `activeTab` / `scripting` — talk to the Maps tab.
- Host access to `google.com/maps*` (to scrape) and `extensionpay.com/*`
  (required by ExtPay to check/update paid status).

No data ever leaves the browser except the standard ExtensionPay
paid-status check, which only exchanges your extension ID / user token —
never any scraped lead data.

## Chrome Web Store Submission & Permissions Justification

When submitting to the Chrome Web Store, the developer dashboard will prompt you to provide a single-sentence justification for specific permissions used. Use the following accurate text chunks to pass the automated review swiftly:

- **storage**: Required to securely save user configuration settings (UI dark/light theme preference) and to keep track of the local daily free usage counter to enforce the freemium pricing tier.
- **downloads**: Needed to write and trigger the local browser download of the generated spreadsheet (.csv) file directly to the user's local file system without utilizing a third-party server backend.
- **activeTab / scripting**: Used to dynamically detect if the user is currently on an active Google Maps tab, allowing the pop-up dashboard control module to safely initiate the scraping sequence.
- **Host Permission (`https://www.google.com/maps*`)**: Necessary to inject the DOM parser and auto-scroll content script onto the page to capture and process visible business search results locally.
- **Host Permission (`https://extensionpay.com/*`)**: Explicitly required to authorize the extension background service worker to fetch licensing and paid-user subscription statuses directly from the payment API, bypassing target cross-origin (CORS) security header constraints reliably.

# Maps Lead Scraper - Google Maps B2B Extractor to CSV 🚀

A lightweight, high-performance browser extension utility that automatically extracts business details (Names, Phone numbers, Reviews, and Websites) from Google Maps sidebars and exports them into a local CSV spreadsheet. Runs entirely client-side for absolute data privacy.

## 📥 How to Install Natively (100% Free)

Since this utility is distributed directly to save store platform bloat, you can install it manually in less than a minute:

1. Click the green **Code** button at the top right of this page and select **Download ZIP**.
2. Unzip the downloaded file onto your computer into a folder named `maps-lead-scraper`.
3. Open your Google Chrome browser and navigate to the extensions page by typing: `chrome://extensions/` into the URL bar.
4. In the top right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.
5. Click the **Load unpacked** button in the top left corner.
6. Select the unzipped `maps-lead-scraper` folder containing your files.
7. Pin the extension tool to your browser utility bar for quick one-click launching!

## ⚙️ How to Use

1. Go to `https://google.com` and search for any local business cluster (e.g., "Bakeries in Paris").
2. Open the extension popup panel and click **Start Scraping**.
3. Watch the list automatically scroll and compile listings. Click **Export CSV** to download your spreadsheet locally!
