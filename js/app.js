// js/app.js
import { db } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { initTabs, renderStandings, renderLeaders, renderLogs, initTicker } from "./render.js";
import { initVoting, initPredictionLeaders } from "./live.js";
import { initShopUI } from "./shop.js";
import { initSlotsUI } from "./slots.js";
import { initSuggestions } from "./suggestions.js";

const el = (id) => document.getElementById(id);

// -----------------------------
// Safe JSON loader
// -----------------------------
async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

// -----------------------------
// Init static panels (no auth needed)
// -----------------------------
async function initStaticPanels() {
  try {
    const standings = await loadJSON("data/standings.json");
    const leaders = await loadJSON("data/leaders.json");
    const schedule = await loadJSON("data/schedule.json");
    const headlines = await loadJSON("data/headlines.json").catch(() => ({ items: [] }));

    renderStandings(standings);
    renderLeaders(leaders);
    renderLogs(schedule);
    initTicker(headlines, schedule);
  } catch (e) {
    console.error("Static panel init failed:", e);
  }
}

// -----------------------------
// Watch logged-in user (from window.__USA_UID__)
// Your index.html sets window.__USA_UID__ on login.
// -----------------------------
let unsubscribeUser = null;

function attachUserListener(uid) {
  // clear old listener if switching accounts
  if (typeof unsubscribeUser === "function") unsubscribeUser();

  const userRef = doc(db, "users", uid);
  unsubscribeUser = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) return;
    const u = snap.data();

    // HUD updates
    const username = u.username ?? "User";
    const coins = u.coins ?? 0;
    const correct = u.correctPicks ?? 0;
    const total = u.totalPicks ?? 0;

    const hudUsername = el("hudUsername");
    const hudCoins = el("hudCoins");
    const hudVoteCount = el("hudVoteCount");
    const hudVotePct = el("hudVotePct");

    if (hudUsername) hudUsername.textContent = username;
    if (hudCoins) hudCoins.textContent = String(coins);
    if (hudVoteCount) hudVoteCount.textContent = String(total);
    if (hudVotePct) hudVotePct.textContent = total > 0 ? `${Math.round((correct / total) * 100)}%` : "0%";
  });
}

function watchUidAndAttachListener() {
  // If user already logged in before app.js loads
  if (window.__USA_UID__) attachUserListener(window.__USA_UID__);

  // If user logs in later, index.html sets this. We'll poll lightly.
  let lastUid = window.__USA_UID__ || null;

  setInterval(() => {
    const uid = window.__USA_UID__ || null;
    if (uid && uid !== lastUid) {
      lastUid = uid;
      attachUserListener(uid);
    }
    if (!uid && lastUid) {
      // logged out
      lastUid = null;
      if (typeof unsubscribeUser === "function") unsubscribeUser();
      unsubscribeUser = null;
    }
  }, 500);
}

// -----------------------------
// Boot
// -----------------------------
initTabs();         // makes all your .tabBtn switch .tabContent
initStaticPanels(); // standings/leaders/logs/ticker text

// Live features (they can read window.__USA_UID__ when needed)
initVoting();
initPredictionLeaders();
initShopUI();
initSlotsUI();
initSuggestions();

watchUidAndAttachListener();
