/**
 * functions/index.js (GEN 2 / v2)
 * Deploy: firebase deploy --only functions
 *
 * ✅ Adds: syncMyResults that:
 * - reads completed results from Firestore: /results/{SEASON_ID}_{date}
 * - reads the user's picks from: /users/{uid}/votes/{SEASON_ID}_{date}
 * - computes correct picks + payout
 * - updates /users/{uid} (coins, correctPicks, totalPicks)
 * - writes /users/{uid}/resultPopups/{SEASON_ID}_{date} so the popup only shows once
 * - updates /predictionLeaders/{uid} (public leaderboard)
 * - returns { popup: {...} } when there’s a new result to show
 *
 * IMPORTANT:
 * - This does NOT parse schedule.json in Cloud Functions (Cloud Functions can't reliably read your hosted JSON).
 * - You (or your workflow) must create the results doc when you finalize a gameday.
 */

const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const { onCall, HttpsError } = require("firebase-functions/v2/https");

// -----------------------------
// Config
// -----------------------------
const REGION = "us-central1";

const NEW_USER_BONUS = 100;
const DAILY_BONUS = 50;

// Results system config
const SEASON_ID = "season1";

// Reward math (tweak whenever)
const COINS_PER_CORRECT = 10; // payout per correct pick (5 games => max 50 coins)
const REQUIRE_5_PICKS = true; // if true, no payout unless all 5 picks were submitted

// If you want “Hopedogo triple = auto loss”
const HOPE_DOGO_MATCH = (sym) => {
  const s = String(sym?.type || "").toLowerCase();
  const t = String(sym?.teamName || "").toLowerCase();
  const n = String(sym?.name || "").toLowerCase();
  return s === "hopedogo" || t === "hopedogo" || n === "hopedogo";
};

// -----------------------------
// Helpers
// -----------------------------
function requireAuth(req) {
  const uid = req?.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "You must be logged in.");
  return uid;
}

function todayKeyNY() {
  // YYYY-MM-DD in America/New_York
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function clampDiscount(d) {
  const n = Number(d || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(n, 0.25));
}

function priceAfterDiscount(basePrice, disc) {
  const d = clampDiscount(disc);
  const base = Math.max(0, Number(basePrice || 0));
  return Math.max(1, Math.round(base * (1 - d)));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function safeSymbol(sym) {
  return {
    type: sym?.type || "team",
    teamName: sym?.teamName || sym?.name || "Unknown",
    icon: sym?.icon || "",
  };
}

function safeString(x) {
  return String(x ?? "").trim();
}

function countPicks(picks) {
  return Object.keys(picks || {}).length;
}

// -----------------------------
// ✅ Daily bonus (callable) - GEN 2
// -----------------------------
exports.ensureDailyBonus = onCall({ region: REGION }, async (req) => {
  const uid = requireAuth(req);
  const today = todayKeyNY();
  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);

    // If profile missing, create it safely then apply daily bonus
    if (!snap.exists) {
      const profile = {
        username: `user_${uid.slice(0, 6)}`,
        coins: NEW_USER_BONUS + DAILY_BONUS,
        correctPicks: 0,
        totalPicks: 0,
        slotsStreak: 0,
        lastDailyBonus: today,
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(userRef, profile, { merge: true });
      return { applied: true, today, coins: profile.coins, bonus: DAILY_BONUS, createdProfile: true };
    }

    const u = snap.data() || {};
    const last = u.lastDailyBonus || null;

    if (last === today) {
      return { applied: false, today, coins: Number(u.coins || 0) };
    }

    const newCoins = Number(u.coins || 0) + DAILY_BONUS;
    tx.update(userRef, { coins: newCoins, lastDailyBonus: today });

    return { applied: true, today, coins: newCoins, bonus: DAILY_BONUS, createdProfile: false };
  });
});

// -----------------------------
// ✅ Play slots (callable) - GEN 2
// -----------------------------
exports.playSlots = onCall({ region: REGION }, async (req) => {
  const uid = requireAuth(req);

  const symbols = req.data?.symbols;
  if (!Array.isArray(symbols) || symbols.length < 3) {
    throw new HttpsError("invalid-argument", "symbols must be an array with at least 3 entries.");
  }

  const pool = symbols.map(safeSymbol).filter((s) => s.icon);
  if (pool.length < 3) {
    throw new HttpsError("invalid-argument", "symbols pool is empty.");
  }

  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("failed-precondition", "User profile missing.");

    const u = snap.data() || {};
    const coins = Number(u.coins || 0);
    let streak = Number(u.slotsStreak || 0);

    if (coins < 1) throw new HttpsError("failed-precondition", "Not enough coins.");

    let newCoins = coins - 1;

    const s1 = pickRandom(pool);
    const s2 = pickRandom(pool);
    const s3 = pickRandom(pool);

    const tripleHopeDogo = HOPE_DOGO_MATCH(s1) && HOPE_DOGO_MATCH(s2) && HOPE_DOGO_MATCH(s3);

    let isWin = false;
    let payout = 0;

    if (tripleHopeDogo) {
      streak = 0;
    } else {
      isWin = String(s1.teamName) === String(s2.teamName) && String(s2.teamName) === String(s3.teamName);
      if (isWin) {
        const base = 500;
        payout = base * Math.pow(2, streak);
        streak += 1;
        newCoins += payout;
      } else {
        streak = 0;
      }
    }

    tx.update(userRef, {
      coins: newCoins,
      slotsStreak: streak,
      lastSlotAt: FieldValue.serverTimestamp(),
    });

    return { symbols: [s1, s2, s3], isWin, payout, streak, coins: newCoins, cost: 1, tripleHopeDogo };
  });
});

// -----------------------------
// ✅ Buy shop item (callable) - GEN 2
// -----------------------------
exports.buyShopItem = onCall({ region: REGION }, async (req) => {
  const uid = requireAuth(req);

  const itemId = String(req.data?.itemId || "").trim();
  if (!itemId) throw new HttpsError("invalid-argument", "itemId is required.");

  const userRef = db.collection("users").doc(uid);
  const itemRef = db.collection("shopItems").doc(itemId);
  const saleRef = db.collection("shopMeta").doc("currentSale");
  const invRef = db.collection("users").doc(uid).collection("collection").doc(itemId);

  return await db.runTransaction(async (tx) => {
    const [userSnap, itemSnap, saleSnap, invSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(itemRef),
      tx.get(saleRef),
      tx.get(invRef),
    ]);

    if (!userSnap.exists) throw new HttpsError("failed-precondition", "User profile missing.");
    if (!itemSnap.exists) throw new HttpsError("not-found", "Shop item not found.");

    const u = userSnap.data() || {};
    const it = itemSnap.data() || {};

    const basePrice = Number(it.basePrice || 0);
    const discounts = saleSnap.exists ? (saleSnap.data()?.discounts || {}) : {};
    const disc = discounts[itemId] || 0;
    const finalPrice = priceAfterDiscount(basePrice, disc);

    const coins = Number(u.coins || 0);
    if (coins < finalPrice) throw new HttpsError("failed-precondition", "Not enough coins.");

    const stackable = !!it.stackable;
    const maxStack = Number(it.maxStack || 10);
    const prevQty = invSnap.exists ? Number((invSnap.data() || {}).qty || 0) : 0;

    let newQty = 1;
    if (stackable) {
      if (prevQty >= maxStack) throw new HttpsError("failed-precondition", `Max stack reached (${maxStack}).`);
      newQty = prevQty + 1;
    } else {
      if (invSnap.exists) throw new HttpsError("failed-precondition", "You already own this item.");
    }

    tx.update(userRef, { coins: coins - finalPrice, lastPurchaseAt: FieldValue.serverTimestamp() });

    tx.set(
      invRef,
      {
        name: it.name || "Item",
        icon: it.icon || "",
        desc: it.desc || "",
        rarity: it.rarity || "common",
        stackable,
        maxStack,
        qty: newQty,
        justBought: true,
        lastAcquiredAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, itemId, finalPrice, qty: newQty, coinsAfter: coins - finalPrice };
  });
});

// -----------------------------
// ✅ syncMyResults (callable) - GEN 2
// -----------------------------
//
// Reads:
// - results/{SEASON_ID}_{date}   (admin-created "final results" doc)
// - users/{uid}/votes/{SEASON_ID}_{date}  (user picks)
//
// Writes:
// - users/{uid} coins/correctPicks/totalPicks
// - users/{uid}/resultPopups/{SEASON_ID}_{date} (marks popup shown, stores payload)
// - predictionLeaders/{uid} (public leaderboard doc)
//
// Returns:
// - { ok:true, popup:null } if nothing new
// - { ok:true, popup:{...} } if a new game day was processed for this user
//
exports.syncMyResults = onCall({ region: REGION }, async (req) => {
  const uid = requireAuth(req);

  // ---- Read inputs
  const date = safeString(req.data?.date); // optional
  const force = !!req.data?.force; // optional

  // We process ONE completed day at a time:
  // - if date provided => process that date
  // - else => pick the newest completed results doc that the user hasn't seen yet
  const userRef = db.collection("users").doc(uid);
  const popupCollRef = userRef.collection("resultPopups");

  // Helper: find most recent completed results doc (simple approach)
  async function findNextResultToProcess() {
    if (date) return date;

    // Look at last ~25 result docs ordered by date desc (by id suffix)
    // ID format: `${SEASON_ID}_${YYYY-MM-DD}`
    const snap = await db
      .collection("results")
      .where("seasonId", "==", SEASON_ID)
      .orderBy("date", "desc")
      .limit(25)
      .get();

    for (const d of snap.docs) {
      const data = d.data() || {};
      const day = safeString(data.date);
      if (!day) continue;

      const popupId = `${SEASON_ID}_${day}`;
      const already = await popupCollRef.doc(popupId).get();
      if (!already.exists) return day;
    }
    return null;
  }

  const dayToProcess = await findNextResultToProcess();
  if (!dayToProcess) {
    return { ok: true, popup: null, reason: "no-unseen-results" };
  }

  const resultsId = `${SEASON_ID}_${dayToProcess}`;
  const votesId = `${SEASON_ID}_${dayToProcess}`;

  const resultsRef = db.collection("results").doc(resultsId);
  const votesRef = userRef.collection("votes").doc(votesId);
  const popupRef = popupCollRef.doc(resultsId);

  // If popup already recorded and not forcing, return it (so UI can show)
  const existingPopupSnap = await popupRef.get();
  if (existingPopupSnap.exists && !force) {
    const existing = existingPopupSnap.data() || {};
    return { ok: true, popup: existing.popup || null, alreadyProcessed: true };
  }

  // Pull docs
  const [resultsSnap, votesSnap, userSnap] = await Promise.all([
    resultsRef.get(),
    votesRef.get(),
    userRef.get(),
  ]);

  if (!resultsSnap.exists) {
    return { ok: true, popup: null, reason: "results-doc-missing", date: dayToProcess };
  }

  const results = resultsSnap.data() || {};
  const games = Array.isArray(results.games) ? results.games : [];

  if (games.length < 1) {
    return { ok: true, popup: null, reason: "results-empty", date: dayToProcess };
  }

  if (!votesSnap.exists) {
    // User didn't vote. Record a "no-vote" popup so it doesn't keep trying.
    const popup = {
      type: "no-vote",
      seasonId: SEASON_ID,
      date: dayToProcess,
      title: `Game Day Results — ${dayToProcess}`,
      message: "No votes submitted for this game day.",
      coinsAwarded: 0,
      correct: 0,
      total: 0,
      games: games.map((g, idx) => ({
        slot: `g${idx + 1}`,
        away: safeString(g.away),
        home: safeString(g.home),
        winner: safeString(g.winner),
        yourPick: null,
        isCorrect: false,
        awayScore: g.awayScore ?? null,
        homeScore: g.homeScore ?? null,
      })),
      createdAt: Date.now(),
    };

    await popupRef.set(
      { popup, createdAt: FieldValue.serverTimestamp(), processedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { ok: true, popup, noVote: true };
  }

  const picks = (votesSnap.data() || {}).picks || {};
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};

  // Require all 5 picks if enabled
  const pickCount = countPicks(picks);
  if (REQUIRE_5_PICKS && pickCount < games.length) {
    const popup = {
      type: "incomplete-vote",
      seasonId: SEASON_ID,
      date: dayToProcess,
      title: `Game Day Results — ${dayToProcess}`,
      message: `You submitted ${pickCount}/${games.length} picks. No payout (requires all picks).`,
      coinsAwarded: 0,
      correct: 0,
      total: games.length,
      games: games.map((g, idx) => {
        const slot = `g${idx + 1}`;
        const yourPick = safeString(picks[slot] || "");
        const winner = safeString(g.winner);
        const isCorrect = !!yourPick && !!winner && yourPick === winner;
        return {
          slot,
          away: safeString(g.away),
          home: safeString(g.home),
          winner,
          yourPick: yourPick || null,
          isCorrect,
          awayScore: g.awayScore ?? null,
          homeScore: g.homeScore ?? null,
        };
      }),
      createdAt: Date.now(),
    };

    await popupRef.set(
      { popup, createdAt: FieldValue.serverTimestamp(), processedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { ok: true, popup, incomplete: true };
  }

  // Compute correctness
  let correct = 0;
  const details = games.map((g, idx) => {
    const slot = `g${idx + 1}`;
    const winner = safeString(g.winner);
    const yourPick = safeString(picks[slot] || "");
    const isCorrect = !!winner && !!yourPick && winner === yourPick;
    if (isCorrect) correct += 1;

    return {
      slot,
      away: safeString(g.away),
      home: safeString(g.home),
      winner: winner || null,
      yourPick: yourPick || null,
      isCorrect,
      awayScore: g.awayScore ?? null,
      homeScore: g.homeScore ?? null,
    };
  });

  const total = games.length;
  const coinsAwarded = Math.max(0, correct * COINS_PER_CORRECT);

  // Apply updates transactionally
  const popup = {
    type: "results",
    seasonId: SEASON_ID,
    date: dayToProcess,
    title: `Game Day Results — ${dayToProcess}`,
    message: coinsAwarded > 0 ? `You earned +${coinsAwarded} coins!` : "No coins earned this game day.",
    coinsAwarded,
    correct,
    total,
    games: details,
    createdAt: Date.now(),
  };

  await db.runTransaction(async (tx) => {
    const uSnap = await tx.get(userRef);
    const u = uSnap.exists ? (uSnap.data() || {}) : {};

    const prevCoins = Number(u.coins || 0);
    const prevCorrect = Number(u.correctPicks || 0);
    const prevTotal = Number(u.totalPicks || 0);

    const newCoins = prevCoins + coinsAwarded;
    const newCorrect = prevCorrect + correct;
    const newTotal = prevTotal + total;

    tx.set(
      userRef,
      {
        coins: newCoins,
        correctPicks: newCorrect,
        totalPicks: newTotal,
        lastResultsSyncAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Mark popup doc (so it shows once)
    tx.set(
      popupRef,
      {
        popup,
        processedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Update public prediction leaderboard doc
    const username = safeString(u.username) || `user_${uid.slice(0, 6)}`;
    const pct = newTotal > 0 ? (newCorrect / newTotal) * 100 : 0;

    tx.set(
      db.collection("predictionLeaders").doc(uid),
      {
        uid,
        username,
        correct: newCorrect,
        total: newTotal,
        votePct: Number(pct.toFixed(1)),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { ok: true, popup };
});
