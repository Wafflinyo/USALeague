// js/slots.js
import { getFunctions, httpsCallable } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const el = (id) => document.getElementById(id);

const STANDINGS_PATH = "data/standings.json";
let TEAM_LOGO_MAP = null;

// ----------------------------
// helpers
// ----------------------------
function requireUid() {
  const uid = window.__USA_UID__ || null;
  if (!uid) throw new Error("Login required to play slots.");
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
  const map = {};
  (standings.teams || []).forEach(t => {
    if (t?.name && t?.logo) map[t.name] = t.logo;
  });

  TEAM_LOGO_MAP = map;
  return map;
}

function callPlaySlots(symbols) {
  const fn = httpsCallable(getFunctions(), "playSlots");
  return fn({ symbols }).then(r => r.data);
}

// ----------------------------
// rendering
// ----------------------------
function renderSlotsShell(host) {
  host.innerHTML = `
    <div class="slotMachine" id="slotMachine">

      <div class="slotCols">
        ${[1,2,3].map(i => `
          <div class="slotCol" id="slotCol${i}">
            <div class="slotWindow" id="slotWin${i}">
              <img class="slotIcon" id="slotIcon${i}" />
            </div>
          </div>
        `).join("")}
      </div>

      <div class="slotActions">
        <button class="primaryBtn" id="spinSlotsBtn">SPIN (1 Coin)</button>
        <div class="smallNote" id="slotsMsg"></div>
      </div>

    </div>
  `;
}

// ----------------------------
// animations
// ----------------------------
function startSpinner(iconEl, pool) {
  let alive = true;

  function tick() {
    if (!alive) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) iconEl.src = pick.icon;
    requestAnimationFrame(tick);
  }
  tick();

  return () => { alive = false; };
}

function clearWinFx() {
  el("slotMachine")?.classList.remove("isWin");
  [1,2,3].forEach(i => {
    el(`slotCol${i}`)?.classList.remove("isWin");
    el(`slotWin${i}`)?.classList.remove("isStopping");
    el(`slotIcon${i}`)?.classList.remove("winPulse");
  });
}

function applyWinFx() {
  el("slotMachine")?.classList.add("isWin");
  [1,2,3].forEach(i => {
    el(`slotCol${i}`)?.classList.add("isWin");
    el(`slotIcon${i}`)?.classList.add("winPulse");
  });
  setTimeout(clearWinFx, 1400);
}

// ----------------------------
// main init
// ----------------------------
export function initSlotsUI() {
  console.log("🎰 initSlotsUI loaded");

  const host = el("slotsInline");
  if (!host) return;

  async function render() {
    renderSlotsShell(host);

    const msg = el("slotsMsg");
    const spinBtn = el("spinSlotsBtn");

    let logoMap;
    try {
      logoMap = await getTeamLogoMap();
    } catch (e) {
      console.error(e);
      msg.textContent = "❌ Failed to load team logos.";
      spinBtn.disabled = true;
      return;
    }

    const symbols = Object.keys(logoMap).map(name => ({
      type: "team",
      teamName: name,
      icon: logoMap[name]
    }));

    if (!symbols.length) {
      msg.textContent = "❌ No teams available.";
      spinBtn.disabled = true;
      return;
    }

    // initial icons
    el("slotIcon1").src = symbols[0].icon;
    el("slotIcon2").src = symbols[1]?.icon || symbols[0].icon;
    el("slotIcon3").src = symbols[2]?.icon || symbols[0].icon;

    let spinning = false;

    spinBtn.onclick = async () => {
      clearWinFx();

      try {
        requireUid();
      } catch (e) {
        msg.textContent = e.message;
        return;
      }

      if (spinning) return;
      spinning = true;
      spinBtn.disabled = true;
      msg.textContent = "Spinning...";

      const stop1 = startSpinner(el("slotIcon1"), symbols);
      const stop2 = startSpinner(el("slotIcon2"), symbols);
      const stop3 = startSpinner(el("slotIcon3"), symbols);

      let result;
      try {
        result = await callPlaySlots(symbols);
      } catch (e) {
        console.error(e);
        stop1(); stop2(); stop3();
        msg.textContent = "❌ Spin failed.";
        spinBtn.disabled = false;
        spinning = false;
        return;
      }

      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      await delay(700);
      el("slotWin1")?.classList.add("isStopping");
      stop1();
      if (result.symbols?.[0]?.icon) el("slotIcon1").src = result.symbols[0].icon;

      await delay(600);
      el("slotWin2")?.classList.add("isStopping");
      stop2();
      if (result.symbols?.[1]?.icon) el("slotIcon2").src = result.symbols[1].icon;

      await delay(600);
      el("slotWin3")?.classList.add("isStopping");
      stop3();
      if (result.symbols?.[2]?.icon) el("slotIcon3").src = result.symbols[2].icon;

      if (result.isWin) {
        applyWinFx();
        msg.textContent = `✅ WIN! +${result.payout} coins (streak ${result.streak})`;
      } else {
        msg.textContent = "❌ No win. Try again.";
      }

      spinBtn.disabled = false;
      spinning = false;
    };
  }

  // render now
  render();

  // re-render on login/logout
  window.addEventListener("usa-auth-changed", () => {
    console.log("🎰 slots auth change detected");
    render();
  });
}
