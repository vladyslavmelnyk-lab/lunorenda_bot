import { config } from "./config.js";
import { fetchListings } from "./src/lun.js";
import { resolveOffice, walkMinutes } from "./src/ors.js";
import { haversineKm } from "./src/geo.js";
import { loadSeen, saveSeen } from "./src/seenStore.js";
import { formatMessage, sendMessage } from "./src/telegram.js";

const DRY_RUN = Boolean(process.env.DRY_RUN);

async function main() {
  const seen = await loadSeen();
  const firstRun = seen.size === 0;

  console.log(`Завантажую оголошення з LUN...`);
  const listings = await fetchListings();
  console.log(`Отримано ${listings.length} оголошень (з координатами).`);

  const fresh = listings.filter((l) => !seen.has(l.id));
  console.log(`Нових (не бачених раніше): ${fresh.length}.`);

  // Перший запуск: лише запам'ятовуємо поточні, не спамимо сповіщеннями.
  if (firstRun) {
    listings.forEach((l) => seen.add(l.id));
    await saveSeen(seen);
    console.log("Перший запуск — стан ініціалізовано, сповіщення не надсилаю.");
    return;
  }

  // Префільтр по прямій, щоб не ганяти в ORS усе підряд.
  const office = await resolveOffice();
  const nearby = fresh.filter(
    (l) => haversineKm(office, l.coords) <= config.prefilterRadiusKm
  );
  console.log(`Поряд по прямій (≤ ${config.prefilterRadiusKm} км): ${nearby.length}.`);

  let matches = [];
  if (nearby.length > 0) {
    const minutes = await walkMinutes(
      office,
      nearby.map((l) => l.coords)
    );
    matches = nearby
      .map((l, i) => ({ ...l, walkMinutes: minutes[i] }))
      .filter((l) => l.walkMinutes != null && l.walkMinutes <= config.maxWalkMinutes)
      .sort((a, b) => a.walkMinutes - b.walkMinutes);
  }
  console.log(`Підходять (пішки ≤ ${config.maxWalkMinutes} хв): ${matches.length}.`);

  for (const listing of matches) {
    const text = formatMessage(listing);
    if (DRY_RUN) {
      console.log("--- [DRY_RUN] ---\n" + text + "\n");
    } else {
      await sendMessage(text);
      console.log(`Надіслано: ${listing.url} (${listing.walkMinutes} хв)`);
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
