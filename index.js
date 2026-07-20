import { config } from "./config.js";
import { fetchListings } from "./src/lun.js";
import { resolveOffice, walkMinutes } from "./src/ors.js";
import { transitMinutes } from "./src/gmaps.js";
import { haversineKm } from "./src/geo.js";
import { loadSeen, saveSeen } from "./src/seenStore.js";
import { formatMessage, sendMessage } from "./src/telegram.js";

const DRY_RUN = Boolean(process.env.DRY_RUN);

// Пауза між надсиланнями, щоб не впертись у флуд-ліміт Telegram (~1 msg/sec у чат).
const SEND_DELAY_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Найкращий (найменший) час серед пішки/метро — для сортування.
const bestMinutes = (l) =>
  Math.min(l.walkMinutes ?? Infinity, l.transitMinutes ?? Infinity);

async function main() {
  const seen = await loadSeen();

  console.log(`Завантажую оголошення з LUN...`);
  const listings = await fetchListings();
  console.log(`Отримано ${listings.length} оголошень (з координатами).`);

  // Перший запуск (seen порожній) свідомо шле весь батч, а не мовчки сідить —
  // щоб одразу побачити всі актуальні варіанти. Далі — лише нові.
  const fresh = listings.filter((l) => !seen.has(l.id));
  console.log(`Нових (не бачених раніше): ${fresh.length}.`);

  const office = await resolveOffice();

  // --- Пішки (ORS foot-walking) ---
  // Префільтр по прямій, щоб не ганяти в ORS усе підряд.
  const walkNearby = fresh.filter(
    (l) => haversineKm(office, l.coords) <= config.prefilterRadiusKm
  );
  console.log(`Поряд по прямій (≤ ${config.prefilterRadiusKm} км): ${walkNearby.length}.`);

  const walkById = new Map();
  if (walkNearby.length > 0) {
    const minutes = await walkMinutes(office, walkNearby.map((l) => l.coords));
    walkNearby.forEach((l, i) => walkById.set(l.id, minutes[i]));
  }

  // --- Метро + ходьба (Google Maps + Playwright) ---
  // Ширший префільтр: метро накриває більшу зону, ніж 40 хв пішки.
  const transitById = new Map();
  if (config.transit.enabled) {
    const transitNearby = fresh.filter(
      (l) => haversineKm(office, l.coords) <= config.transit.prefilterRadiusKm
    );
    console.log(
      `У зоні метро по прямій (≤ ${config.transit.prefilterRadiusKm} км): ${transitNearby.length}.`
    );
    if (transitNearby.length > 0) {
      const minutes = await transitMinutes(office, transitNearby.map((l) => l.coords));
      transitNearby.forEach((l, i) => transitById.set(l.id, minutes[i]));
    }
  }

  // --- Об'єднуємо: підходить, якщо пішки ≤ maxWalkMinutes АБО метром ≤ transit.maxMinutes ---
  const matches = fresh
    .map((l) => ({
      ...l,
      walkMinutes: walkById.get(l.id) ?? null,
      transitMinutes: transitById.get(l.id) ?? null,
    }))
    .filter((l) => {
      const walkOk = l.walkMinutes != null && l.walkMinutes <= config.maxWalkMinutes;
      const transitOk =
        config.transit.enabled &&
        l.transitMinutes != null &&
        l.transitMinutes <= config.transit.maxMinutes;
      return walkOk || transitOk;
    })
    .sort((a, b) => bestMinutes(a) - bestMinutes(b));
  console.log(
    `Підходять (пішки ≤ ${config.maxWalkMinutes} хв або метром ≤ ${config.transit.maxMinutes} хв): ${matches.length}.`
  );

  for (const [i, listing] of matches.entries()) {
    const text = formatMessage(listing);
    if (DRY_RUN) {
      console.log("--- [DRY_RUN] ---\n" + text + "\n");
    } else {
      await sendMessage(text);
      const walkTag = listing.walkMinutes != null ? `${listing.walkMinutes} хв пішки` : null;
      const transitTag =
        listing.transitMinutes != null ? `${listing.transitMinutes} хв метром` : null;
      const tag = [walkTag, transitTag].filter(Boolean).join(", ");
      console.log(`Надіслано: ${listing.url} (${tag})`);
      // Пауза між повідомленнями (крім останнього), щоб не ловити 429 на батчі.
      if (i < matches.length - 1) await sleep(SEND_DELAY_MS);
    }
  }

  // Позначаємо всі отримані як бачені (зокрема й ті, що не підійшли —
  // щоб не перевіряти їх повторно щоразу).
  listings.forEach((l) => seen.add(l.id));
  if (!DRY_RUN) await saveSeen(seen);

  console.log("Готово.");
}

main().catch((err) => {
  console.error("Помилка:", err.message);
  process.exit(1);
});
