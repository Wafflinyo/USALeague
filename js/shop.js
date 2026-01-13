// js/shop.js
import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const el = (id) => document.getElementById(id);

// -----------------------------
// State
// -----------------------------
let SHOP_ITEMS_CACHE = [];
let SALE_CACHE = { discounts: {}, label: "Loading sale..." };

let unsubscribeCollection = null;
let lastUid = null;
let shopLoading = false;

// -----------------------------
// Helpers
// -----------------------------
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
  return Math.max(1, Math.round(Number(basePrice || 0) * (1 - d)));
}

/**
 * ✅ Convert icon paths to GitHub Pages-safe public URL.
 */
function toPublicUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const clean = String(p).replace(/^\/+/, "");
  return new URL(`../${clean}`, import.meta.url).href;
}

function showShopMessage(msgHtml) {
  const host = el("giftShopInline");
  if (host) host.innerHTML = msgHtml;
}

function showCollectionMessage(msgHtml) {
  const host = el("collectionInline");
  if (host) host.innerHTML = msgHtml;
}

// -----------------------------
// Firestore loads
// -----------------------------
async function loadShopItemsFromFirestore() {
  const snap = await getDocs(collection(db, "shopItems"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadSale() {
  // If you don’t have shopMeta/currentSale, this will simply show "No Sale Today"
  const saleSnap = await getDoc(doc(db, "shopMeta", "currentSale"));
  if (!saleSnap.exists()) return { discounts: {}, label: "No Sale Today", dayKey: null };

  const data = saleSnap.data();
  return {
    discounts: data.discounts || {},
    label: data.label || "Daily Sale",
    dayKey: data.dayKey || null
  };
}

async function buySelectedItem(itemId) {
  requireUid();
  const fn = httpsCallable(getFunctions(), "buyShopItem");
  const res = await fn({ itemId });
  return res.data;
}

// -----------------------------
// Shared item detail modal
// -----------------------------
function openItemDetailModal(html) {
  const modal = el("itemDetailModal");
  const card = el("itemDetailCard");
  if (!modal || !card) return;

  card.innerHTML = html;
  modal.classList.remove("hidden");

  // close buttons
  card.querySelectorAll("[data-close-itemmodal='1']").forEach(btn => {
    btn.addEventListener("click", () => modal.classList.add("hidden"));
  });

  // backdrop closes
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  }, { once: true });
}

// -----------------------------
// Render: Shop inline
// -----------------------------
function renderShopInline() {
  const host = el("giftShopInline");
  if (!host) return;

  const items = SHOP_ITEMS_CACHE || [];
  const sale = SALE_CACHE || { discounts: {}, label: "No Sale Today" };

  if (!items.length) {
    host.innerHTML = `<div class="smallNote">No shop items found.</div>`;
    return;
  }

  const grid = items.map(it => {
    const disc = sale.discounts?.[it.id] || 0;
    const base = Number(it.basePrice || 0);
    const finalP = priceAfterDiscount(base, disc);
    const onSale = disc > 0;

    return `
      <button class="shopTile" type="button" data-shop-item="${it.id}">
        <img class="shopIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
        <div class="shopTileName">${it.name}</div>
        <div class="shopTileMeta">
          <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
          <span class="price">${onSale ? `<s>${base}</s> ${finalP}` : `${base}`}</span>
        </div>
      </button>
    `;
  }).join("");

  host.innerHTML = `
    <div class="smallNote">${sale.label || "Sale"}${sale.dayKey ? ` • ${sale.dayKey}` : ""}</div>
    <div class="shopGrid">${grid}</div>
  `;

  // Click -> open detail modal with BUY button
  host.querySelectorAll("[data-shop-item]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-shop-item");
      const it = items.find(x => x.id === id);
      if (!it) return;

      const disc = sale.discounts?.[it.id] || 0;
      const base = Number(it.basePrice || 0);
      const finalP = priceAfterDiscount(base, disc);
      const onSale = disc > 0;

      openItemDetailModal(`
        <div class="bigHeaderRow">
          <div style="font-weight:950;font-size:18px;">${it.name}</div>
          <button class="ghostBtn" type="button" data-close-itemmodal="1">Close</button>
        </div>

        <div class="shopDetail">
          <div class="shopDetailTop">
            <img class="shopDetailIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
            <div>
              <div class="shopDetailName">${it.name}</div>
              <div class="shopDetailTags">
                <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
                <span class="rarity">${it.stackable ? `STACKABLE (max ${it.maxStack || 10})` : "NOT STACKABLE"}</span>
              </div>
              <div class="shopDetailPrice" style="margin-top:10px;">
                ${onSale
                  ? `Price: <s>${base}</s> <b>${finalP}</b> (-${Math.round(disc * 100)}%)`
                  : `Price: <b>${base}</b>`
                }
              </div>
            </div>
          </div>

          <div class="shopDetailDesc">${it.desc || ""}</div>

          <button class="primaryBtn" type="button" id="buyItemBtn">Buy</button>
          <div class="smallNote" id="buyMsg"></div>
        </div>
      `);

      const buyBtn = el("buyItemBtn");
      const buyMsg = el("buyMsg");

      if (buyBtn) {
        buyBtn.onclick = async () => {
          if (buyMsg) buyMsg.textContent = "";
          try {
            const res = await buySelectedItem(it.id);
            if (buyMsg) buyMsg.textContent = `✅ Purchased! (-${res.finalPrice} coins)`;
          } catch (err) {
            console.error(err);
            if (buyMsg) buyMsg.textContent = `❌ ${err?.message || "Purchase failed."}`;
          }
        };
      }
    });
  });
}

// -----------------------------
// Render: Collection inline
// -----------------------------
function renderCollectionInline(items) {
  const host = el("collectionInline");
  if (!host) return;

  if (!items || !items.length) {
    host.innerHTML = `<div class="smallNote">No Current Items</div>`;
    return;
  }

  const grid = items.map(it => `
    <button class="invTile ${it.justBought ? "recentGlow" : ""}" type="button" data-col-item="${it.id}">
      <img class="invIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
      <div class="invName">${it.name}</div>
      <div class="invMeta">
        <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
        <span class="qty">x${it.qty || 1}</span>
      </div>
    </button>
  `).join("");

  host.innerHTML = `<div class="invGrid">${grid}</div>`;

  // Click -> open detail modal (no BUY button)
  host.querySelectorAll("[data-col-item]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-col-item");
      const it = items.find(x => x.id === id);
      if (!it) return;

      openItemDetailModal(`
        <div class="bigHeaderRow">
          <div style="font-weight:950;font-size:18px;">${it.name}</div>
          <button class="ghostBtn" type="button" data-close-itemmodal="1">Close</button>
        </div>

        <div class="shopDetail">
          <div class="shopDetailTop">
            <img class="shopDetailIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
            <div>
              <div class="shopDetailName">${it.name}</div>
              <div class="shopDetailTags">
                <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
                <span class="rarity">OWNED: x${it.qty || 1}</span>
              </div>
            </div>
          </div>

          <div class="shopDetailDesc">${it.desc || ""}</div>
        </div>
      `);
    });
  });
}

function attachCollectionListener(uid) {
  if (typeof unsubscribeCollection === "function") unsubscribeCollection();

  // show a loading state immediately
  showCollectionMessage(`<div class="smallNote">Loading collection...</div>`);

  const ref = collection(db, "users", uid, "collection");
  unsubscribeCollection = onSnapshot(ref, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.lastAcquiredAt?.seconds || 0) - (a.lastAcquiredAt?.seconds || 0));

    renderCollectionInline(items);
  }, (err) => {
    console.error(err);
    showCollectionMessage(`<div class="smallNote">❌ Collection failed to load: ${err?.message || err}</div>`);
  });
}

// -----------------------------
// Tabs helpers
// -----------------------------
function isTabActive(group, tab) {
  const activeBtn = document.querySelector(`.tabBtn.active[data-tabgroup="${group}"]`);
  return activeBtn?.getAttribute("data-tab") === tab;
}

async function refreshShopNow() {
  if (shopLoading) return;
  shopLoading = true;

  showShopMessage(`<div class="smallNote">Shop loading...</div>`);

  try {
    SALE_CACHE = await loadSale();
  } catch (e) {
    console.warn("Sale load failed (ok if you don't use sales):", e);
    SALE_CACHE = { discounts: {}, label: "No Sale Today", dayKey: null };
  }

  try {
    SHOP_ITEMS_CACHE = await loadShopItemsFromFirestore();
    renderShopInline();
  } catch (e) {
    console.error(e);
    showShopMessage(`<div class="smallNote">❌ Shop failed to load: ${e?.message || e}</div>`);
  } finally {
    shopLoading = false;
  }
}

async function refreshShopIfVisible() {
  if (!isTabActive("right", "giftshop")) return;
  await refreshShopNow();
}

// -----------------------------
// Public init
// -----------------------------
export function initShopUI() {
  console.log("✅ initShopUI loaded");

  // HARD fail if your HTML is missing required roots
  if (!el("giftShopInline") || !el("collectionInline")) {
    console.warn("shop.js: Missing #giftShopInline or #collectionInline in HTML.");
    return;
  }

  // Placeholders so you never see blank
  showShopMessage(`<div class="smallNote">Click “Mask’s Gift Shop” to load items.</div>`);
  showCollectionMessage(`<div class="smallNote">No Current Items</div>`);

  // When you click tabs, load their content
  document.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.(".tabBtn");
    if (!btn) return;

    const group = btn.getAttribute("data-tabgroup");
    const tab = btn.getAttribute("data-tab");

    if (group === "right" && tab === "giftshop") {
      await refreshShopNow();
    }

    if (group === "right" && tab === "collection") {
      const uid = window.__USA_UID__ || null;
      if (!uid) {
        showCollectionMessage(`<div class="smallNote">Log in to view your items.</div>`);
        return;
      }
      attachCollectionListener(uid);
    }
  });

  // Watch uid changes (login/logout)
  setInterval(async () => {
    const uid = window.__USA_UID__ || null;

    // login changed
    if (uid && uid !== lastUid) {
      lastUid = uid;
      attachCollectionListener(uid);

      // if shop tab visible, load it
      await refreshShopIfVisible();
    }

    // logout
    if (!uid && lastUid) {
      lastUid = null;
      if (typeof unsubscribeCollection === "function") unsubscribeCollection();
      unsubscribeCollection = null;

      showCollectionMessage(`<div class="smallNote">Log in to view your items.</div>`);
    }
  }, 500);

  // If shop tab is already active, load it once
  refreshShopIfVisible();
}
