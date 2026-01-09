// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// ✅ YOUR project is usa-league-web-83a2b
const firebaseConfig = {
  apiKey: "AIzaSyA7hzFu0zf9MgXY87S-ryrxLTXZOEfa4rQ",
  authDomain: "usa-league-web-83a2b.firebaseapp.com",
  projectId: "usa-league-web-83a2b",
  storageBucket: "usa-league-web-83a2b.firebasestorage.app",
  messagingSenderId: "484147991150",
  appId: "1:484147991150:web:c330c5b735e9fcf8db0c7f"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// IMPORTANT: your functions are in us-central1 (from deploy)
export const functions = getFunctions(app, "us-central1");
export const callFn = (name) => httpsCallable(functions, name);


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
