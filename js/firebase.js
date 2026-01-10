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
