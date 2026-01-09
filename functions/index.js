const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

const SEASON_ID = "season1";
const SCHEDULE_URL = "https://wafflinyo.github.io/USALeague/data/schedule.json";

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

// 1) Awards coins for completed game days (only once) + creates popup doc
exports.syncMyResults = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const uid = context.auth.uid;

  const schedule = await loadSchedule();
  const games = schedule.games || [];
  const byDate = groupByDate(games);
  const dates = Array.from(byDate.keys()).sort();

  let processedAny = false;
  let lastSummary = null;

  for (const date of dates) {
    const list = (byDate.get(date) || []);
    if (list.length < 5) continue;

    const games5 = list.slice(0, 5);
    const allDone = games5.every(g => g.awayScore != null && g.homeScore != null);
    if (!allDone) continue;

    const rewardId = `${uid}_${SEASON_ID}_${date}`;
    const rewardRef = db.collection("rewardPopups").doc(rewardId);
    const rewardSnap = await rewardRef.get();
    if (rewardSnap.exists) continue; // already paid & popup created (idempotent)

    const voteRef = db.collection("seasons").doc(SEASON_ID)
      .collection("gameDays").doc(date)
      .collection("votes").doc(uid);

    const voteSnap = await voteRef.get();
    if (!voteSnap.exists) continue; // no vote submitted

    const picks = (voteSnap.data().picks || {});
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

// 2) Marks popup as shown so it only appears once
exports.markRewardPopupShown = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");
  const uid = context.auth.uid;
  const { date } = data || {};
  if (!date) throw new functions.https.HttpsError("invalid-argument", "Missing date.");

  const rewardId = `${uid}_${SEASON_ID}_${date}`;
  const rewardRef = db.collection("rewardPopups").doc(rewardId);
  const snap = await rewardRef.get();
  if (!snap.exists) return { ok: true };
  if (snap.data().uid !== uid) throw new functions.https.HttpsError("permission-denied", "Not yours.");

  await rewardRef.update({ shown: true });
  return { ok: true };
});

// 3) Secure slots: costs 1 coin, doubles streak payouts, broadcasts jackpot
exports.playSlots = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");
  const uid = context.auth.uid;

  const symbols = (data && data.symbols) || [];
  if (!Array.isArray(symbols) || symbols.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid symbols list.");
  }

  const pick = () => symbols[Math.floor(Math.random() * symbols.length)];
  const s1 = pick(), s2 = pick(), s3 = pick();

  const isLeague = (s) => s.type === "league";
  const isTeam = (s) => s.type === "team";

  const hopedogoTripleLoss =
    s1.teamName === "Hopedogo Retrievers" &&
    s2.teamName === "Hopedogo Retrievers" &&
    s3.teamName === "Hopedogo Retrievers";

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
    const coins = u.coins || 0;
    if (coins < 1) throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");

    const streak = u.slotsStreak || 0;

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

// 4) Server-enforced suggestion: 1 per day
exports.submitSuggestion = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");
  const uid = context.auth.uid;
  const text = (data && data.text || "").trim();
  if (!text) throw new functions.https.HttpsError("invalid-argument", "Missing text.");

  const day = new Date().toISOString().slice(0, 10);
  const id = `${uid}_${day}`;
  const ref = db.collection("suggestions").doc(id);

  const snap = await ref.get();
  if (snap.exists) throw new functions.https.HttpsError("failed-precondition", "Already submitted today.");

  await ref.set({
    uid, day, text,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true };
});
