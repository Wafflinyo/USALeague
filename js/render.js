// js/render.js
const el = (id) => document.getElementById(id);

/* -----------------------------
   Tabs
----------------------------- */
export function initTabs() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".tabBtn");
    if (!btn) return;

    const group = btn.dataset.tabgroup;
    const tab = btn.dataset.tab;

    // buttons
    document
      .querySelectorAll(`.tabBtn[data-tabgroup="${group}"]`)
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // content
    document
      .querySelectorAll(`.tabContent[data-tabgroup="${group}"]`)
      .forEach((c) => c.classList.remove("active"));
    const target = document.querySelector(
      `.tabContent[data-tabgroup="${group}"][data-tab="${tab}"]`
    );
    if (target) target.classList.add("active");

    // leaders group re-render
    if (group === "leaders") {
      window.__leadersTab = tab;
      if (window.__leadersData) renderLeaders(window.__leadersData);
    }
  });
}

/* -----------------------------
   Helpers
----------------------------- */

// Ensure wins/losses/RF/RA are numbers even if JSON has strings
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rd(t) {
  return num(t.runsFor) - num(t.runsAgainst);
}

/**
 * ✅ Sort order you requested:
 * 1) wins DESC
 * 2) RD DESC (tiebreaker)
 * 3) losses ASC (extra safety, but after RD per your request)
 * 4) name ASC (stable final tie)
 */
function sortTeams(list) {
  return list.slice().sort((a, b) => {
    const aw = num(a.wins), bw = num(b.wins);
    if (bw !== aw) return bw - aw;

    const aRD = rd(a), bRD = rd(b);
    if (bRD !== aRD) return bRD - aRD;

    const al = num(a.losses), bl = num(b.losses);
    if (al !== bl) return al - bl;

    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

/**
 * ✅ Fixes GitHub Pages base-path issues for logos.
 * If your JSON already uses "assets/..." this is fine.
 * If it accidentally uses "/assets/..." this will break on /USALeague/.
 */
function fixLogoPath(p) {
  if (!p) return "";
  // keep full URLs
  if (/^https?:\/\//i.test(p)) return p;
  // remove leading slashes
  return String(p).replace(/^\/+/, "");
}

function makeTable(rows) {
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Team</th><th>W</th><th>L</th><th>RF</th><th>RA</th><th>RD</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => `
          <tr>
            <td>
              <div class="teamCell">
                <img class="teamLogo" src="${fixLogoPath(r.logo)}" alt="">
                ${r.name}
              </div>
            </td>
            <td>${num(r.wins)}</td>
            <td>${num(r.losses)}</td>
            <td>${num(r.runsFor)}</td>
            <td>${num(r.runsAgainst)}</td>
            <td>${rd(r)}</td>
          </tr>
        `)
          .join("")}
      </tbody>
    </table>
  `;
}

/* -----------------------------
   Standings
----------------------------- */
export function renderStandings(data) {
  const teamsRaw = Array.isArray(data?.teams) ? data.teams : [];

  // League
  const leagueSorted = sortTeams(teamsRaw);

  // Conferences (IMPORTANT: you were not sorting these before)
  const solarSorted = sortTeams(teamsRaw.filter((t) => t.conference === "Solar"));
  const lunarSorted = sortTeams(teamsRaw.filter((t) => t.conference === "Lunar"));

  const leagueEl = el("standingsLeague");
  const solarEl = el("standingsSolar");
  const lunarEl = el("standingsLunar");

  if (leagueEl) leagueEl.innerHTML = makeTable(leagueSorted);
  if (solarEl) solarEl.innerHTML = makeTable(solarSorted);
  if (lunarEl) lunarEl.innerHTML = makeTable(lunarSorted);
}

/* -----------------------------
   Leaders
----------------------------- */
export function renderLeaders(data) {
  window.__leadersData = data;

  const tab = window.__leadersTab ?? "hr";

  // include all 6 tabs you have in HTML
  const map = {
    hr: ["homeruns", "HR"],
    runs: ["runs", "Runs"],
    rbi: ["rbis", "RBI"],
    bavg: ["battingAvg", "BAVG"],
    mvp: ["mvps", "MVP"],
    so: ["strikeouts", "SO"],
  };

  const [key, label] = map[tab] ?? map.hr;
  const list = (data?.[key] ?? []).slice(0, 10);

  const html = `
    <div class="panelNote">${label} Leaders (Top 10)</div>
    <table class="table">
      <thead><tr><th>#</th><th>Player</th><th>Team</th><th>${label}</th></tr></thead>
      <tbody>
        ${list
          .map(
            (p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><b>${p.player ?? ""}</b></td>
            <td>${p.team ?? ""}</td>
            <td><b>${p.value ?? ""}</b></td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
  const out = el("leadersContent");
  if (out) out.innerHTML = html;
}

/* -----------------------------
   Logs
----------------------------- */
export function renderLogs(schedule) {
  const games = Array.isArray(schedule?.games) ? schedule.games : [];

  const html = games
    .map((g) => {
      const done = g.awayScore !== null && g.homeScore !== null;
      const status = done ? `${g.awayScore} - ${g.homeScore}` : "Upcoming";

      return `
        <div style="padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:12px; margin-top:10px; background:rgba(255,255,255,0.6);">
          <div><b>${g.date}</b> • ${g.conference ?? ""}</div>
          <div style="margin-top:6px;"><b>${g.away}</b> @ <b>${g.home}</b> — ${status}</div>
        </div>
      `;
    })
    .join("");

  const out = el("gameLogs");
  if (out) out.innerHTML = html || "<div class='smallNote'>No games yet.</div>";
}

/* -----------------------------
   Ticker
----------------------------- */
export function initTicker(headlines, schedule) {
  const ticker = document.getElementById("ticker");
  const inner = document.getElementById("tickerInner");
  const drawer = document.getElementById("tickerDrawer");
  const list = document.getElementById("headlineList");
  const close = document.getElementById("closeDrawerBtn");

  if (!ticker || !inner || !drawer || !list || !close) return;

  // fallback: auto headlines from last completed games
  const items =
    Array.isArray(headlines?.items) && headlines.items.length
      ? headlines.items
      : buildAutoHeadlines(schedule);

  inner.textContent = items.map((h) => `  •  ${h}`).join("") + "  •  ";
  list.innerHTML = items
    .map(
      (h) =>
        `<div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.12); font-weight:900;">${h}</div>`
    )
    .join("");

  ticker.onclick = () => drawer.classList.toggle("hidden");
  close.onclick = () => drawer.classList.add("hidden");
}

function buildAutoHeadlines(schedule) {
  const games = (schedule?.games ?? []).filter(
    (g) => g.awayScore !== null && g.homeScore !== null
  );
  const last = games.slice(-5);
  return last.map((g) => {
    const winner = g.awayScore > g.homeScore ? g.away : g.home;
    return `${winner} wins on ${g.date} (${g.awayScore}-${g.homeScore})`;
  });
}
