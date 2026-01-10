// js/shop.js
export function initShopUI() {
  console.log("✅ initShopUI loaded");

  const giftBtn = document.getElementById("openGiftShopBtn");
  const colBtn = document.getElementById("openCollectionBtn");

  const giftModal = document.getElementById("giftShopModal");
  const colModal = document.getElementById("collectionModal");

  if (giftBtn && giftModal) {
    giftBtn.onclick = () => giftModal.classList.remove("hidden");
  }

  if (colBtn && colModal) {
    colBtn.onclick = () => colModal.classList.remove("hidden");
  }

  // close modals by clicking backdrop
  [giftModal, colModal].forEach(modal => {
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  });
}
