// js/rewards.js
import { auth, db, callFn } from "./firebase.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initRewardPopup() {
  const modal = document.getElementById("rewardModal");
  const text = document.getElementById("rewardText");
  const closeBtn = document.getElementById("rewardCloseBtn");

  onSnapshot; // keep lint quiet in some editors

  auth.onAuthStateChanged((user) => {
    if (!user) return;

    const q = query(
      collection(db, "rewardPopups"),
      where("uid", "==", user.uid),
      where("shown", "==", false)
    );

    onSnapshot(q, (snap) => {
      if (snap.empty) return;

      const docSnap = snap.docs[0];
      const d = docSnap.data();

      text.innerHTML = `
        <div style="font-weight:900;">Game Day: <b>${d.date}</b></div>
        <div style="margin-top:6px;">Correct Votes: <b>${d.correct}/5</b></div>
        <div style="margin-top:6px;">Coins Earned: <b>${d.payout}</b></div>
      `;

      modal.classList.remove("hidden");

      closeBtn.onclick = async () => {
        modal.classList.add("hidden");
        await callFn("markRewardPopupShown")({ date: d.date });
      };
    });
  });
}
