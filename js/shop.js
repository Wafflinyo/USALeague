// js/shop.js
import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const $ = (id) => document.getElementById(id);

const SEASON_ID = "season1"; // not required here but keeping your convention

function requireUid() {
  const uid = window.__USA_UID__ || null;
  if (!uid) throw new Error("You must be logged in.");
  return uid;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rarityLabel(r) {
  return String(r || "common").toUpperCase();
}

function priceAfterDiscount(basePrice, disc) {
  const d = Math.max(0, Math.min(Number(disc || 0), 0.25));
  return Math.max(1, Math.round(Number(basePrice) * (1 - d)));
}

/**
 * Convert icon paths to GitHub Pages-safe URL.
 * - Keeps full https URLs as-is
 * - Removes leading "/" so it doesn't break /REPO/ base path
 * - Resolves relative to site root (shop.js is in /js/)
 */
function toPublicUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const clean = String(p).replace(/^\/+/, "");
  return new URL(`../${clean}`, import.meta.url).href;
}

// -------------------------
// Firestore loads
// -------------------------
async function loadShopItemsFromFirestore() {
  const snap = await getDocs(collection(db, "shopItems"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadSale() {
  const saleSnap = await getDoc(doc(db, "shopMeta", "currentSale"));
  if (!saleSnap.exists()) return { discounts: {}, label: "No Sale Today", dayKey: null };

  const data = saleSnap.data() || {};
  return {
    discounts: data.discounts || {},
    label: data.label || "Daily Sale",
    dayKey: data.dayKey || null,
  };
}

async function buySelectedItem(itemId) {
  requireUid();
  const fn = httpsCallable(getFunctions(), "buyShopItem");
  return fn({ itemId });
}

// -------------------------
// Shared Item Details Modal
// -------------------------
function openItemModal({ mode, item, sale }) {
  const modal = $("itemDetailModal");
  const card = $("itemDetailCard");
  if (!modal || !card) return;

  const isShop = mode === "shop";
  const name = escapeHtml(item?.name || "Item");
  const desc = escapeHtml(item?.desc || "");
  const icon = toPublicUrl(item?.icon || "");
  const rarity = String(item?.rarity || "common");
  const stack = item?.stackable ? `Stackable (max ${item?.maxStack || 10})` : "Not stackable";

  let priceLine = "";
  if (isShop) {
    const disc = sale?.discounts?.[item.id] || 0;
    const base = Number(item.basePrice || 0);
    const finalP = priceAfterDiscount(base, disc);
    const onSale = disc > 0;

    priceLine = onSale
      ? `Price: <s>${base}</s> <b>${finalP}</b> (-${Math.round(disc * 100)}%)`
      : `Price: <b>${base}</b>`;
  } else {
    const qty = Number(item.qty || 1);
    priceLine = `Owned: <b>x${qty}</b>`;
  }

  card.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:12px;">
      <img src="${icon}" alt="${name}" style="width:120px;height:120px;object-fit:contain;border-radius:14px;background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.16);padding:10px;">
      <div style="flex:1;">
        <div style="font-weight:950; font-size:18px; color:rgba(255,255,255,0.96);">${name}</div>
        <div style="margin-top:6px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <span class="rarity ${rarity}">${rarityLabel(rarity)}</span>
          <span style="font-weight:900; color:rgba(255,255,255,0.85);">${escapeHtml(stack)}</span>
        </div>
      </div>
    </div>

    <div style="margin-top:12px; font-weight:800; color:rgba(255,255,255,0.88); line-height:1.35;">
      ${desc || (isShop ? "No description." : "No description.")}
    </div>

    <div style="margin-top:12px; font-weight:950; color:rgba(255,255,255,0.94);">
      ${priceLine}
    </div>

    <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
      ${isShop ? `<button class="primaryBtn" id="modalBuyBtn">Buy</button>` : ``}
      <button class="ghostBtn" id="modalCloseBtn">Close</button>
      ${isShop ? `<div class="smallNote" id="modalBuyMsg" style="margin-left:2px;"></div>` : ``}
    </div>
  `;

  modal.classList.remove("hidden");

  // close handlers
  $("modalCloseBtn")?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  }, { once: true });

  // buy handler (shop only)
  if (isShop) {
    $("modalBuyBtn")?.addEventListener("click", async () => {
      const msg = $("modalBuyMsg");
      if (msg) msg.textContent = "";
      try {
        const res = await buySelectedItem(item.id);
        if (msg) msg.textContent = `✅ Purchased! (-${res.data.finalPrice} coins)`;
      } catch (err) {
        console.error(err);
        if (msg) msg.textContent = `❌ ${err?.message || "Purchase failed."}`;
      }
    });
  }
}

// -------------------------
// Render Shop inside tab
// -------------------------
function renderShopIntoTab({ rootEl, items, sale }) {
  const saleLine = `${escapeHtml(sale?.label || "Sale")}${sale?.dayKey ? ` • ${escapeHtml(sale.dayKey)}` : ""}`;

  if (!items.length) {
    rootEl.innerHTML = `<div class="smallNote">No shop items found. (Check Firestore: /shopItems read access)</div>`;
    return;
  }

  const gridHtml = items.map((it) => {
    const disc = sale?.discounts?.[it.id] || 0;
    const base = Number(it.basePrice || 0);
    const finalP = priceAfterDiscount(base, disc);
    const onSale = disc > 0;

    return `
      <button class="shopTile" data-item="${escapeHtml(it.id)}" type="button">
        <img class="shopIcon" src="${toPublicUrl(it.icon)}" alt="${escapeHtml(it.name)}">
        <div class="shopTileName">${escapeHtml(it.name)}</div>
        <div class="shopTileMeta">
          <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
          <span class="price">${onSale ? `<s>${base}</s> ${finalP}` : `${base}`}</span>
        </div>
      </button>
    `;
  }).join("");

  rootEl.innerHTML = `
    <div class="panelNote">Mask’s Gift Shop</div>
    <div class="smallNote">${saleLine}</div>
    <div class="shopGrid" style="margin-top:10px;">${gridHtml}</div>
  `;

  rootEl.querySelectorAll(".shopTile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.item;
      const item = items.find((x) => x.id === id);
      if (!item) return;
      openItemModal({ mode: "shop", item, sale });
    });
  });
}

// -------------------------
// Render Collection inside tab
// -------------------------
function renderCollectionIntoTab({ rootEl, ownedItems }) {
  if (!ownedItems.length) {
    rootEl.innerHTML = `<div class="smallNote">No Current Items</div>`;
    return;
  }

  const grid = ownedItems.map((it) => `
    <button class="invTile ${it.justBought ? "recentGlow" : ""}" data-item="${escapeHtml(it.id)}" type="button">
      <img class="invIcon" src="${toPublicUrl(it.icon)}" alt="${escapeHtml(it.name)}">
      <div class="invName">${escapeHtml(it.name)}</div>
      <div class="invMeta">
        <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
        <span class="qty">x${Number(it.qty || 1)}</span>
      </div>
    </button>
  `).join("");

  rootEl.innerHTML = `
    <div class="panelNote">Collection</div>
    <div class="invGrid" style="margin-top:10px;">${grid}</div>
  `;

  rootEl.querySelectorAll(".invTile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.item;
      const item = ownedItems.find((x) => x.id === id);
      if (!item) return;
      openItemModal({ mode: "collection", item, sale: null });
    });
  });
}

// -------------------------
// Init (runs once)
// -------------------------
export function initShopUI() {
  console.log("✅ initShopUI loaded (tab render mode)");

  const shopRoot = $("giftShopRoot");
  const colRoot = $("collectionRoot");

  if (!shopRoot || !colRoot) {
    console.warn("shop.js: Missing #giftShopRoot or #collectionRoot in HTML.");
    return;
  }

  let shopItems = [];
  let sale = { discounts: {}, label: "Loading sale...", dayKey: null };
  let unsubCollection = null;

  async function refreshShop() {
    try {
      sale = await loadSale();
      shopItems = await loadShopItemsFromFirestore();
      renderShopIntoTab({ rootEl: shopRoot, items: shopItems, sale });
    } catch (e) {
      console.error("Shop load failed:", e);
      shopRoot.innerHTML = `<div class="smallNote">Shop failed to load: ${escapeHtml(e.message || e)}</div>`;
    }
  }

  function watchCollection(uid) {
    // stop old listener
    if (unsubCollection) unsubCollection();
    unsubCollection = null;

    const colRef = collection(db, "users", uid, "collection");
    unsubCollection = onSnapshot(colRef, (snap) => {
      const owned = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.lastAcquiredAt?.seconds || 0) - (a.lastAcquiredAt?.seconds || 0));

      renderCollectionIntoTab({ rootEl: colRoot, ownedItems: owned });
    }, (err) => {
      console.error("Collection snapshot error:", err);
      colRoot.innerHTML = `<div class="smallNote">Collection failed to load.</div>`;
    });
  }

  function renderLoggedOutState() {
    shopRoot.innerHTML = `<div class="smallNote">Login required to view the shop.</div>`;
    colRoot.innerHTML = `<div class="smallNote">Login required to view your collection.</div>`;
    if (unsubCollection) unsubCollection();
    unsubCollection = null;
  }

  // initial
  if (!window.__USA_UID__) renderLoggedOutState();
  refreshShop();
  if (window.__USA_UID__) watchCollection(window.__USA_UID__);

  // if user logs in/out later (matches your existing style)
  let lastUid = window.__USA_UID__ || null;
  setInterval(() => {
    const uid = window.__USA_UID__ || null;
    if (uid === lastUid) return;
    lastUid = uid;

    if (!uid) {
      renderLoggedOutState();
      return;
    }

    refreshShop();
    watchCollection(uid);
  }, 500);
}
