// js/slots.js  (INLINE VERSION)
import { callFn } from "./firebase.js";

const el = (id) => document.getElementById(id);

const STANDINGS_PATH = "data/standings.json";
let TEAM_LOGO_MAP = null;

// ----------------------------
// helpers
// ----------------------------
function getUid() {
  return window.__USA_UID__ || null;
}

function requireUid() {
  const uid = getUid();
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
  (standings.teams || []).forEach((t) => {
    if (t?.name && t?.logo) map[t.name] = t.logo;
  });

  TEAM_LOGO_MAP = map;
  return map;
}

async function callPlaySlots(symbols) {
  // ✅ Uses your configured region (us-central1) from firebase.js
  const fn = callFn("playSlots");
  const res = await fn({ symbols });
  return res.data;
}

function readableCallableError(err) {
  // Firebase callable errors often have err.message like:
  // "functions/failed-precondition" or include details.
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err?.message || "Unknown error.";
}

// ----------------------------
// rendering
// ----------------------------
function renderSlotsShell(host) {
  host.innerHTML = `
    <div class="slotMachine" id="slotMachine">
      <div class="slotCols">
        ${[1, 2, 3]
          .map(
            (i) => `
          <div class="slotCol" id="slotCol${i}">
            <div class="slotWindow" id="slotWin${i}">
              <img class="slotIcon" id="slotIcon${i}" alt="Reel ${i}" />
            </div>
          </div>
        `
          )
          .join("")}
      </div>

      <div class="slotActions">
        <button class="primaryBtn" id="spinSlotsBtn" type="button">SPIN (1 Coin)</button>
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
    if (pick?.icon) iconEl.src = pick.icon;
    requestAnimationFrame(tick);
  }

  tick();
  return () => {
    alive = false;
  };
}

function clearWinFx() {
  el("slotMachine")?.classList.remove("isWin");
  [1, 2, 3].forEach((i) => {
    el(`slotCol${i}`)?.classList.remove("isWin");
    el(`slotWin${i}`)?.classList.remove("isStopping");
    el(`slotIcon${i}`)?.classList.remove("winPulse");
  });
}

function applyWinFx() {
  el("slotMachine")?.classList.add("isWin");
  [1, 2, 3].forEach((i) => {
    el(`slotCol${i}`)?.classList.add("isWin");
    el(`slotIcon${i}`)?.classList.add("winPulse");
  });
  setTimeout(clearWinFx, 1400);
}

// ----------------------------
// main init
// ----------------------------
export function initSlotsUI() {
  console.log("🎰 initSlotsUI loaded (inline)");

  const host = el("slotsInline");
  if (!host) {
    console.warn("slotsInline host not found in HTML.");
    return;
  }

  async function render() {
    renderSlotsShell(host);

    const msg = el("slotsMsg");
    const spinBtn = el("spinSlotsBtn");

    clearWinFx();

    // ✅ If logged out, show message + disable spin
    if (!getUid()) {
      if (msg) msg.textContent = "Login to play slots.";
      if (spinBtn) spinBtn.disabled = true;
    } else {
      if (spinBtn) spinBtn.disabled = false;
      if (msg) msg.textContent = "";
    }

    // Load symbols
    let logoMap;
    try {
      logoMap = await getTeamLogoMap();
    } catch (e) {
      console.error(e);
      if (msg) msg.textContent = "❌ Failed to load team logos (standings.json).";
      if (spinBtn) spinBtn.disabled = true;
      return;
    }

    const symbols = Object.keys(logoMap).map((name) => ({
      type: "team",
      teamName: name,
      icon: logoMap[name],
    }));

    if (!symbols.length) {
      if (msg) msg.textContent = "❌ No teams available.";
      if (spinBtn) spinBtn.disabled = true;
      return;
    }

    // Initial icons
    el("slotIcon1").src = symbols[0].icon;
    el("slotIcon2").src = symbols[1]?.icon || symbols[0].icon;
    el("slotIcon3").src = symbols[2]?.icon || symbols[0].icon;

    let spinning = false;

    spinBtn.onclick = async () => {
      clearWinFx();

      try {
        requireUid();
      } catch (e) {
        if (msg) msg.textContent = e.message;
        return;
      }

      if (spinning) return;
      spinning = true;

      spinBtn.disabled = true;
      if (msg) msg.textContent = "Spinning...";

      const icon1 = el("slotIcon1");
      const icon2 = el("slotIcon2");
      const icon3 = el("slotIcon3");

      const stop1 = startSpinner(icon1, symbols);
      const stop2 = startSpinner(icon2, symbols);
      const stop3 = startSpinner(icon3, symbols);

      let result;
      try {
        result = await callPlaySlots(symbols);
      } catch (e) {
        console.error("playSlots error:", e);
        stop1();
        stop2();
        stop3();

        if (msg) msg.textContent = `❌ ${readableCallableError(e)}`;
        spinBtn.disabled = false;
        spinning = false;
        return;
      }

      const delay = (ms) => new Promise((r) => setTimeout(r, ms));

      // Stop reel 1
      await delay(650);
      el("slotWin1")?.classList.add("isStopping");
      await delay(160);
      stop1();
      if (result?.symbols?.[0]?.icon) icon1.src = result.symbols[0].icon;
      el("slotWin1")?.classList.remove("isStopping");

      // Stop reel 2
      await delay(550);
      el("slotWin2")?.classList.add("isStopping");
      await delay(160);
      stop2();
      if (result?.symbols?.[1]?.icon) icon2.src = result.symbols[1].icon;
      el("slotWin2")?.classList.remove("isStopping");

      // Stop reel 3
      await delay(550);
      el("slotWin3")?.classList.add("isStopping");
      await delay(160);
      stop3();
      if (result?.symbols?.[2]?.icon) icon3.src = result.symbols[2].icon;
      el("slotWin3")?.classList.remove("isStopping");

      if (result?.isWin) {
        applyWinFx();
        if (msg) msg.textContent = `✅ WIN! +${result.payout} coins (streak ${result.streak})`;
      } else if (result?.tripleHopeDogo) {
        if (msg) msg.textContent = "💀 HOPE-DOGO TRIPLE! Auto loss (streak reset).";
      } else {
        if (msg) msg.textContent = "❌ No win. Try again.";
      }

      spinBtn.disabled = false;
      spinning = false;
    };
  }

  // Initial render
  render();

  // Re-render on login/logout
  window.addEventListener("usa-auth-changed", () => {
    console.log("🎰 slots auth change detected -> re-render");
    render();
  });
}
