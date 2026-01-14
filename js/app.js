// js/app.js
import { db } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  initTabs,
  renderStandings,
  renderLeaders,
  renderLogs,
  initTicker,
} from "./render.js";

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
// HUD helpers
// -----------------------------
function clearHud() {
  if (el("hudUsername")) el("hudUsername").textContent = "...";
  if (el("hudCoins")) el("hudCoins").textContent = "0";
  if (el("hudVoteCount")) el("hudVoteCount").textContent = "0";
  if (el("hudVotePct")) el("hudVotePct").textContent = "0%";
}

function applyHudFromUserDoc(u = {}) {
  const username = u.username ?? "User";
  const coins = u.coins ?? 0;
  const correct = u.correctPicks ?? 0;
  const total = u.totalPicks ?? 0;

  if (el("hudUsername")) el("hudUsername").textContent = username;
  if (el("hudCoins")) el("hudCoins").textContent = String(coins);
  if (el("hudVoteCount")) el("hudVoteCount").textContent = String(total);
  if (el("hudVotePct")) {
    el("hudVotePct").textContent =
      total > 0 ? `${Math.round((correct / total) * 100)}%` : "0%";
  }
}

// -----------------------------
// User listener (auth-driven, no polling)
// -----------------------------
let unsubscribeUser = null;
let currentUid = null;

function detachUserListener() {
  if (typeof unsubscribeUser === "function") unsubscribeUser();
  unsubscribeUser = null;
}

function attachUserListener(uid) {
  detachUserListener();
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  unsubscribeUser = onSnapshot(
    userRef,
    (snap) => {
      if (!snap.exists()) {
        // user doc missing (can happen if signup doc didn't write / trigger failed)
        console.warn("User doc missing for uid:", uid);
        clearHud();
        return;
      }
      applyHudFromUserDoc(snap.data() || {});
    },
    (err) => {
      console.error("User doc listener error:", err);
    }
  );
}

// Called when your HTML fires window.dispatchEvent(new Event("usa-auth-changed"))
function handleAuthChanged() {
  const uid = window.__USA_UID__ || null;

  if (uid === currentUid) return; // no change
  currentUid = uid;

  if (!uid) {
    detachUserListener();
    clearHud();
    return;
  }

  attachUserListener(uid);
}

// -----------------------------
// Boot
// -----------------------------
initTabs();
initStaticPanels();

// init modules once
initVoting();
initPredictionLeaders();
initShopUI();
initSlotsUI();       // IMPORTANT: this should be the INLINE slots version now
initSuggestions();

// listen for auth changes from index.html
window.addEventListener("usa-auth-changed", handleAuthChanged);

// run once on load in case user is already signed in
handleAuthChanged();
