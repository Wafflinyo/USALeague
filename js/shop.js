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

let SHOP_ITEMS_CACHE = [];
let SALE_CACHE = { discounts: {}, label: "Loading sale..." };

let unsubscribeCollection = null;
let lastUid = null;

// ---------- helpers ----------
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

async function buySelectedItem(itemId) {
  requireUid();
  const fn = httpsCallable(getFunctions(), "buyShopItem");
  const res = await fn({ itemId });
  return res.data;
}

// ---------- shared item detail modal ----------
function openItemDetailModal(html) {
  const modal = el("itemDetailModal");
  const card = el("itemDetailCard");
  if (!modal || !card) return;

  card.innerHTML = html;
  modal.classList.remove("hidden");

  // close button
  card.querySelectorAll("[data-close-itemmodal='1']").forEach(btn => {
    btn.addEventListener("click", () => modal.classList.add("hidden"));
  });

  // backdrop closes
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  }, { once: true });
}

// ---------- render shop inline ----------
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
      <button class="shopTile" data-shop-item="${it.id}">
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

  // click item -> open detail modal with BUY
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
          <button class="ghostBtn" data-close-itemmodal="1">Close</button>
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

          <button class="primaryBtn" id="buyItemBtn">Buy</button>
          <div class="smallNote" id="buyMsg"></div>
        </div>
      `);

      // wire buy
      const buyBtn = el("buyItemBtn");
      const buyMsg = el("buyMsg");
      if (!buyBtn) return;

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
    });
  });
}

// ---------- render collection inline ----------
function renderCollectionInline(items) {
  const host = el("collectionInline");
  if (!host) return;

  if (!items || !items.length) {
    host.innerHTML = `<div class="smallNote">No Current Items</div>`;
    return;
  }

  const grid = items.map(it => `
    <button class="invTile ${it.justBought ? "recentGlow" : ""}" data-col-item="${it.id}">
      <img class="invIcon" src="${toPublicUrl(it.icon)}" alt="${it.name}">
      <div class="invName">${it.name}</div>
      <div class="invMeta">
        <span class="rarity ${it.rarity || "common"}">${rarityLabel(it.rarity)}</span>
        <span class="qty">x${it.qty || 1}</span>
      </div>
    </button>
  `).join("");

  host.innerHTML = `<div class="invGrid">${grid}</div>`;

  // click item -> open detail modal (NO BUY)
  host.querySelectorAll("[data-col-item]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-col-item");
      const it = items.find(x => x.id === id);
      if (!it) return;

      openItemDetailModal(`
        <div class="bigHeaderRow">
          <div style="font-weight:950;font-size:18px;">${it.name}</div>
          <button class="ghostBtn" data-close-itemmodal="1">Close</button>
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

  const ref = collection(db, "users", uid, "collection");
  unsubscribeCollection = onSnapshot(ref, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.lastAcquiredAt?.seconds || 0) - (a.lastAcquiredAt?.seconds || 0));

    renderCollectionInline(items);
  }, (err) => {
    console.error(err);
    const host = el("collectionInline");
    if (host) host.innerHTML = `<div class="smallNote">❌ Collection failed to load.</div>`;
  });
}

// ---------- tab helpers ----------
function isTabActive(group, tab) {
  const activeBtn = document.querySelector(`.tabBtn.active[data-tabgroup="${group}"]`);
  return activeBtn?.getAttribute("data-tab") === tab;
}

async function refreshShopIfVisible() {
  // only refresh if the tab is visible to avoid wasted reads
  if (!isTabActive("right", "giftshop")) return;
  try {
    SALE_CACHE = await loadSale();
    SHOP_ITEMS_CACHE = await loadShopItemsFromFirestore();
    renderShopInline();
  } catch (e) {
    console.error(e);
    const host = el("giftShopInline");
    if (host) host.innerHTML = `<div class="smallNote">❌ Shop failed to load.</div>`;
  }
}

// ---------- public init ----------
export function initShopUI() {
  console.log("✅ initShopUI loaded");

  // initial placeholders so you don't see "nothing"
  el("giftShopInline") && (el("giftShopInline").innerHTML = `<div class="smallNote">Shop loading...</div>`);
  el("collectionInline") && (el("collectionInline").innerHTML = `<div class="smallNote">No Current Items</div>`);

  // when user clicks the tabs, refresh the correct panel
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".tabBtn");
    if (!btn) return;

    const group = btn.getAttribute("data-tabgroup");
    const tab = btn.getAttribute("data-tab");

    if (group === "right" && tab === "giftshop") refreshShopIfVisible();
    if (group === "right" && tab === "collection") {
      // collection renders from snapshot; just ensure listener exists
      const uid = window.__USA_UID__ || null;
      if (uid) attachCollectionListener(uid);
      else el("collectionInline").innerHTML = `<div class="smallNote">Log in to view your items.</div>`;
    }
  });

  // watch uid changes (login/logout)
  setInterval(async () => {
    const uid = window.__USA_UID__ || null;

    // login changed
    if (uid && uid !== lastUid) {
      lastUid = uid;

      // attach collection listener immediately
      attachCollectionListener(uid);

      // if shop tab visible, load it
      await refreshShopIfVisible();
    }

    // logout
    if (!uid && lastUid) {
      lastUid = null;
      if (typeof unsubscribeCollection === "function") unsubscribeCollection();
      unsubscribeCollection = null;

      const col = el("collectionInline");
      if (col) col.innerHTML = `<div class="smallNote">Log in to view your items.</div>`;
    }
  }, 500);

  // if the shop tab is already active on load, pull it once
  refreshShopIfVisible();
}
