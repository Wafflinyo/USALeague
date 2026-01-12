// js/shopData.js
// Add new items here (then run the seed button once)
export const SHOP_ITEMS = [
  // --- USA merch (always in shop, never discounted if you want later)
  { id: "usa-cap", name: "USA Cap", rarity: "common", basePrice: 250, icon: "assets/shop/items/usa-cap.png", desc: "Clean white cap with the USA logo.", stackable: false },
  { id: "usa-jersey", name: "USA Jersey", rarity: "uncommon", basePrice: 600, icon: "assets/shop/items/usa-jersey.png", desc: "Official league jersey.", stackable: false },
  { id: "usa-duffle", name: "USA Duffle", rarity: "rare", basePrice: 1200, icon: "assets/shop/items/usa-duffle.png", desc: "Haul your gear in style.", stackable: false },
  { id: "usa-baseball", name: "USA Baseball", rarity: "common", basePrice: 180, icon: "assets/shop/items/usa-baseball.png", desc: "Collector baseball.", stackable: true, maxStack: 10 },
  { id: "usa-bat", name: "USA Bat", rarity: "uncommon", basePrice: 700, icon: "assets/shop/items/usa-bat.png", desc: "Wood bat with league branding.", stackable: false },
  { id: "usa-helmet", name: "USA Helmet", rarity: "rare", basePrice: 1400, icon: "assets/shop/items/usa-helmet.png", desc: "Game-ready helmet.", stackable: false },

  // --- Your ready items
  { id: "ronald-figure", name: "Ronald Figure", rarity: "epic", basePrice: 2200, icon: "assets/shop/items/ronald-figure.png", desc: "A rare collectible figure.", stackable: false },
  { id: "nashville-duffle", name: "Nashville Duffle", rarity: "uncommon", basePrice: 800, icon: "assets/shop/items/nashville-duffle.png", desc: "Knights-themed duffle bag.", stackable: false },
  { id: "comet-baseball", name: "Comet Eons Baseball", rarity: "common", basePrice: 200, icon: "assets/shop/items/comet-baseball.png", desc: "Team baseball with Comet Eons style.", stackable: true, maxStack: 10 },
  { id: "narf-cap", name: "Narf Bullets Cap", rarity: "common", basePrice: 260, icon: "assets/shop/items/narf-cap.png", desc: "Cap with Narf Bullets colors.", stackable: false },
  { id: "dreary-helmet", name: "Dreary Helmet", rarity: "rare", basePrice: 1500, icon: "assets/shop/items/dreary-helmet.png", desc: "Helmet from the Dreary Lane vault.", stackable: false },
  { id: "eggbeater-bat", name: "Egg Beaters Bat", rarity: "uncommon", basePrice: 650, icon: "assets/shop/items/eggbeater-bat.png", desc: "Bat with Egg Beaters branding.", stackable: false },
];
