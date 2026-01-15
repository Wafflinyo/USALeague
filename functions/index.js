/**
 * functions/index.js (GEN 2 / v2)
 * Deploy: firebase deploy --only functions
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
// ✅ syncMyResults stub (callable) - GEN 2
// -----------------------------
exports.syncMyResults = onCall({ region: REGION }, async (req) => {
  const uid = requireAuth(req);
  console.log("syncMyResults called by", uid);
  return { ok: true };
});
