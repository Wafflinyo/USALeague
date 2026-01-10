// js/slots.js
export function initSlotsUI() {
  console.log("✅ initSlotsUI loaded");

  const btn = document.getElementById("openSlotsBtn");
  const modal = document.getElementById("slotsModal");

  if (!btn || !modal) return;

  btn.onclick = () => modal.classList.remove("hidden");

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
}
