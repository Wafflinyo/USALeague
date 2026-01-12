// js/live.js
import { db } from "./firebase.js";

import {
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SEASON_ID = "season1";
const SCHEDULE_PATH = "data/schedule.json";

const el = (id) => document.getElementById(id);
const STANDINGS_PATH = "data/standings.json";
let TEAM_LOGO_MAP = null;

async function getTeamLogoMap() {
  if (TEAM_LOGO_MAP) return TEAM_LOGO_MAP;

  const standings = await loadJSON(STANDINGS_PATH);
  const teams = standings.teams || [];
  const map = {};
  for (const t of teams) {
    if (t?.name && t?.logo) map[t.name] = t.logo;
  }
  TEAM_LOGO_MAP = map;
  return map;
}

function confClass(conf) {
  const c = String(conf || "").toLowerCase();
  if (c.includes("solar")) return "solar";
  if (c.includes("lunar")) return "lunar";
  return "ooc";
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

// ---------- TIME HELPERS (locks on game date at 12:00am ET) ----------
function nowET() {
  // Convert "now" to an ET date key YYYY-MM-DD reliably
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function isLocked(dateKey) {
  // Lock as soon as the date begins in America/New_York
  const todayET = nowET();
  return dateKey <= todayET; // locked on game date and after
}

// ---------- SCHEDULE HELPERS ----------
function groupByDate(games) {
  const map = new Map();
  for (const g of games) {
    if (!g?.date) continue;
    if (!map.has(g.date)) map.set(g.date, []);
    map.get(g.date).push(g);
  }
  return map;
}

function isGameDayComplete(list5) {
  return list5.every(g => g.awayScore != null && g.homeScore != null);
}

function findNextGameDay(schedule) {
  const games = schedule.games || [];
  const byDate = groupByDate(games);

  // sorted dates
  const dates = Array.from(byDate.keys()).sort();

  // choose the earliest date that:
  // - has at least 5 games
  // - is not fully completed
  // - is today or later (ET)
  const today = nowET();

  for (const date of dates) {
    const list = byDate.get(date) || [];
    if (list.length < 5) continue;

    const games5 = list.slice(0, 5);
    const done = isGameDayComplete(games5);

    if (done) continue;

    // If it's in the past, skip it
    if (date < today) continue;

    return { date, games5 };
  }

  return null;
}

// ---------- UI BUILDERS ----------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function renderVotingUI({ date, games5 }, savedPicks = {}) {
  const votingMeta = el("votingMeta");
  const votingList = el("votingList");
  const submitBtn = el("submitVotesBtn");
  const lockNote = el("voteLockNote");

  if (!votingList) return;

  const locked = isLocked(date);
  const logoMap = await getTeamLogoMap();

  if (votingMeta) votingMeta.textContent = `Next game day: ${date} (5 games)`;
  if (lockNote) {
    lockNote.textContent = locked
      ? `Voting is locked for ${date}.`
      : `Voting closes when ${date} begins (ET).`;
  }

  const logoFor = (teamName) => logoMap?.[teamName] || "assets/logos/league/usa-logo.png";

  votingList.innerHTML = `
    <div class="votingWrap">
      <div class="votingGames">
        ${games5.map((g, idx) => {
          const key = `g${idx + 1}`;
          const picked = savedPicks[key] || null;

          const awayName = g.away;
          const homeName = g.home;

          const away = escapeHtml(awayName);
          const home = escapeHtml(homeName);

          const awayChecked = picked === awayName ? "checked" : "";
          const homeChecked = picked === homeName ? "checked" : "";

          const conf = escapeHtml(g.conference || "OOC");
          const klass = confClass(g.conference);

          return `
            <div class="voteGameCard ${klass}">
              <div class="voteGameTop">
                <div class="voteGameTitle">Game ${idx + 1}</div>
                <div class="voteGameMeta">${conf}</div>
              </div>

              <div class="voteMatchup">
                <label class="voteTeamPill" title="${away}" style="cursor:${locked ? "not-allowed" : "pointer"};">
                  <input type="radio" name="${key}" value="${away}" ${awayChecked} ${locked ? "disabled" : ""} />
                  <img class="voteTeamLogo" src="${logoFor(awayName)}" alt="${away} logo" />
                  <span class="voteTeamName">${away}</span>
                </label>

                <div class="voteAt">@</div>

                <label class="voteTeamPill" title="${home}" style="cursor:${locked ? "not-allowed" : "pointer"};">
                  <input type="radio" name="${key}" value="${home}" ${homeChecked} ${locked ? "disabled" : ""} />
                  <img class="voteTeamLogo" src="${logoFor(homeName)}" alt="${home} logo" />
                  <span class="voteTeamName">${home}</span>
                </label>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="votingActions">
        <button class="primaryBtn" id="submitVotesBtnInner">${locked ? "Voting Locked" : "Submit Votes"}</button>
        <div class="smallNote" id="voteLockNoteInner"></div>
      </div>
    </div>
  `;

  // Move lock note into the new inner element so it sits BELOW the button
  const innerNote = el("voteLockNoteInner");
  if (innerNote) innerNote.textContent = lockNote?.textContent || "";

  // Wire the new button to your existing handler
  const innerBtn = el("submitVotesBtnInner");
  if (innerBtn) {
    innerBtn.disabled = locked;
    // forward click to the real handler (if you kept yours on #submitVotesBtn)
    // We’ll just re-run the same click logic by triggering the old button if it exists:
    if (submitBtn) {
      innerBtn.addEventListener("click", () => submitBtn.click());
    }
  }

  // Hide the old button/note if they exist in HTML (prevents overlap)
  if (submitBtn) submitBtn.style.display = "none";
  if (lockNote) lockNote.style.display = "none";
}

// ---------- FIRESTORE PATHS ----------
function voteDocRef(uid, date) {
  return doc(db, "seasons", SEASON_ID, "gameDays", date, "votes", uid);
}

// =====================================================
//  VOTING INIT
// =====================================================
export function initVoting() {
  const submitBtn = el("submitVotesBtn");
  const votingMeta = el("votingMeta");
  const votingList = el("votingList");
  const lockNote = el("voteLockNote");

  if (!votingList) return;

  let currentGameDay = null;      // { date, games5 }
  let currentUid = null;

  async function refreshVoting() {
    try {
      const schedule = await loadJSON(SCHEDULE_PATH);
      const next = findNextGameDay(schedule);

      if (!next) {
        if (votingMeta) votingMeta.textContent = "No upcoming game day found.";
        votingList.innerHTML = `<div class="panelNote">Add future games to data/schedule.json to enable voting.</div>`;
        if (submitBtn) submitBtn.disabled = true;
        return;
      }

      currentGameDay = next;

      // Not logged in
      if (!window.__USA_UID__) {
        if (votingMeta) votingMeta.textContent = `Next game day: ${next.date} (login to vote)`;
        await renderVotingUI(next, {});
        if (submitBtn) submitBtn.disabled = true;
        if (lockNote) lockNote.textContent = "Login required to submit votes.";
        return;
      }

      currentUid = window.__USA_UID__;

      // Load saved picks (if any)
      const ref = voteDocRef(currentUid, next.date);
      const snap = await getDoc(ref);
      const saved = snap.exists() ? (snap.data().picks || {}) : {};

      await renderVotingUI(next, saved);

    } catch (e) {
      console.error("Voting refresh failed:", e);
      if (votingMeta) votingMeta.textContent = "Voting failed to load.";
      votingList.innerHTML = `<div class="panelNote">Could not load voting. Check console for errors.</div>`;
      if (submitBtn) submitBtn.disabled = true;
    }
  }

  // Submit votes
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const uid = window.__USA_UID__;
      if (!uid || !currentGameDay) return;

      const { date } = currentGameDay;

      if (isLocked(date)) {
        alert(`Voting is locked for ${date}.`);
        return;
      }

      const picks = getPicksFromUI();
      const chosen = countChosen(picks);

      if (chosen < 5) {
        alert(`Pick winners for all 5 games before submitting. (${chosen}/5 selected)`);
        return;
      }

      try {
        const ref = voteDocRef(uid, date);
        await setDoc(ref, {
          uid,
          date,
          picks,
          submittedAt: serverTimestamp(),
        }, { merge: true });

        alert(`Votes submitted for ${date}!`);
      } catch (e) {
        console.error("Submit votes failed:", e);
        alert("Failed to submit votes. Check console.");
      }
    });
  }

  // If user logs in later, reload voting
  let lastUid = window.__USA_UID__ || null;
  setInterval(() => {
    const uid = window.__USA_UID__ || null;
    if (uid !== lastUid) {
      lastUid = uid;
      refreshVoting();
    }
  }, 500);

  // Initial load
  refreshVoting();
}

// =====================================================
//  PREDICTION LEADERS INIT
//  (username only, sorts by vote % desc)
// =====================================================
export function initPredictionLeaders() {
  const root = el("predictionLeaders");
  if (!root) return;

  // listen to all users; league is small so this is fine
  const usersQ = query(collection(db, "users"), orderBy("correctPicks", "desc"));

  onSnapshot(usersQ, (snap) => {
    const rows = [];

    snap.forEach((d) => {
      const u = d.data() || {};
      const username = u.username || "Unknown";
      const correct = u.correctPicks || 0;
      const total = u.totalPicks || 0;
      const pct = total > 0 ? (correct / total) * 100 : 0;

      rows.push({ username, correct, total, pct });
    });

    // Sort highest % first, then higher total picks
    rows.sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      return b.total - a.total;
    });

    root.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>User</th>
            <th>Correct</th>
            <th>Total</th>
            <th>Vote %</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><b>${escapeHtml(r.username)}</b></td>
              <td>${r.correct}</td>
              <td>${r.total}</td>
              <td><b>${r.pct.toFixed(1)}%</b></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }, (err) => {
    console.error("Prediction leaders snapshot error:", err);
    root.innerHTML = `<div class="panelNote">Could not load prediction leaders.</div>`;
  });
}
