// js/shop.js
import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { SHOP_ITEMS } from "./shopData.js";

const $ = (id) => document.getElementById(id);

function requireUid() {
  const uid = window.__USA_UID__ || null;
  if (!uid) throw new Error("You must be logged in.");
  return uid;
}

function rarityLabel(r) {
  return (r || "common").toUpperCase();
}

function priceAfterDiscount(basePrice, disc) {
  const d = Math.max(0, Math.min(Number(disc || 0), 0.25));
  return Math.max(1, Math.round(Number(basePrice) * (1 - d)));
}

/**
 * ✅ Convert icon paths to a GitHub Pages-safe public URL.
 * - Keeps full https:// URLs as-is
 * - Removes leading "/" so it doesn't break /USALeague/ base path
 * - Resolves relative to site root (shop.js lives in /js/)
 */
function toPublicUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;

  // remove leading slashes so it works on GitHub Pages
  const clean = String(p).replace(/^\/+/, "");

  // shop.js is in /js/, so go up one level to the site root
  return new URL(`../${clean}`, import.meta.url).href;
}

/**
 * One-time helper you can run to create/update shopItems docs from SHOP_ITEMS array.
 * You’ll click a "Seed Shop" button we’ll add to the modal.
 */
async function seedShopItems() {
  // This writes from client. Your rules currently deny shopItems writes.
  // So you have 2 options:
  // (A) manually create items in console (you already did),
  // (B) temporarily allow shopItems write for yourself.
  // For now, we just show you the data in console.
  console.log("SHOP_ITEMS to create in Firestore:", SHOP_ITEMS);
  alert("Seed helper: check console for SHOP_ITEMS list. Create/update those docs in Firestore.");
}

async function loadShopItemsFromFirestore() {
  const snap = await getDocs(collection(db, "shopItems"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadSale() {
  // NOTE: This requires Firestore rules to allow read on /shopMeta/{docId}
  const saleSnap = await getDoc(doc(db, "shopMeta", "currentSale"));
  if (!saleSnap.exists()) return { discounts: {}, label: "No Sale Today" };

  const data = saleSnap.data();
  return {
    discounts: data.discounts || {},
    label: data.label || "Daily Sale",
    dayKey: data.dayKey || null
  };
}

function renderShopModal({ items, sale, onSelect, selectedId }) {
  const card = $("giftShopCard");
  if (!card) return;

  const selected = items.find(x => x.id === selectedId) || null;

  const gridHtml = items.map(it => {
    const disc = sale.discounts?.[it.id] || 0;
    const base = Number(it.basePrice || 0);
    const finalP = priceAfterDiscount(base, disc);
    const onSale = disc > 0;

    return `
      <button class="shopTile ${selectedId === it.id ? "active" : ""}" data-item="${it.id}">
        <img class="shopIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
        <div class="shopTileName">${it.name}</div>
        <div class="shopTileMeta">
          <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
          <span class="price">${onSale ? `<s>${base}</s> ${finalP}` : `${base}`}</span>
        </div>
      </button>
    `;
  }).join("");

  const detailHtml = selected ? (() => {
    const disc = sale.discounts?.[selected.id] || 0;
    const base = Number(selected.basePrice || 0);
    const finalP = priceAfterDiscount(base, disc);
    const onSale = disc > 0;
    const stack = selected.stackable ? `Stackable (max ${selected.maxStack || 10})` : "Not stackable";

    return `
      <div class="shopDetail">
        <div class="shopDetailTop">
          <img class="shopDetailIcon" src="${toPublicUrl(selected.icon)}" alt="${selected.name}">
          <div>
            <div class="shopDetailName">${selected.name}</div>
            <div class="shopDetailTags">
              <span class="rarity ${selected.rarity || "common"}">${rarityLabel(selected.rarity)}</span>
              <span class="stack">${stack}</span>
            </div>
          </div>
        </div>

        <div class="shopDetailDesc">${selected.desc || ""}</div>

        <div class="shopDetailPrice">
          ${onSale
            ? `<div>Price: <s>${base}</s> <b>${finalP}</b> (-${Math.round(disc * 100)}%)</div>`
            : `<div>Price: <b>${base}</b></div>`
          }
        </div>

        <button class="primaryBtn" id="buyItemBtn">Buy</button>
        <div class="smallNote" id="buyMsg"></div>
      </div>
    `;
  })() : `
    <div class="shopDetail">
      <div class="smallNote">Select an item to view details.</div>
    </div>
  `;

  card.innerHTML = `
    <div class="bigHeaderRow">
      <div>
        <div style="font-weight:950;font-size:18px;">Mask’s Gift Shop</div>
        <div class="smallNote">${sale.label || "Sale"} ${sale.dayKey ? `• ${sale.dayKey}` : ""}</div>
      </div>
      <div class="bigHeaderBtns">
        <button class="ghostBtn" id="seedShopBtn">Seed Helper</button>
        <button class="ghostBtn" id="closeGiftShopBtn">Close</button>
      </div>
    </div>

    <div class="shopLayout">
      <div class="shopGrid">${gridHtml}</div>
      ${detailHtml}
    </div>
  `;

  // wire buttons
  $("closeGiftShopBtn")?.addEventListener("click", () => $("giftShopModal")?.classList.add("hidden"));
  $("seedShopBtn")?.addEventListener("click", seedShopItems);

  // clicking tiles
  card.querySelectorAll(".shopTile").forEach(btn => {
    btn.addEventListener("click", () => onSelect(btn.dataset.item));
  });
}

async function buySelectedItem(itemId) {
  requireUid(); // ensures logged-in before calling function
  const fn = httpsCallable(getFunctions(), "buyShopItem");
  return fn({ itemId });
}

function renderCollectionModal(uid) {
  const card = $("collectionCard");
  const modal = $("collectionModal");
  if (!card || !modal) return;

  // live inventory listener
  const colRef = collection(db, "users", uid, "collection");
  onSnapshot(colRef, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.lastAcquiredAt?.seconds || 0) - (a.lastAcquiredAt?.seconds || 0));

    const grid = items.length ? items.map(it => `
      <div class="invTile ${it.justBought ? "newGlow" : ""}">
        <img class="invIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
        <div class="invName">${it.name}</div>
        <div class="invMeta">
          <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
          <span class="qty">x${it.qty || 1}</span>
        </div>
      </div>
    `).join("") : `<div class="smallNote">No items yet. Buy something in the shop!</div>`;

    card.innerHTML = `
      <div class="bigHeaderRow">
        <div style="font-weight:950;font-size:18px;">Collection</div>
        <button class="ghostBtn" id="closeCollectionBtn">Close</button>
      </div>
      <div class="invGrid">${grid}</div>
    `;

    $("closeCollectionBtn")?.addEventListener("click", () => modal.classList.add("hidden"));
  });
}

export function initShopUI() {
  console.log("✅ initShopUI loaded");

  const giftBtn = $("openGiftShopBtn");
  const colBtn = $("openCollectionBtn");
  const giftModal = $("giftShopModal");
  const colModal = $("collectionModal");

  let shopItems = [];
  let sale = { discounts: {}, label: "Loading sale..." };
  let selectedId = null;

  // ✅ keep the onSelect handler stable
  function handleSelect(id) {
    selectedId = id;
    renderShopModal({
      items: shopItems,
      sale,
      selectedId,
      onSelect: handleSelect
    });
    wireBuyButton();
  }

  async function refreshShop() {
    try {
      sale = await loadSale();
      shopItems = await loadShopItemsFromFirestore();

      // Default select first item
      if (!selectedId && shopItems.length) selectedId = shopItems[0].id;

      renderShopModal({
        items: shopItems,
        sale,
        selectedId,
        onSelect: handleSelect
      });

      wireBuyButton();
    } catch (e) {
      console.error(e);
      const card = $("giftShopCard");
      if (card) card.innerHTML = `<div class="smallNote">Shop failed to load: ${e.message}</div>`;
    }
  }

  function wireBuyButton() {
    const buyBtn = $("buyItemBtn");
    if (!buyBtn || !selectedId) return;

    buyBtn.onclick = async () => {
      const msg = $("buyMsg");
      if (msg) msg.textContent = "";

      try {
        const res = await buySelectedItem(selectedId);
        if (msg) msg.textContent = `✅ Purchased! (-${res.data.finalPrice} coins)`;
      } catch (err) {
        console.error(err);
        const m = err?.message || "Purchase failed.";
        if (msg) msg.textContent = `❌ ${m}`;
      }
    };
  }

  if (giftBtn && giftModal) {
    giftBtn.onclick = async () => {
      giftModal.classList.remove("hidden");
      await refreshShop();
    };
  }

  if (colBtn && colModal) {
    colBtn.onclick = () => {
      colModal.classList.remove("hidden");
      try {
        const uid = requireUid();
        renderCollectionModal(uid);
      } catch (e) {
        const card = $("collectionCard");
        if (card) card.innerHTML = `<div class="smallNote">${e.message}</div>`;
      }
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
