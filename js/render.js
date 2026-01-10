const el = (id) => document.getElementById(id);

export function initTabs(){
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".tabBtn");
    if(!btn) return;

    const group = btn.dataset.tabgroup;
    const tab = btn.dataset.tab;

    // buttons
    document.querySelectorAll(`.tabBtn[data-tabgroup="${group}"]`).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // content
    document.querySelectorAll(`.tabContent[data-tabgroup="${group}"]`).forEach(c => c.classList.remove("active"));
    const target = document.querySelector(`.tabContent[data-tabgroup="${group}"][data-tab="${tab}"]`);
    if(target) target.classList.add("active");

    // special groups that render in one container (leaders)
    if(group === "leaders"){
      window.__leadersTab = tab;
      if(window.__leadersData) renderLeaders(window.__leadersData);
    }
  });
}

function makeTable(rows){
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Team</th><th>W</th><th>L</th><th>RF</th><th>RA</th><th>RD</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>
              <div class="teamCell">
                <img class="teamLogo" src="${r.logo}" alt="">
                ${r.name}
              </div>
            </td>
            <td>${r.wins}</td>
            <td>${r.losses}</td>
            <td>${r.runsFor}</td>
            <td>${r.runsAgainst}</td>
            <td>${(r.runsFor - r.runsAgainst)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

export function renderStandings(data){
  const teamsRaw = data.teams ?? [];

  // Make copies so we don't mutate original array
  const teamsLeague = teamsRaw.slice();

  // League-wide order: W desc, L asc, RD desc, then name
  teamsLeague.sort((a,b) => {
    const aRD = (a.runsFor ?? 0) - (a.runsAgainst ?? 0);
    const bRD = (b.runsFor ?? 0) - (b.runsAgainst ?? 0);

    if ((b.wins ?? 0) !== (a.wins ?? 0)) return (b.wins ?? 0) - (a.wins ?? 0);
    if ((a.losses ?? 0) !== (b.losses ?? 0)) return (a.losses ?? 0) - (b.losses ?? 0);
    if (bRD !== aRD) return bRD - aRD;

    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  // Conference tables keep their own conference filtering
  const solar = teamsRaw.filter(t => t.conference === "Solar");
  const lunar = teamsRaw.filter(t => t.conference === "Lunar");

  el("standingsLeague").innerHTML = makeTable(teamsLeague);
  el("standingsSolar").innerHTML = makeTable(solar);
  el("standingsLunar").innerHTML = makeTable(lunar);
}


export function renderLeaders(data){
  // store globally so tabs can rerender
  window.__leadersData = data;

  const tab = window.__leadersTab ?? "hr";
  const map = {
    hr: ["homeruns", "HR"],
    runs: ["runs", "Runs"],
    rbi: ["rbis", "RBI"],
    bavg: ["battingAvg", "BAVG"],
    mvp: ["mvps", "MVP"],
    so: ["strikeouts", "SO"]
  };

  const [key, label] = map[tab] ?? map.hr;
  const list = (data[key] ?? []).slice(0,10);

  const html = `
    <div class="panelNote">${label} Leaders (Top 10)</div>
    <table class="table">
      <thead><tr><th>#</th><th>Player</th><th>Team</th><th>${label}</th></tr></thead>
      <tbody>
        ${list.map((p,i)=>`
          <tr>
            <td>${i+1}</td>
            <td><b>${p.player}</b></td>
            <td>${p.team}</td>
            <td><b>${p.value}</b></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  el("leadersContent").innerHTML = html;
}

export function renderLogs(schedule){
  const games = schedule.games ?? [];
  const html = games.map(g => {
    const done = g.awayScore !== null && g.homeScore !== null;
    const status = done ? `${g.awayScore} - ${g.homeScore}` : "Upcoming";
    return `
      <div style="padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:12px; margin-top:10px; background:rgba(255,255,255,0.6);">
        <div><b>${g.date}</b> • ${g.conference}</div>
        <div style="margin-top:6px;"><b>${g.away}</b> @ <b>${g.home}</b> — ${status}</div>
      </div>
    `;
  }).join("");
  el("gameLogs").innerHTML = html || "<div class='smallNote'>No games yet.</div>";
}

export function initTicker(headlines, schedule){
  const ticker = document.getElementById("ticker");
  const inner = document.getElementById("tickerInner");
  const drawer = document.getElementById("tickerDrawer");
  const list = document.getElementById("headlineList");
  const close = document.getElementById("closeDrawerBtn");

  // fallback: auto headlines from last completed games
  const items = headlines.items?.length ? headlines.items : buildAutoHeadlines(schedule);

  inner.textContent = items.map(h => `  •  ${h}`).join("") + "  •  ";
  list.innerHTML = items.map(h => `<div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.12); font-weight:900;">${h}</div>`).join("");

  ticker.onclick = () => drawer.classList.toggle("hidden");
  close.onclick = () => drawer.classList.add("hidden");
}

function buildAutoHeadlines(schedule){
  const games = (schedule.games ?? []).filter(g => g.awayScore !== null && g.homeScore !== null);
  const last = games.slice(-5);
  return last.map(g => {
    const winner = g.awayScore > g.homeScore ? g.away : g.home;
    return `${winner} wins on ${g.date} (${g.awayScore}-${g.homeScore})`;
  });
}
