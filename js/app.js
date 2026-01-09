import { auth, db, watchAuth, signup, login, claimDailyIfEligible } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initTabs, renderStandings, renderLeaders, renderLogs, initTicker } from "./render.js";
import { initVoting } from "./live.js";
import { initShopUI } from "./shop.js";
import { initSlotsUI } from "./slots.js";
import { initSuggestions } from "./suggestions.js";

const el = (id) => document.getElementById(id);

// ---------- AUTH UI ----------
const authModal = el("authModal");
const authMsg = el("authMsg");

function showAuth() { authModal.classList.remove("hidden"); }
function hideAuth() { authModal.classList.add("hidden"); }

el("signupBtn").onclick = async () => {
  authMsg.textContent = "";
  try{
    const email = el("authEmail").value.trim();
    const pass = el("authPass").value.trim();
    const username = el("authUsername").value.trim();
    if(!email || !pass || !username) throw new Error("Email, password, and username required.");
    await signup(email, pass, username);
  }catch(e){
    authMsg.textContent = e.message;
  }
};

el("loginBtn").onclick = async () => {
  authMsg.textContent = "";
  try{
    const email = el("authEmail").value.trim();
    const pass = el("authPass").value.trim();
    if(!email || !pass) throw new Error("Email and password required.");
    await login(email, pass);
  }catch(e){
    authMsg.textContent = e.message;
  }
};

// ---------- JSON LOADERS ----------
async function loadJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function initStaticPanels(){
  const standings = await loadJSON("data/standings.json");
  const leaders = await loadJSON("data/leaders.json");
  const schedule = await loadJSON("data/schedule.json");
  const headlines = await loadJSON("data/headlines.json").catch(()=>({items:[]}));

  renderStandings(standings);
  renderLeaders(leaders);
  renderLogs(schedule);
  initTicker(headlines, schedule);
}

// ---------- START ----------
initTabs();
initStaticPanels();

initVoting();       // votes UI (live)
initShopUI();       // gift shop + cafe modal + collection modal (live)
initSlotsUI();      // slots modal (live)
initSuggestions();  // suggestion submission (live)

// ---------- Watch user state ----------
watchAuth((user) => {
  if (!user) {
    showAuth();
    return;
  }

  hideAuth();

  // Listen to profile
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, async (snap) => {
    if(!snap.exists()) return;
    const u = snap.data();

    el("hudUsername").textContent = u.username ?? "User";
    el("hudCoins").textContent = String(u.coins ?? 0);

    const correct = u.correctPicks ?? 0;
    const total = u.totalPicks ?? 0;
    el("hudVoteCount").textContent = String(total);
    el("hudVotePct").textContent = total > 0 ? `${Math.round((correct/total)*100)}%` : "0%";
  });

  // Daily login bonus
  claimDailyIfEligible(user.uid);
});
