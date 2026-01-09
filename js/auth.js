// js/auth.js
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NEW_USER_BONUS = 100;
const DAILY_BONUS = 50;

function todayKeyNY() {
  // simple daily key; good enough for now
  return new Date().toISOString().slice(0, 10);
}

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
    lastDailyBonus: null,
    createdAt: serverTimestamp()
  });

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

export async function ensureDailyBonus(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const d = snap.data();
  const today = todayKeyNY();
  const last = d.lastDailyBonus || null;

  if (last !== today) {
    await updateDoc(ref, {
      coins: (d.coins || 0) + DAILY_BONUS,
      lastDailyBonus: today
    });
  }
}
