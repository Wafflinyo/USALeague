// functions/index.js  (GEN 1)
// Deploy: firebase deploy --only functions

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const NEW_USER_BONUS = 100;
const DAILY_BONUS = 50;

// If you want “Hopedogo triple = auto loss”
const HOPE_DOGO_MATCH = (sym) =>
  String(sym?.type || "").toLowerCase() === "hopedogo" ||
  String(sym?.teamName || "").toLowerCase() === "hopedogo" ||
  String(sym?.name || "").toLowerCase() === "hopedogo";

// -----------------------------
// Helpers
// -----------------------------
function requireAuth(context) {
  if (!context?.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }
  return context.auth.uid;
}

function todayKeyNY() {
  // YYYY-MM-DD in America/New_York
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
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
// ✅ Auto-create user doc (Gen 1 Auth trigger)
// If your client already creates the user doc during signup, this is harmless.
// -----------------------------
exports.onAuthUserCreated = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();

  if (snap.exists) return;

  const email = user.email || "";
  const fallbackUsername = email
    ? email.split("@")[0].slice(0, 18)
    : `user_${uid.slice(0, 6)}`;

  await userRef.set({
    username: fallbackUsername,
    coins: NEW_USER_BONUS,
    correctPicks: 0,
    totalPicks: 0,
    slotsStreak: 0,
    lastDailyBonus: null,
    createdAt: FieldValue.serverTimestamp(),
  });
});

// -----------------------------
// ✅ Daily bonus (server-side callable)
// Fixes your permission denied bonus writes.
// -----------------------------
exports.ensureDailyBonus = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const today = todayKeyNY();

    const userRef = db.collection("users").doc(uid);

    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);

      // If missing, create a safe default profile (so nobody gets stuck)
      if (!snap.exists) {
        tx.set(userRef, {
          username: `user_${uid.slice(0, 6)}`,
          coins: NEW_USER_BONUS,
          correctPicks: 0,
          totalPicks: 0,
          slotsStreak: 0,
          lastDailyBonus: null,
          createdAt: FieldValue.serverTimestamp(),
        });

        // Still continue and apply daily bonus on first login
        const coins = NEW_USER_BONUS + DAILY_BONUS;
        tx.update(userRef, { coins, lastDailyBonus: today });

        return { applied: true, today, coins, bonus: DAILY_BONUS, createdProfile: true };
      }

      const u = snap.data() || {};
      const last = u.lastDailyBonus || null;

      if (last === today) {
        return { applied: false, today, coins: u.coins || 0 };
      }

      const newCoins = (u.coins || 0) + DAILY_BONUS;
      tx.update(userRef, { coins: newCoins, lastDailyBonus: today });

      return { applied: true, today, coins: newCoins, bonus: DAILY_BONUS, createdProfile: false };
    });
  });

// -----------------------------
// ✅ Play slots (server-side secure)
// Costs 1 coin. Win pays 500 * 2^streak.
// Triple hopedogo => auto loss.
// -----------------------------
exports.playSlots = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);

    const symbols = data?.symbols;
    if (!Array.isArray(symbols) || symbols.length < 3) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "symbols must be an array with at least 3 entries."
      );
    }

    const pool = symbols.map(safeSymbol).filter((s) => s.icon);
    if (pool.length < 3) {
      throw new functions.https.HttpsError("invalid-argument", "symbols pool is empty.");
    }

    const userRef = db.collection("users").doc(uid);

    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError("failed-precondition", "User profile missing.");
      }

      const u = snap.data() || {};
      const coins = Number(u.coins || 0);
      let streak = Number(u.slotsStreak || 0);

      if (coins < 1) {
        throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");
      }

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
        isWin =
          String(s1.teamName) === String(s2.teamName) &&
          String(s2.teamName) === String(s3.teamName);

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

      return {
        symbols: [s1, s2, s3],
        isWin,
        payout,
        streak,
        coins: newCoins,
        cost: 1,
        tripleHopeDogo,
      };
    });
  });

// -----------------------------
// ✅ Buy shop item
// Reads shopItems/{itemId} and shopMeta/currentSale
// Writes to users/{uid}/collection/{itemId}
// -----------------------------
exports.buyShopItem = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);

    const itemId = String(data?.itemId || "").trim();
    if (!itemId) {
      throw new functions.https.HttpsError("invalid-argument", "itemId is required.");
    }

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

      if (!userSnap.exists) {
        throw new functions.https.HttpsError("failed-precondition", "User profile missing.");
      }
      if (!itemSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Shop item not found.");
      }

      const u = userSnap.data() || {};
      const it = itemSnap.data() || {};

      const basePrice = Number(it.basePrice || 0);
      const discounts = saleSnap.exists ? (saleSnap.data()?.discounts || {}) : {};
      const disc = discounts[itemId] || 0;
      const finalPrice = priceAfterDiscount(basePrice, disc);

      const coins = Number(u.coins || 0);
      if (coins < finalPrice) {
        throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");
      }

      const stackable = !!it.stackable;
      const maxStack = Number(it.maxStack || 10);
      const prev = invSnap.exists ? (invSnap.data() || {}) : {};
      const prevQty = Number(prev.qty || 0);

      let newQty = 1;

      if (stackable) {
        if (prevQty >= maxStack) {
          throw new functions.https.HttpsError("failed-precondition", `Max stack reached (${maxStack}).`);
        }
        newQty = Math.min(maxStack, prevQty + 1);
      } else {
        if (invSnap.exists) {
          throw new functions.https.HttpsError("failed-precondition", "You already own this item.");
        }
        newQty = 1;
      }

      tx.update(userRef, {
        coins: coins - finalPrice,
        lastPurchaseAt: FieldValue.serverTimestamp(),
      });

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

      return {
        ok: true,
        itemId,
        finalPrice,
        qty: newQty,
        coinsAfter: coins - finalPrice,
      };
    });
  });

// -----------------------------
// ✅ syncMyResults stub
// -----------------------------
exports.syncMyResults = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    functions.logger.info("syncMyResults called by", uid);
    return { ok: true };
  });
