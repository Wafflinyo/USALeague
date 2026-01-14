// js/auth.js
import { auth, db } from "./firebase.js";
import { callFn } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NEW_USER_BONUS = 100;

/**
 * ✅ New York YYYY-MM-DD (not UTC)
 */
function todayKeyNY() {
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

/**
 * ✅ Signup:
 * - creates Auth user
 * - creates Firestore user doc
 * NOTE: Daily bonus is handled server-side now, so we DON'T add +50 here.
 * We'll just give NEW_USER_BONUS and let the callable function apply daily if needed.
 */
export async function signup(email, password, username) {
  if (!username || username.trim().length < 2) {
    throw new Error("Username must be at least 2 characters.");
  }

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  const ref = doc(db, "users", uid);

  await setDoc(ref, {
    username: username.trim(),
    coins: NEW_USER_BONUS,
    correctPicks: 0,
    totalPicks: 0,
    slotsStreak: 0,

    // track daily bonus server-side; keep null at creation
    lastDailyBonus: null,

    createdAt: serverTimestamp(),
  });

  console.log(`✅ signup: created user doc, coins=${NEW_USER_BONUS}`);

  // Optional: Immediately apply server-side daily bonus on first signup/login.
  // If you already call ensureDailyBonus() from your HTML watchAuth, you can remove this.
  try {
    await ensureDailyBonus();
  } catch (e) {
    console.warn("⚠️ ensureDailyBonus after signup failed:", e);
  }

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
 * ✅ Daily bonus is SERVER-SIDE now (callable function).
 * Server reads uid from auth context, so client sends {}.
 */
export async function ensureDailyBonus() {
  const fn = callFn("ensureDailyBonus");
  const res = await fn({}); // { applied, today, coins, bonus }
  console.log("🎁 ensureDailyBonus result:", res?.data || res);
  return res?.data || res;
}
