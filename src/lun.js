import { config } from "../config.js";

const BASE = "https://lun.ua/api/v2/market/realties";

// Браузерні заголовки — LUN віддає JSON і так, але з ними стабільніше.
const HEADERS = {
  accept: "application/json",
  "accept-language": "uk",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

function buildUrl(page) {
  const { lun } = config;
  const params = new URLSearchParams({
    sectionId: String(lun.sectionId),
    language: "uk",
    geoId: String(lun.geoId),
    geoDistance: `${lun.geoId}:${lun.searchRadiusMeters}`,
    currency: lun.currency,
    sort: "insert_time", // нові першими
    page: String(page),
  });
  if (lun.priceFrom) params.set("priceFrom", String(lun.priceFrom));
  if (lun.priceTo) params.set("priceTo", String(lun.priceTo));
  if (lun.roomsFrom) params.set("roomCountFrom", String(lun.roomsFrom));
  if (lun.roomsTo) params.set("roomCountTo", String(lun.roomsTo));
  return `${BASE}?${params.toString()}`;
}

function buildAddress(geoEntities = []) {
  const byType = (t) => geoEntities.find((g) => g.type === t)?.name;
  const street = byType("street");
  const house = byType("house");
  const complex = byType("residential_complex");
  const district = byType("district") || byType("microdistrict");

  // Основа: вулиця + будинок; якщо вулиці нема — ЖК + будинок.
  const base = street
    ? [street, house].filter(Boolean).join(", ")
    : [complex, house].filter(Boolean).join(", ");

  return [base, district].filter(Boolean).join(" • ") || null;
}

// Перетворюємо сиру картку LUN у компактний об'єкт, який нам потрібен далі.
function normalizeCard(card) {
  return {
    id: card.id,
    url: card.urlRaw,
    price: card.price,
    currency: card.currency,
    rooms: card.roomCount,
    area: card.areaTotal,
    floor: card.floor,
    floorCount: card.floorCount,
    insertTime: card.insertTime,
    isOwner: card.isOwner,
    // LUN віддає координати як [lon, lat]
    coords: Array.isArray(card.location) ? card.location : null,
    address: buildAddress(card.geoEntities),
  };
}

export async function fetchListings() {
  const all = [];
  for (let page = 1; page <= config.lun.pagesToFetch; page++) {
    const url = buildUrl(page);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`LUN API ${res.status} на сторінці ${page}: ${await res.text()}`);
    }
    const data = await res.json();
    const cards = data.cards || [];
    if (cards.length === 0) break;
    all.push(...cards.map(normalizeCard));
  }
  const wantCurrency = config.lun.currency.toLowerCase();
  return all.filter((c) => {
    if (!c.coords) return false; // без координат не порахуємо відстань
    // currency у запиті — лише валюта показу, тож фільтруємо тут.
    if ((c.currency || "").toLowerCase() !== wantCurrency) return false;
    if (config.lun.priceTo && c.price > config.lun.priceTo) return false;
    if (config.lun.priceFrom && c.price < config.lun.priceFrom) return false;
    return true;
  });
}
