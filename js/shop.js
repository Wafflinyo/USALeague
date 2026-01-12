import { db } from "./firebase.js";
import {
  collection, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const functions = getFunctions();
const buyShopItem = httpsCallable(functions, "buyShopItem");

const el = (id) => document.getElementById(id);
const uid = () => window.__USA_UID__ || null;

function openModal(id){ el(id)?.classList.remove("hidden"); }
function closeModal(id){ el(id)?.classList.add("hidden"); }

function rarityLabel(r){
  if (!r) return "";
  if (r === "usa") return "USA Merch";
  return r.toUpperCase();
}

function sortShopItems(a,b){
  const order = { usa:0, legendary:1, epic:2, rare:3, uncommon:4, common:5 };
  return (order[a.rarity] ?? 99) - (order[b.rarity] ?? 99);
}

async function loadShopItems(){
  const snap = await getDocs(collection(db, "shopItems"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(sortShopItems);
}

async function loadSale(){
  const snap = await getDoc(doc(db, "shopMeta", "currentSale"));
  if (!snap.exists()) return { discounts: {}, label: "No Sale Today" };
  return snap.data();
}

function priceWithSale(base, disc){
  const d = Math.max(0, Math.min(0.25, Number(disc || 0)));
  return Math.max(1, Math.round(Number(base || 0) * (1 - d)));
}

function renderShopGrid(items, sale){
  const discounts = sale?.discounts || {};
  return `
    <div class="shopGrid">
      ${items.map(it => {
        const disc = discounts[it.id] || 0;
        const finalPrice = priceWithSale(it.basePrice, disc);
        const onSale = disc > 0;

        return `
          <button class="shopItemCard ${it.rarity || "common"}" data-item="${it.id}">
            <img class="shopIcon" src="${it.icon}" alt="${it.name}">
            <div class="shopNameRow">
              <div class="shopItemName">${it.name}</div>
              ${onSale ? `<div class="saleBadge">-${Math.round(disc*100)}%</div>` : ``}
            </div>
            <div class="shopItemMeta">${rarityLabel(it.rarity)} • ${onSale ? `<s>${it.basePrice}</s> ` : ``}<b>${finalPrice}</b> 🧇</div>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderDetails(it, sale){
  const disc = (sale?.discounts || {})[it.id] || 0;
  const finalPrice = priceWithSale(it.basePrice, disc);
  const onSale = disc > 0;

  return `
    <div class="shopDetails">
      <img class="shopDetailsImg" src="${it.icon}" alt="${it.name}">
      <div class="shopDetailsTitle">${it.name}</div>
      <div class="shopDetailsRarity">${rarityLabel(it.rarity)}</div>
      <div class="shopDetailsDesc">${it.desc || ""}</div>

      <div class="shopDetailsPrice">
        ${onSale ? `<div>Was: <s>${it.basePrice}</s> 🧇</div>` : ``}
        <div>Price: <b>${finalPrice}</b> 🧇 ${onSale ? `(Sale -${Math.round(disc*100)}%)` : ``}</div>
      </div>

      <button class="primaryBtn" id="buyBtn">Buy</button>
      <div class="smallNote" id="shopMsg"></div>
    </div>
  `;
}

async function renderGiftShop(){
  const card = el("giftShopCard");
  if (!card) return;

  card.innerHTML = `
    <div class="bigHeader">
      <div>
        <div class="bigTitle">Mask’s Gift Shop</div>
        <div class="smallNote" id="saleNote">Loading sale...</div>
      </div>
      <button class="ghostBtn" id="closeGift">Close</button>
    </div>

    <div class="shopLayout">
      <div class="shopLeft">
        <div id="shopGridWrap"></div>
      </div>
      <div class="shopRight">
        <div class="shopSectionTitle">Item Preview</div>
        <div id="detailsPane" class="shopDetailsEmpty">Select an item.</div>
      </div>
    </div>
  `;

  card.querySelector("#closeGift")?.addEventListener("click", () => closeModal("giftShopModal"));

  const [items, sale] = await Promise.all([loadShopItems(), loadSale()]);
  card.querySelector("#saleNote").textContent =
    `${sale.label || "Daily Sale"} • ${sale.dayKey ? `Today: ${sale.dayKey}` : ""}`.trim();

  const gridWrap = card.querySelector("#shopGridWrap");
  gridWrap.innerHTML = renderShopGrid(items, sale);

  gridWrap.querySelectorAll("[data-item]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const itemId = btn.getAttribute("data-item");
      const it = items.find(x => x.id === itemId);
      if (!it) return;

      const pane = card.querySelector("#detailsPane");
      pane.innerHTML = renderDetails(it, sale);

      pane.querySelector("#buyBtn")?.addEventListener("click", async () => {
        const msg = pane.querySelector("#shopMsg");
        msg.textContent = "Buying...";

        try {
          await buyShopItem({ itemId: it.id });
          msg.textContent = "Purchased! Added to Collection.";
        } catch (e) {
          msg.textContent = e?.message || "Purchase failed.";
        }
      });
    });
  });
}

async function renderCollection(){
  const u = uid();
  const card = el("collectionCard");
  if (!u || !card) return;

  card.innerHTML = `
    <div class="bigHeader">
      <div>
        <div class="bigTitle">Collection</div>
        <div class="smallNote">Recent items glow for 24 hours.</div>
      </div>
      <button class="ghostBtn" id="closeCol">Close</button>
    </div>
    <div id="colGrid" class="collectionGrid"></div>
  `;

  card.querySelector("#closeCol")?.addEventListener("click", () => closeModal("collectionModal"));

  const snap = await getDocs(collection(db, "users", u, "collection"));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const grid = card.querySelector("#colGrid");
  if (!items.length){
    grid.innerHTML = `<div class="smallNote">No items yet.</div>`;
    return;
  }

  const now = Date.now();
  const recentMs = 24 * 60 * 60 * 1000;

  grid.innerHTML = items.map(it => {
    const t = it.lastAcquiredAt?.toDate?.()?.getTime?.() ?? 0;
    const recent = (now - t) < recentMs;

    return `
      <div class="invCard ${recent ? "recentGlow" : ""}">
        <img class="invIcon" src="${it.icon}" alt="${it.name}">
        <div class="invName">${it.name}</div>
        <div class="invMeta">${rarityLabel(it.rarity)} • Qty: ${it.qty ?? 1}</div>
      </div>
    `;
  }).join("");
}

export function initShopUI() {
  console.log("✅ initShopUI loaded");

  const giftBtn = el("openGiftShopBtn");
  const colBtn  = el("openCollectionBtn");

  const giftModal = el("giftShopModal");
  const colModal  = el("collectionModal");

  if (giftBtn && giftModal) {
    giftBtn.onclick = async () => {
      if (!uid()) return alert("Please log in first.");
      openModal("giftShopModal");
      await renderGiftShop();
    };
  }

  if (colBtn && colModal) {
    colBtn.onclick = async () => {
      if (!uid()) return alert("Please log in first.");
      openModal("collectionModal");
      await renderCollection();
    };
  }

  // close modals by clicking backdrop
  [giftModal, colModal].forEach(modal => {
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  });
}
