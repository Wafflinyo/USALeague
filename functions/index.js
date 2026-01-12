// functions/index.js  (Gen 2 friendly / Node 24 friendly)

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// --- Functions v2 imports (Gen 2) ---
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

// -----------------------------
// Constants
// -----------------------------
const SEASON_ID = "season1";
const SCHEDULE_URL = "https://wafflinyo.github.io/USALeague/data/schedule.json";

// -----------------------------
// Helpers
// -----------------------------
function payoutForCorrect(n) {
  if (n <= 0) return 0;
  if (n === 1) return 100;
  if (n === 2) return 200;
  if (n === 3) return 600;
  if (n === 4) return 1800;
  if (n === 5) return 3600;
  return 0;
}

async function loadSchedule() {
  // Node 24 has native fetch
  const res = await fetch(SCHEDULE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load schedule.json");
  return res.json();
}

function groupByDate(games) {
  const map = new Map();
  for (const g of games) {
    if (!map.has(g.date)) map.set(g.date, []);
    map.get(g.date).push(g);
  }
  return map;
}

function winnerOfGame(g) {
  if (g.awayScore == null || g.homeScore == null) return null;
  if (g.awayScore > g.homeScore) return g.away;
  if (g.homeScore > g.awayScore) return g.home;
  return "TIE";
}

// --- SHOP helpers ---
function dayKeyET(date = new Date()) {
  // "good enough" ET day key
  const utc = date.getTime();
  const etOffsetHours = -5; // EST-ish
  const et = new Date(utc + etOffsetHours * 60 * 60 * 1000);
  return et.toISOString().slice(0, 10);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// -----------------------------
// 1) Awards coins for completed game days (only once) + creates popup doc
// -----------------------------
exports.syncMyResults = onCall(async (request) => {
  const { auth } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Login required.");
  const uid = auth.uid;

  const schedule = await loadSchedule();
  const games = schedule.games || [];
  const byDate = groupByDate(games);
  const dates = Array.from(byDate.keys()).sort();

  let processedAny = false;
  let lastSummary = null;

  for (const date of dates) {
    const list = byDate.get(date) || [];
    if (list.length < 5) continue;

    const games5 = list.slice(0, 5);
    const allDone = games5.every((g) => g.awayScore != null && g.homeScore != null);
    if (!allDone) continue;

    const rewardId = `${uid}_${SEASON_ID}_${date}`;
    const rewardRef = db.collection("rewardPopups").doc(rewardId);
    const rewardSnap = await rewardRef.get();
    if (rewardSnap.exists) continue; // already paid

    const voteRef = db
      .collection("seasons").doc(SEASON_ID)
      .collection("gameDays").doc(date)
      .collection("votes").doc(uid);

    const voteSnap = await voteRef.get();
    if (!voteSnap.exists) continue; // no vote submitted

    const picks = voteSnap.data().picks || {};
    let correct = 0;

    const results = games5.map((g, idx) => {
      const win = winnerOfGame(g);
      const pick = picks[`g${idx + 1}`] || null;
      const isCorrect = win && pick && win === pick;
      if (isCorrect) correct++;
      return { away: g.away, home: g.home, win, pick, isCorrect };
    });

    const payout = payoutForCorrect(correct);

    await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("User profile missing.");

      const u = userSnap.data();
      const coins = u.coins || 0;
      const totalPicks = u.totalPicks || 0;
      const correctPicks = u.correctPicks || 0;

      tx.update(userRef, {
        coins: coins + payout,
        totalPicks: totalPicks + 5,
        correctPicks: correctPicks + correct,
      });

      tx.set(rewardRef, {
        uid,
        seasonId: SEASON_ID,
        date,
        correct,
        payout,
        results,
        shown: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(voteRef, { processed: true }, { merge: true });
    });

    processedAny = true;
    lastSummary = { date, correct, payout };
  }

  return { processedAny, lastSummary };
});

// -----------------------------
// 2) Marks popup as shown so it only appears once
// -----------------------------
exports.markRewardPopupShown = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Login required.");
  const uid = auth.uid;

  const date = data?.date;
  if (!date) throw new HttpsError("invalid-argument", "Missing date.");

  const rewardId = `${uid}_${SEASON_ID}_${date}`;
  const rewardRef = db.collection("rewardPopups").doc(rewardId);
  const snap = await rewardRef.get();

  if (!snap.exists) return { ok: true };
  if (snap.data().uid !== uid) throw new HttpsError("permission-denied", "Not yours.");

  await rewardRef.update({ shown: true });
  return { ok: true };
});

// -----------------------------
// 3) Secure slots: costs 1 coin, doubles streak payouts, broadcasts jackpot
// -----------------------------
exports.playSlots = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Login required.");
  const uid = auth.uid;

  const symbols = data?.symbols || [];
  if (!Array.isArray(symbols) || symbols.length < 6) {
    throw new HttpsError("invalid-argument", "Invalid symbols list.");
  }

  const pick = () => symbols[Math.floor(Math.random() * symbols.length)];
  const s1 = pick(), s2 = pick(), s3 = pick();

  const isLeague = (s) => s?.type === "league";
  const isTeam = (s) => s?.type === "team";

  const hopedogoTripleLoss =
    s1?.teamName === "Hopedogo Retrievers" &&
    s2?.teamName === "Hopedogo Retrievers" &&
    s3?.teamName === "Hopedogo Retrievers";

  const sameTeamTriple =
    isTeam(s1) && isTeam(s2) && isTeam(s3) &&
    s1.teamName === s2.teamName && s2.teamName === s3.teamName;

  const threeLeague = isLeague(s1) && isLeague(s2) && isLeague(s3);

  const twoSameTeamOneLeague =
    ((isTeam(s1) && isTeam(s2) && s1.teamName === s2.teamName && isLeague(s3)) ||
     (isTeam(s1) && isTeam(s3) && s1.teamName === s3.teamName && isLeague(s2)) ||
     (isTeam(s2) && isTeam(s3) && s2.teamName === s3.teamName && isLeague(s1)));

  const twoLeagueOneTeam =
    ((isLeague(s1) && isLeague(s2) && isTeam(s3)) ||
     (isLeague(s1) && isLeague(s3) && isTeam(s2)) ||
     (isLeague(s2) && isLeague(s3) && isTeam(s1)));

  const isWin = !hopedogoTripleLoss && (sameTeamTriple || threeLeague || twoSameTeamOneLeague || twoLeagueOneTeam);

  const out = await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error("User profile missing.");

    const u = userSnap.data();
    const coins = Number(u.coins || 0);
    if (coins < 1) throw new HttpsError("failed-precondition", "Not enough coins.");

    const streak = Number(u.slotsStreak || 0);

    let newCoins = coins - 1;
    let payout = 0;
    let newStreak = 0;

    if (isWin) {
      newStreak = streak + 1;
      payout = 500 * Math.pow(2, newStreak - 1);
      newCoins += payout;

      const username = u.username || "Someone";
      tx.set(db.collection("announcements").doc(), {
        type: "jackpot",
        text: `${username} just hit the jackpot!`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      newStreak = 0;
    }

    tx.update(userRef, { coins: newCoins, slotsStreak: newStreak });
    return { coins: newCoins, payout, streak: newStreak };
  });

  return { symbols: [s1, s2, s3], isWin, ...out };
});

// -----------------------------
// 4) Server-enforced suggestion: 1 per day
// -----------------------------
exports.submitSuggestion = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Login required.");
  const uid = auth.uid;

  const text = (data?.text || "").trim();
  if (!text) throw new HttpsError("invalid-argument", "Missing text.");

  const day = new Date().toISOString().slice(0, 10);
  const id = `${uid}_${day}`;
  const ref = db.collection("suggestions").doc(id);

  const snap = await ref.get();
  if (snap.exists) throw new HttpsError("failed-precondition", "Already submitted today.");

  await ref.set({
    uid, day, text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

// -----------------------------
// SHOP 1) Daily sale roll (same sale for everyone)
// -----------------------------
exports.rollDailySale = onSchedule(
  { schedule: "every day 05:10", timeZone: "UTC" },
  async () => {
    const today = dayKeyET(new Date());
    const seed = hashStringToSeed("USA_SALE_" + today);
    const rng = mulberry32(seed);

    const snap = await db.collection("shopItems").get();
    const allItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const eligible = allItems.filter((x) => Number.isFinite(x.basePrice) && x.basePrice > 0);

    const hasSale = rng() < 0.35;
    const discounts = {};

    if (hasSale && eligible.length) {
      const count = Math.min(eligible.length, 2 + Math.floor(rng() * 4)); // 2–5
      const used = new Set();

      while (Object.keys(discounts).length < count && used.size < eligible.length) {
        const pick = eligible[Math.floor(rng() * eligible.length)];
        if (!pick || used.has(pick.id)) continue;
        used.add(pick.id);

        const pct = clamp(0.10 + rng() * 0.15, 0.10, 0.25);
        discounts[pick.id] = Math.round(pct * 100) / 100;
      }
    }

    await db.collection("shopMeta").doc("currentSale").set(
      {
        dayKey: today,
        label: hasSale ? "Daily Sale" : "No Sale Today",
        discounts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return null;
  }
);

// -----------------------------
// SHOP 2) Buy item securely (deduct coins + add to collection)
// -----------------------------
exports.buyShopItem = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Login required.");
  const uid = auth.uid;

  const itemId = (data?.itemId || "").trim();
  if (!itemId) throw new HttpsError("invalid-argument", "Missing itemId.");

  const itemRef = db.collection("shopItems").doc(itemId);
  const saleRef = db.collection("shopMeta").doc("currentSale");
  const userRef = db.collection("users").doc(uid);
  const colRef = userRef.collection("collection").doc(itemId);

  const [itemSnap, saleSnap] = await Promise.all([itemRef.get(), saleRef.get()]);
  if (!itemSnap.exists) throw new HttpsError("not-found", "Item not found.");

  const item = itemSnap.data();
  const basePrice = Number(item.basePrice || 0);
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new HttpsError("failed-precondition", "Invalid item price.");
  }

  const discounts = saleSnap.exists ? (saleSnap.data().discounts || {}) : {};
  const rawDisc = Number(discounts[itemId] || 0);
  const disc = clamp(rawDisc, 0, 0.25);
  const finalPrice = Math.max(1, Math.round(basePrice * (1 - disc)));

  const stackable = !!item.stackable;
  const maxStack = Number.isFinite(item.maxStack) ? item.maxStack : (stackable ? 10 : 1);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError("failed-precondition", "User profile missing.");

    const u = userSnap.data();
    const coins = Number(u.coins || 0);
    if (coins < finalPrice) throw new HttpsError("failed-precondition", "Not enough coins.");

    const colSnap = await tx.get(colRef);
    const currentQty = colSnap.exists ? Number(colSnap.data().qty || 0) : 0;

    if (!stackable && currentQty >= 1) {
      throw new HttpsError("failed-precondition", "You already own this item.");
    }
    if (stackable && currentQty >= maxStack) {
      throw new HttpsError("failed-precondition", `Max stack (${maxStack}) reached.`);
    }

    tx.update(userRef, { coins: coins - finalPrice });

    const newQty = stackable ? currentQty + 1 : 1;
    tx.set(
      colRef,
      {
        itemId,
        name: item.name || itemId,
        desc: item.desc || "",
        icon: item.icon || "",
        rarity: item.rarity || "common",
        basePrice,
        qty: newQty,
        stackable,
        maxStack,
        lastAcquiredAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { ok: true, itemId, finalPrice, discount: disc };
});
