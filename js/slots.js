// js/slots.js
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const el = (id) => document.getElementById(id);

const STANDINGS_PATH = "data/standings.json";
let TEAM_LOGO_MAP = null;

function requireUid() {
  const uid = window.__USA_UID__ || null;
  if (!uid) throw new Error("You must be logged in.");
  return uid;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

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

function clearWinFx() {
  const machine = el("slotMachine");
  const cols = [el("slotCol1"), el("slotCol2"), el("slotCol3")];
  const wins = [el("slotWin1"), el("slotWin2"), el("slotWin3")];
  const icons = [el("slotIcon1"), el("slotIcon2"), el("slotIcon3")];

  machine?.classList.remove("isWin");
  cols.forEach(c => c?.classList.remove("isWin"));
  wins.forEach(w => w?.classList.remove("isStopping"));
  icons.forEach(i => i?.classList.remove("winPulse"));
}

function applyWinFx(isWin) {
  if (!isWin) return;

  const machine = el("slotMachine");
  const cols = [el("slotCol1"), el("slotCol2"), el("slotCol3")];
  const icons = [el("slotIcon1"), el("slotIcon2"), el("slotIcon3")];

  machine?.classList.add("isWin");
  cols.forEach(c => c?.classList.add("isWin"));
  icons.forEach(i => i?.classList.add("winPulse"));

  setTimeout(() => clearWinFx(), 1500);
}

// Simple “spin” animation
function startReelSpinner(iconEl, pool) {
  let alive = true;

  const tick = () => {
    if (!alive) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) iconEl.src = pick.icon;
    requestAnimationFrame(tick);
  };

  tick();
  return () => { alive = false; };
}

async function callPlaySlots(symbols) {
  const fn = httpsCallable(getFunctions(), "playSlots");
  const res = await fn({ symbols });
  return res.data;
}

/**
 * ✅ Render the slots UI into a host element (inline)
 */
function renderSlotsUI(hostEl) {
  hostEl.innerHTML = `
    <div class="slotMachine" id="slotMachine">
      <div class="bigHeaderRow" style="margin-bottom:10px;">
        <div>
          <div style="font-weight:950;font-size:18px;">Ploopy’s Slick Slots</div>
          <div class="smallNote">Costs 1 coin • Reels stop one-by-one • Jackpot doubles with streak</div>
        </div>
      </div>

      <div class="slotCols">
        <div class="slotCol" id="slotCol1">
          <div class="slotWindow" id="slotWin1">
            <img class="slotIcon" id="slotIcon1" alt="Reel 1" />
          </div>
        </div>

        <div class="slotCol" id="slotCol2">
          <div class="slotWindow" id="slotWin2">
            <img class="slotIcon" id="slotIcon2" alt="Reel 2" />
          </div>
        </div>

        <div class="slotCol" id="slotCol3">
          <div class="slotWindow" id="slotWin3">
            <img class="slotIcon" id="slotIcon3" alt="Reel 3" />
          </div>
        </div>
      </div>

      <div class="slotActions">
        <button class="primaryBtn" id="spinSlotsBtn">SPIN (1 Coin)</button>
        <div class="smallNote" id="slotsMsg"></div>
      </div>
    </div>
  `;
}

export function initSlotsUI() {
  console.log("✅ initSlotsUI loaded (inline)");

  const host = el("slotsInline");
  if (!host) {
    console.warn("⚠️ Missing #slotsInline in HTML.");
    return;
  }

  renderSlotsUI(host);

  const spinBtn = el("spinSlotsBtn");
  const msg = el("slotsMsg");

  if (!spinBtn) return;

  // Load symbols once
  (async () => {
    let logoMap;
    try {
      logoMap = await getTeamLogoMap();
    } catch (e) {
      console.error(e);
      if (msg) msg.textContent = "❌ Could not load team logos (standings.json).";
      spinBtn.disabled = true;
      return;
    }

    const symbols = Object.keys(logoMap).map(name => ({
      type: "team",
      teamName: name,
      icon: logoMap[name]
    }));

    if (!symbols.length) {
      if (msg) msg.textContent = "❌ No teams found in standings.json.";
      spinBtn.disabled = true;
      return;
    }

    // Set initial images
    el("slotIcon1").src = symbols[0].icon;
    el("slotIcon2").src = symbols[1]?.icon || symbols[0].icon;
    el("slotIcon3").src = symbols[2]?.icon || symbols[0].icon;

    let spinning = false;

    spinBtn.onclick = async () => {
      clearWinFx();

      try {
        requireUid();
      } catch (e) {
        if (msg) msg.textContent = `❌ ${e.message}`;
        return;
      }

      if (spinning) return;
      spinning = true;
      spinBtn.disabled = true;
      if (msg) msg.textContent = "Spinning...";

      const icon1 = el("slotIcon1");
      const icon2 = el("slotIcon2");
      const icon3 = el("slotIcon3");

      const win1 = el("slotWin1");
      const win2 = el("slotWin2");
      const win3 = el("slotWin3");

      const stop1 = startReelSpinner(icon1, symbols);
      const stop2 = startReelSpinner(icon2, symbols);
      const stop3 = startReelSpinner(icon3, symbols);

      let result;
      try {
        result = await callPlaySlots(symbols);
      } catch (err) {
        console.error(err);
        stop1(); stop2(); stop3();
        spinning = false;
        spinBtn.disabled = false;
        if (msg) msg.textContent = `❌ ${err?.message || "Spin failed."}`;
        return;
      }

      const [s1, s2, s3] = result.symbols || [];
      const stopDelay = (ms) => new Promise(r => setTimeout(r, ms));

      await stopDelay(750);
      win1?.classList.add("isStopping");
      await stopDelay(200);
      stop1();
      if (s1?.icon) icon1.src = s1.icon;
      win1?.classList.remove("isStopping");

      await stopDelay(650);
      win2?.classList.add("isStopping");
      await stopDelay(200);
      stop2();
      if (s2?.icon) icon2.src = s2.icon;
      win2?.classList.remove("isStopping");

      await stopDelay(600);
      win3?.classList.add("isStopping");
      await stopDelay(200);
      stop3();
      if (s3?.icon) icon3.src = s3.icon;
      win3?.classList.remove("isStopping");

      if (result.isWin) {
        applyWinFx(true);
        if (msg) msg.textContent = `✅ WIN! +${result.payout} coins (streak: ${result.streak})`;
      } else {
        if (msg) msg.textContent = `❌ No win. (streak reset)`;
      }

      spinning = false;
      spinBtn.disabled = false;
    };
  })();
}
