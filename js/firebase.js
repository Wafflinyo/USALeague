import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 1) PASTE YOUR FIREBASE CONFIG HERE (from Firebase Console)
const firebaseConfig = {
  apiKey: "PASTE",
  authDomain: "PASTE",
  projectId: "PASTE",
  appId: "PASTE"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Create profile on first sign up
export async function createProfileIfMissing(uid, username) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // new account: give 100 coins
    await setDoc(ref, {
      username,
      coins: 100,
      correctPicks: 0,
      totalPicks: 0,
      lastDailyClaim: null,
      createdAt: serverTimestamp()
    });
  }
}

// Daily claim logic (client-safe-ish, but best enforced by a Cloud Function later)
export async function claimDailyIfEligible(uid) {
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const data = snap.data();
    const last = data.lastDailyClaim?.toDate?.() ?? null;

    const now = new Date();
    const todayKey = now.toISOString().slice(0,10);

    const lastKey = last ? last.toISOString().slice(0,10) : null;
    if (lastKey === todayKey) return; // already claimed today

    tx.update(ref, {
      coins: (data.coins ?? 0) + 50,
      lastDailyClaim: serverTimestamp()
    });
  });
}

export function watchAuth(callback) {
  onAuthStateChanged(auth, callback);
}

export async function signup(email, pass, username) {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  await createProfileIfMissing(cred.user.uid, username);
  return cred.user.uid;
}

export async function login(email, pass) {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  return cred.user.uid;
}
