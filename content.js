"use strict";

/* ============================================================
   Maps Lead Scraper — content script
   Runs on https://www.google.com/maps*
   Scrapes the visible results sidebar (feed), auto-scrolls to
   trigger lazy loading, and reports leads back to the popup.
   ============================================================ */

(function () {
  if (window.__mapsLeadScraperInjected) return;
  window.__mapsLeadScraperInjected = true;

  let stopRequested = false;
  let scrapeInProgress = false;

  // --------------------------------------------------------
  // Helpers
  // --------------------------------------------------------
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cleanText(str) {
    if (!str) return "";
    return str
      .replace(/\s+/g, " ")
      .replace(/[\u200b\u00a0]/g, " ")
      .trim();
  }

  function safeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        // Swallow "Receiving end does not exist" errors when the popup is closed.
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // Extension context may be invalidated mid-scrape (e.g. reload); ignore.
    }
  }

  // --------------------------------------------------------
  // Locate the scrollable results feed
  // --------------------------------------------------------
  function getFeedElement() {
    // Primary: Google Maps marks the scrollable results list with role="feed".
    let feed = document.querySelector('div[role="feed"]');
    if (feed) return feed;

    // Fallback: the panel that holds the search results, identified by
    // being a scrollable sibling of the search box, containing multiple
    // place links.
    const candidates = Array.from(document.querySelectorAll("div")).filter(
      (div) => {
        const hasPlaceLinks =
          div.querySelectorAll('a[href*="/maps/place/"]').length >= 2;
        const isScrollable = div.scrollHeight > div.clientHeight + 20;
        return hasPlaceLinks && isScrollable;
      },
    );
    return candidates[0] || null;
  }

  // --------------------------------------------------------
  // Locate individual result cards within the feed
  // --------------------------------------------------------
  function getResultCards(feed) {
    if (!feed) return [];

    // Preferred: explicit article roles (Maps' standard result card markup).
    let cards = Array.from(feed.querySelectorAll('div[role="article"]'));
    if (cards.length > 0) return cards;

    // Fallback: each direct child wrapping a place link.
    cards = Array.from(feed.children).filter((child) =>
      child.querySelector('a[href*="/maps/place/"]'),
    );
    if (cards.length > 0) return cards;

    // Last resort: treat each place-link's closest reasonable container as a card.
    const links = Array.from(feed.querySelectorAll('a[href*="/maps/place/"]'));
    const seen = new Set();
    const fallbackCards = [];
    links.forEach((link) => {
      const card = link.closest("div");
      if (card && !seen.has(card)) {
        seen.add(card);
        fallbackCards.push(card);
      }
    });
    return fallbackCards;
  }

  // --------------------------------------------------------
  // Field extraction
  // --------------------------------------------------------
  function extractName(card, placeLink) {
    if (placeLink && placeLink.getAttribute("aria-label")) {
      const label = cleanText(placeLink.getAttribute("aria-label"));
      if (label) return label;
    }

    const headline = card.querySelector(
      '[class*="fontHeadlineSmall"], [class*="fontHeadlineMedium"], [class*="qBF1Pd"]',
    );
    if (headline && headline.textContent) {
      const text = cleanText(headline.textContent);
      if (text) return text;
    }

    // Fallback: first non-empty text node of reasonable length.
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = cleanText(node.textContent);
      if (text.length >= 2 && text.length <= 120) return text;
    }

    return "N/A";
  }

  function extractRatingAndReviews(card) {
    // Preferred: the accessible rating widget, e.g. aria-label="4.5 stars 1,234 Reviews"
    const ratingImg = card.querySelector(
      'span[role="img"][aria-label*="star"]',
    );
    if (ratingImg) {
      const label = ratingImg.getAttribute("aria-label") || "";
      const match = label.match(/([\d.]+)\s*star/i);
      const reviewMatch = label.match(/([\d,]+)\s*review/i);
      const rating = match ? match[1] : "N/A";
      const reviews = reviewMatch ? reviewMatch[1].replace(/,/g, "") : "0";
      return { rating, reviews };
    }

    // Fallback: scan visible text for a "4.5 (1,234)" or "4.5(1,234)" pattern.
    const text = cleanText(card.textContent);
    const combinedMatch = text.match(/(\d\.\d)\s*\(?([\d,]+)\)?/);
    if (combinedMatch) {
      return {
        rating: combinedMatch[1],
        reviews: combinedMatch[2].replace(/,/g, ""),
      };
    }

    return { rating: "N/A", reviews: "0" };
  }

  function extractPhone(card) {
    // Primary approach: Inspect underlying call endpoints natively embedded
    const telLink = card.querySelector('a[href^="tel:"]');
    if (telLink) {
      return cleanText(telLink.href.replace("tel:", ""));
    }

    // Fallback approach: Scan textual contents accurately
    const text = cleanText(card.textContent);
    const phoneRegex =
      /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = text.match(phoneRegex);
    if (!matches) return "N/A";

    for (const candidate of matches) {
      const digitCount = candidate.replace(/\D/g, "").length;
      if (digitCount >= 10 && digitCount <= 15) {
        return cleanText(candidate);
      }
    }
    return "N/A";
  }

  function extractWebsite(card) {
    const links = Array.from(card.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = link.href || "";
      const ariaLabel = (link.getAttribute("aria-label") || "").toLowerCase();
      if (ariaLabel.startsWith("website")) {
        return href;
      }
    }
    for (const link of links) {
      const href = link.href || "";
      if (
        href &&
        !href.includes("google.com/maps") &&
        !href.startsWith("tel:") &&
        !href.startsWith("javascript:") &&
        (href.startsWith("http://") || href.startsWith("https://"))
      ) {
        return href;
      }
    }
    return "N/A";
  }

  function extractMapsUrl(card, placeLink) {
    if (placeLink && placeLink.href) return placeLink.href;
    const anyPlaceLink = card.querySelector('a[href*="/maps/place/"]');
    return anyPlaceLink ? anyPlaceLink.href : "N/A";
  }

  function extractLead(card) {
    const placeLink = card.querySelector('a[href*="/maps/place/"]');

    const name = extractName(card, placeLink);
    const { rating, reviews } = extractRatingAndReviews(card);
    const phone = extractPhone(card);
    const website = extractWebsite(card);
    const mapsUrl = extractMapsUrl(card, placeLink);

    if (!name || name === "N/A") return null;
    if (mapsUrl === "N/A") return null;

    return {
      name: sanitizeField(name),
      rating: sanitizeField(rating),
      reviews: sanitizeField(reviews),
      phone: sanitizeField(phone),
      website: sanitizeField(website),
      mapsUrl,
    };
  }

  function sanitizeField(value) {
    if (value === null || value === undefined) return "N/A";
    const cleaned = cleanText(String(value));
    return cleaned.length > 0 ? cleaned : "N/A";
  }

  function dedupeLeads(leads) {
    const seen = new Set();
    const result = [];
    for (const lead of leads) {
      const key =
        lead.mapsUrl !== "N/A" ? lead.mapsUrl : `${lead.name}|${lead.phone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(lead);
    }
    return result;
  }

  function collectLeads(feed, maxLeads) {
    const cards = getResultCards(feed);
    const leads = [];
    for (const card of cards) {
      if (leads.length >= maxLeads) break;
      const lead = extractLead(card);
      if (lead) leads.push(lead);
    }
    return dedupeLeads(leads).slice(0, maxLeads);
  }

  // --------------------------------------------------------
  // Auto-scroll loop
  // --------------------------------------------------------
  async function autoScrollAndScrape(maxLeads, isPaidUser) {
    const feed = getFeedElement();
    if (!feed) {
      throw new Error(
        "Could not find the Maps results list. Make sure you have run a search and the sidebar is showing results.",
      );
    }

    let lastCardCount = 0;
    let stableRounds = 0;
    const MAX_STABLE_ROUNDS = 6;
    const SCROLL_WAIT_MS = 900;
    const HARD_ROUND_LIMIT = 200; // safety valve against infinite loops

    let round = 0;
    let limitHitNotified = false;

    while (round < HARD_ROUND_LIMIT) {
      round += 1;

      if (stopRequested) break;

      const currentCards = getResultCards(feed);
      safeSendMessage({
        action: "SCRAPE_PROGRESS",
        count: Math.min(currentCards.length, maxLeads),
      });

      if (currentCards.length >= maxLeads) {
        if (!isPaidUser && !limitHitNotified && maxLeads !== Infinity) {
          limitHitNotified = true;
          safeSendMessage({ action: "SCRAPE_LIMIT_HIT" });
        }
        break;
      }

      // Scroll the feed to the bottom to trigger lazy loading of more results.
      feed.scrollTop = feed.scrollHeight;
      await delay(SCROLL_WAIT_MS);

      if (stopRequested) break;

      const newCards = getResultCards(feed);
      if (newCards.length <= lastCardCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }
      lastCardCount = newCards.length;

      if (stableRounds >= MAX_STABLE_ROUNDS) {
        // No new results after several scroll attempts: likely reached the
        // end of the list (Maps shows "You've reached the end of the list").
        break;
      }
    }

    return collectLeads(
      feed,
      maxLeads === Infinity ? Number.MAX_SAFE_INTEGER : maxLeads,
    );
  }

  // --------------------------------------------------------
  // Message handling
  // --------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return;

    if (message.action === "START_SCRAPE") {
      if (scrapeInProgress) {
        sendResponse({ started: false, reason: "already-running" });
        return;
      }

      stopRequested = false;
      scrapeInProgress = true;
      sendResponse({ started: true });

      const maxLeads =
        message.maxLeads === Infinity || message.maxLeads === undefined
          ? Infinity
          : Number(message.maxLeads);
      const isPaidUser = !!message.isPaidUser;

      autoScrollAndScrape(maxLeads, isPaidUser)
        .then((leads) => {
          safeSendMessage({ action: "SCRAPE_COMPLETE", leads });
        })
        .catch((err) => {
          safeSendMessage({
            action: "SCRAPE_ERROR",
            message: (err && err.message) || "Unknown error while scraping.",
          });
        })
        .finally(() => {
          scrapeInProgress = false;
          stopRequested = false;
        });

      return true;
    }

    if (message.action === "STOP_SCRAPE") {
      stopRequested = true;
      sendResponse({ stopping: true });
    }
  });
})();
