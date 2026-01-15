// js/rewards.js
// ✅ New system:
// - Cloud Function syncMyResults returns { popup } when there's a new result popup to show
// - Server stores processed state in /users/{uid}/resultPopups/{season_date}
// - Client stores "seen this popup" in localStorage so "alreadyProcessed" popups don't reappear on refresh
// - Prevents double popups (single timer + single event handler + guards)

import { auth, callFn } from "./firebase.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatScoreLine(g) {
  const away = escapeHtml(g.away || "");
  const home = escapeHtml(g.home || "");
  const as = g.awayScore ?? null;
  const hs = g.homeScore ?? null;

  if (as != null && hs != null) return `${away} <b>${as}</b> @ ${home} <b>${hs}</b>`;
  return `${away} @ ${home}`;
}

function badge(ok) {
  return ok
    ? `<span style="padding:2px 8px;border-radius:999px;font-weight:800;background:rgba(60,255,150,.15);border:1px solid rgba(60,255,150,.35);">✅ Correct</span>`
    : `<span style="padding:2px 8px;border-radius:999px;font-weight:800;background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.30);">❌ Wrong</span>`;
}

// A stable key for "this popup"
function popupKey(popup) {
  const season = popup?.seasonId || "season";
  const date = popup?.date || "date";
  const type = popup?.type || "results";
  return `${season}_${date}_${type}`;
}

function seenStorageKey(uid, pKey) {
  return `usa_seen_popup_${uid}_${pKey}`;
}

function renderPopupHTML(popup) {
  const title = escapeHtml(popup.title || "Game Day Results");
  const msg = escapeHtml(popup.message || "");
  const date = escapeHtml(popup.date || "");
  const coins = Number(popup.coinsAwarded || 0);
  const correct = Number(popup.correct || 0);
  const total = Number(popup.total || 0);

  const games = Array.isArray(popup.games) ? popup.games : [];

  const rows = games
    .map((g) => {
      const yourPick = g.yourPick ? escapeHtml(g.yourPick) : "<i>—</i>";
      const winner = g.winner ? escapeHtml(g.winner) : "<i>—</i>";
      const ok = !!g.isCorrect;

      return `
        <div style="
          display:grid;
          grid-template-columns: 1fr auto;
          gap:10px;
          padding:10px 12px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.10);
          background:rgba(0,0,0,.20);
          margin-top:10px;
        ">
          <div>
            <div style="font-weight:900;">${formatScoreLine(g)}</div>
            <div style="margin-top:6px; opacity:.90; font-size:13px;">
              Your pick: <b>${yourPick}</b>
              <span style="opacity:.7;"> • </span>
              Winner: <b>${winner}</b>
            </div>
          </div>
          <div style="display:flex; align-items:center; justify-content:flex-end;">
            ${badge(ok)}
          </div>
        </div>
      `;
    })
    .join("");

  const type = popup.type || "results";

  const topLine = `
    <div style="font-weight:900;">${title}</div>
    <div style="margin-top:4px; opacity:.85;">Date: <b>${date}</b></div>
  `;

  if (type === "no-vote") {
    return `
      ${topLine}
      <div style="margin-top:10px;">${msg || "No votes submitted for this game day."}</div>
      <div style="margin-top:10px; opacity:.9;">Coins Earned: <b>0</b></div>
      <div style="margin-top:10px;">${rows}</div>
    `;
  }

  if (type === "incomplete-vote") {
    return `
      ${topLine}
      <div style="margin-top:10px;">${msg}</div>
      <div style="margin-top:10px; opacity:.9;">Coins Earned: <b>0</b></div>
      <div style="margin-top:10px;">${rows}</div>
    `;
  }

  return `
    ${topLine}
    <div style="margin-top:10px;">${msg}</div>

    <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:10px;">
      <div style="opacity:.9;">Correct: <b>${correct}/${total}</b></div>
      <div style="opacity:.9;">Coins Earned: <b>+${coins}</b></div>
    </div>

    <div style="margin-top:10px;">${rows}</div>
  `;
}

export function initRewardPopup() {
  const modal = document.getElementById("rewardModal");
  const text = document.getElementById("rewardText");
  const closeBtn = document.getElementById("rewardCloseBtn");

  if (!modal || !text || !closeBtn) return;

  // Guards
  let currentUid = null;
  let isChecking = false;
  let isShowing = false;
  let currentPopupKey = null;

  // One timer + one window listener only
  let pollTimer = null;
  let authChangedHandlerAttached = false;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function isSeen(uid, pKey) {
    try {
      return localStorage.getItem(seenStorageKey(uid, pKey)) === "1";
    } catch {
      return false;
    }
  }

  function markSeen(uid, pKey) {
    try {
      localStorage.setItem(seenStorageKey(uid, pKey), "1");
    } catch {
      // ignore storage errors
    }
  }

  async function checkForResultsPopup() {
    if (!currentUid) return;
    if (isChecking) return;
    if (isShowing) return;

    isChecking = true;
    try {
      const res = await callFn("syncMyResults")({});
      const data = res?.data || res;
      const popup = data?.popup || null;
      if (!popup) return;

      const pKey = popupKey(popup);

      // If we've already shown/closed this popup on this device, don't show again
      if (isSeen(currentUid, pKey)) return;

      // Extra guard: don't reopen the same popup while it is "current"
      if (currentPopupKey && currentPopupKey === pKey) return;

      currentPopupKey = pKey;
      isShowing = true;

      text.innerHTML = renderPopupHTML(popup);
      modal.classList.remove("hidden");
    } catch (e) {
      console.warn("❌ syncMyResults popup check failed:", e);
    } finally {
      isChecking = false;
    }
  }

  closeBtn.onclick = () => {
    modal.classList.add("hidden");

    // Mark "seen" only on close so user doesn't lose it if they refresh mid-read
    if (currentUid && currentPopupKey) {
      markSeen(currentUid, currentPopupKey);
    }

    isShowing = false;

    // Optional: if you back-fill multiple days, allow next unseen popup to show after close
    currentPopupKey = null;
    setTimeout(checkForResultsPopup, 250);
  };

  // Attach ONE global handler to respond to your app’s auth event
  function attachAuthChangedHandlerOnce() {
    if (authChangedHandlerAttached) return;
    authChangedHandlerAttached = true;
    window.addEventListener("usa-auth-changed", () => {
      // small delay in case uid is being set
      setTimeout(checkForResultsPopup, 150);
    });
  }

  attachAuthChangedHandlerOnce();

  auth.onAuthStateChanged((user) => {
    stopPolling();

    if (!user) {
      currentUid = null;
      isChecking = false;
      isShowing = false;
      currentPopupKey = null;
      modal.classList.add("hidden");
      return;
    }

    currentUid = user.uid;

    // ✅ Works for auto-login too: onAuthStateChanged fires on page load if user is cached
    checkForResultsPopup();

    // ✅ Poll while logged in (results might get posted while user is on the page)
    pollTimer = setInterval(checkForResultsPopup, 30000);
  });
}
