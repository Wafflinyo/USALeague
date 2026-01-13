// js/shop.js
import { db } from "./firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const $ = (id) => document.getElementById(id);

// -----------------------
// Helpers
// -----------------------
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
  return (r || "common").toUpperCase();
}

function priceAfterDiscount(basePrice, disc) {
  const d = Math.max(0, Math.min(Number(disc || 0), 0.25));
  return Math.max(1, Math.round(Number(basePrice || 0) * (1 - d)));
}

/**
 * Convert icon paths to a GitHub Pages-safe public URL.
 * - Keeps full https:// URLs as-is
 * - Removes leading "/" so it doesn't break /USALeague/ base path
 * - Resolves relative to site root (shop.js lives in /js/)
 */
function toPublicUrl(p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;

  const clean = String(p).replace(/^\/+/, "");
  return new URL(`../${clean}`, import.meta.url).href;
}

async function loadShopItemsFromFirestore() {
  const snap = await getDocs(collection(db, "shopItems"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadSale() {
  const saleSnap = await getDoc(doc(db, "shopMeta", "currentSale"));
  if (!saleSnap.exists()) return { discounts: {}, label: "No Sale Today" };

  const data = saleSnap.data();
  return {
    discounts: data.discounts || {},
    label: data.label || "Daily Sale",
    dayKey: data.dayKey || null
  };
}

function buySelectedItem(itemId) {
  requireUid();
  const fn = httpsCallable(getFunctions(), "buyShopItem");
  return fn({ itemId });
}

// -----------------------
// Modal (shared item details)
// -----------------------
function openItemModal(html) {
  const modal = $("itemModal");
  const card = $("itemCard");
  if (!modal || !card) return;

  card.innerHTML = html;
  modal.classList.remove("hidden");

  // backdrop close
  const onBackdrop = (e) => {
    if (e.target === modal) closeItemModal();
  };
  modal.addEventListener("click", onBackdrop, { once: true });
}

function closeItemModal() {
  $("itemModal")?.classList.add("hidden");
  if ($("itemCard")) $("itemCard").innerHTML = "";
}

// -----------------------
// Render: Shop + Collection (inline)
// -----------------------
function renderShopInline({ items, sale }) {
  const root = $("giftShopInline");
  if (!root) return;

  if (!items.length) {
    root.innerHTML = `<div class="smallNote">No shop items found.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="bigHeaderRow">
      <div>
        <div style="font-weight:950;font-size:18px;">Mask’s Gift Shop</div>
        <div class="smallNote">${escapeHtml(sale.label || "Sale")} ${sale.dayKey ? `• ${escapeHtml(sale.dayKey)}` : ""}</div>
      </div>
    </div>

    <div class="shopGrid">
      ${items.map(it => {
        const disc = sale.discounts?.[it.id] || 0;
        const base = Number(it.basePrice || 0);
        const finalP = priceAfterDiscount(base, disc);
        const onSale = disc > 0;

        return `
          <button class="shopTile" type="button" data-shop-id="${escapeHtml(it.id)}">
            <img class="shopIcon" src="${toPublicUrl(it.icon)}" alt="${escapeHtml(it.name)}">
            <div class="shopTileName">${escapeHtml(it.name)}</div>
            <div class="shopTileMeta">
              <span class="rarity ${escapeHtml(it.rarity || "common")}">${rarityLabel(it.rarity)}</span>
              <span class="price">${onSale ? `<s>${base}</s> ${finalP}` : `${base}`}</span>
            </div>
          </button>
        `;
      }).join("")}
    </div>

    <div class="smallNote" style="margin-top:10px;">
      Click an item to view details and buy.
    </div>
  `;

  // clicks -> open modal
  root.querySelectorAll("[data-shop-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-shop-id");
      const it = items.find(x => x.id === id);
      if (!it) return;

      const disc = sale.discounts?.[it.id] || 0;
      const base = Number(it.basePrice || 0);
      const finalP = priceAfterDiscount(base, disc);
      const onSale = disc > 0;
      const stack = it.stackable ? `Stackable (max ${it.maxStack || 10})` : "Not stackable";

      openItemModal(`
        <div class="bigHeaderRow">
          <div style="font-weight:950;font-size:18px;">Item Details</div>
          <button class="ghostBtn" id="itemCloseBtn" type="button">Close</button>
        </div>

        <div class="shopLayout">
          <div class="shopDetail">
            <div class="shopDetailTop">
              <img class="shopDetailIcon" src="${toPublicUrl(it.icon)}" alt="${escapeHtml(it.name)}">
              <div>
                <div class="shopDetailName">${escapeHtml(it.name)}</div>
                <div class="shopDetailTags">
                  <span class="rarity ${escapeHtml(it.rarity || "common")}">${rarityLabel(it.rarity)}</span>
                  <span class="stack">${escapeHtml(stack)}</span>
                </div>
              </div>
            </div>

            <div class="shopDetailDesc">${escapeHtml(it.desc || "")}</div>

            <div class="shopDetailPrice">
              ${onSale
                ? `<div>Price: <s>${base}</s> <b>${finalP}</b> (-${Math.round(disc * 100)}%)</div>`
                : `<div>Price: <b>${base}</b></div>`
              }
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
              <button class="primaryBtn" id="buyItemBtn" type="button">Buy</button>
              <button class="ghostBtn" id="itemCloseBtn2" type="button">Close</button>
            </div>

            <div class="smallNote" id="buyMsg"></div>
          </div>
        </div>
      `);

      // wire close
      $("itemCloseBtn")?.addEventListener("click", closeItemModal);
      $("itemCloseBtn2")?.addEventListener("click", closeItemModal);

      // wire buy
      $("buyItemBtn")?.addEventListener("click", async () => {
        const msg = $("buyMsg");
        if (msg) msg.textContent = "";

        try {
          const res = await buySelectedItem(it.id);
          // Cloud Function can return different shapes; handle common ones
          const spent = res?.data?.finalPrice ?? res?.data?.spent ?? null;
          if (msg) msg.textContent = spent != null ? `✅ Purchased! (-${spent} coins)` : `✅ Purchased!`;
        } catch (err) {
          console.error(err);
          const m = err?.message || "Purchase failed.";
          if (msg) msg.textContent = `❌ ${m}`;
        }
      });
    });
  });
}

function renderCollectionInline(ownedRows, shopItemMap) {
  const root = $("collectionInline");
  if (!root) return;

  // ownedRows are from users/{uid}/collection
  // We enrich details by looking up shopItems by id if fields are missing
  const enriched = ownedRows.map(r => {
    const shop = shopItemMap.get(r.id) || null;
    return {
      id: r.id,
      qty: r.qty ?? 1,
      lastAcquiredAt: r.lastAcquiredAt?.seconds || 0,
      // prefer user doc values, fallback to shop item
      name: r.name || shop?.name || r.id,
      icon: r.icon || shop?.icon || "",
      rarity: r.rarity || shop?.rarity || "common",
      desc: r.desc || shop?.desc || "",
      stackable: (r.stackable ?? shop?.stackable) ?? false,
      maxStack: r.maxStack || shop?.maxStack || 10,
      basePrice: r.basePrice || shop?.basePrice || 0
    };
  }).sort((a, b) => (b.lastAcquiredAt || 0) - (a.lastAcquiredAt || 0));

  root.innerHTML = `
    <div class="bigHeaderRow">
      <div>
        <div style="font-weight:950;font-size:18px;">Collection</div>
        <div class="smallNote">Only items you own appear here. Click an item for details.</div>
      </div>
    </div>

    <div class="invGrid">
      ${enriched.length ? enriched.map(it => `
        <button class="invTile" type="button" data-col-id="${escapeHtml(it.id)}">
          <img class="invIcon" src="${toPublicUrl(it.icon)}" alt="${escapeHtml(it.name)}">
          <div class="invName">${escapeHtml(it.name)}</div>
          <div class="invMeta">
            <span class="rarity ${escapeHtml(it.rarity || "common")}">${rarityLabel(it.rarity)}</span>
            <span class="qty">x${it.qty || 1}</span>
          </div>
        </button>
      `).join("") : `<div class="smallNote">No items yet. Buy something in the shop!</div>`}
    </div>
  `;

  // clicks -> open modal (no buy)
  root.querySelectorAll("[data-col-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-col-id");
      const it = enriched.find(x => x.id === id);
      if (!it) return;

      const stack = it.stackable ? `Stackable (max ${it.maxStack || 10})` : "Not stackable";

      openItemModal(`
        <div class="bigHeaderRow">
          <div style="font-weight:950;font-size:18px;">Item Details</div>
          <button class="ghostBtn" id="itemCloseBtn" type="button">Close</button>
        </div>

        <div class="shopLayout">
          <div class="shopDetail">
            <div class="shopDetailTop">
              <img class="shopDetailIcon" src="${toPublicUrl(it.icon)}" alt="${escapeHtml(it.name)}">
              <div>
                <div class="shopDetailName">${escapeHtml(it.name)}</div>
                <div class="shopDetailTags">
                  <span class="rarity ${escapeHtml(it.rarity || "common")}">${rarityLabel(it.rarity)}</span>
                  <span class="stack">${escapeHtml(stack)}</span>
                  <span class="qty">Owned: x${it.qty || 1}</span>
                </div>
              </div>
            </div>

            <div class="shopDetailDesc">${escapeHtml(it.desc || "")}</div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
              <button class="ghostBtn" id="itemCloseBtn2" type="button">Close</button>
            </div>
          </div>
        </div>
      `);

      $("itemCloseBtn")?.addEventListener("click", closeItemModal);
      $("itemCloseBtn2")?.addEventListener("click", closeItemModal);
    });
  });
}

// -----------------------
// Init
// -----------------------
export function initShopUI() {
  console.log("✅ initShopUI loaded (inline tabs + shared modal)");

  const shopRoot = $("giftShopInline");
  const colRoot = $("collectionInline");

  // If the page doesn't have these (older html), bail safely
  if (!shopRoot || !colRoot) {
    console.warn("shop.js: missing #giftShopInline or #collectionInline");
    return;
  }

  // Shared shop data cache
  let shopItems = [];
  let shopItemMap = new Map();
  let sale = { discounts: {}, label: "Loading sale..." };

  // Live owned collection rows
  let unsubCollection = null;

  async function refreshShopBlock() {
    try {
      sale = await loadSale();
      shopItems = await loadShopItemsFromFirestore();
      shopItemMap = new Map(shopItems.map(it => [it.id, it]));

      renderShopInline({ items: shopItems, sale });
    } catch (e) {
      console.error(e);
      shopRoot.innerHTML = `<div class="smallNote">Shop failed to load: ${escapeHtml(e.message)}</div>`;
    }
  }

  function startCollectionListener(uid) {
    // stop old
    if (unsubCollection) {
      unsubCollection();
      unsubCollection = null;
    }

    const colRef = collection(db, "users", uid, "collection");
    unsubCollection = onSnapshot(colRef, (snap) => {
      const owned = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCollectionInline(owned, shopItemMap);
    }, (err) => {
      console.error("Collection snapshot error:", err);
      colRoot.innerHTML = `<div class="smallNote">Could not load collection.</div>`;
    });
  }

  // Initial render (shop can load even while logged out)
  refreshShopBlock();

  // If logged in, show collection live
  const tryStart = () => {
    const uid = window.__USA_UID__ || null;
    if (!uid) {
      colRoot.innerHTML = `<div class="smallNote">Login to view your collection.</div>`;
      if (unsubCollection) { unsubCollection(); unsubCollection = null; }
      return;
    }
    startCollectionListener(uid);
  };

  // Watch login changes
  let lastUid = window.__USA_UID__ || null;
  setInterval(() => {
    const uid = window.__USA_UID__ || null;
    if (uid !== lastUid) {
      lastUid = uid;
      tryStart();
    }
  }, 500);

  // Start once
  tryStart();

  // Optional: close item modal with ESC
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeItemModal();
  });
}
