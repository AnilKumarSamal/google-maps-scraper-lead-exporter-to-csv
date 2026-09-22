"use strict";

importScripts("extpay.js");

/* Must match the extension name configured in popup.js (EXTPAY_EXTENSION_ID)
   and registered on your https://extensionpay.com dashboard. */
const extpay = ExtPay("google-maps-scraper-lead-exporter-to-csv");

extpay.startBackground();
