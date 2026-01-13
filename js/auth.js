// js/auth.js
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NEW_USER_BONUS = 100;
const DAILY_BONUS = 50;

/**
 * ✅ TRUE New York "YYYY-MM-DD"
 * Uses America/New_York local date, not UTC.
 */
function todayKeyNY() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export async function signup(email, password, username) {
  if (!username || username.trim().length < 2) {
    throw new Error("Username must be at least 2 characters.");
  }

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  const today = todayKeyNY();

  // ✅ Give new user 100 + today's daily 50 immediately
  const ref = doc(db, "users", uid);
  await setDoc(ref, {
    username: username.trim(),
    coins: NEW_USER_BONUS + DAILY_BONUS,
    correctPicks: 0,
    totalPicks: 0,
    slotsStreak: 0,

    // ✅ mark daily claimed for today (because we just granted it)
    lastDailyBonus: today,

    createdAt: serverTimestamp()
  });

  console.log(`✅ signup: granted NEW_USER_BONUS(${NEW_USER_BONUS}) + DAILY_BONUS(${DAILY_BONUS}) for ${today}`);
  return uid;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user.uid;
}

export async function logout() {
  await signOut(auth);
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/**
 * ✅ Safe daily bonus:
 * - Uses NY date key
 * - Uses a transaction so it cannot double-award
 * - Uses increment so coins can't be overwritten by stale reads
 */
export async function ensureDailyBonus(uid) {
  const ref = doc(db, "users", uid);
  const today = todayKeyNY();

  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      return { ok: false, reason: "missing_user_doc", granted: false };
    }

    const data = snap.data();
    const last = data.lastDailyBonus || null;

    if (last === today) {
      return { ok: true, granted: false, today, last };
    }

    tx.update(ref, {
      coins: increment(DAILY_BONUS),
      lastDailyBonus: today
    });

    return { ok: true, granted: true, today, last, added: DAILY_BONUS };
  });

  if (result.ok && result.granted) {
    console.log(`✅ Daily bonus granted: +${DAILY_BONUS} (NY day ${result.today}, was ${result.last || "null"})`);
  } else if (result.ok) {
    console.log(`ℹ️ Daily bonus already claimed for NY day ${result.today}`);
  } else {
    console.warn(`⚠️ ensureDailyBonus skipped: ${result.reason}`);
  }

  return result;
}

