import { config } from "../config.js";

const TZ = "Europe/Kyiv";

// Наскільки TZ випереджає UTC (мс) на конкретний момент — DST-безпечно через Intl.
function tzOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asIfUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asIfUtc - utcMs;
}

// Epoch (сек) для стінного часу hh:mm у Києві на дату (рік, місяць 0-11, день).
function kyivWallToEpochSec(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m, d, hh, mm, 0);
  return Math.floor((guess - tzOffsetMs(guess)) / 1000);
}

// Наступний будній день о hh:mm за Києвом, гарантовано в майбутньому (Unix-сек).
// Щоб нічний/вихідний запуск не міряв маршрути, коли метро не їздить.
function nextWeekdayDepartureSec(hh, mm) {
  const nowMs = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const y = Number(today.find((p) => p.type === "year").value);
  const m = Number(today.find((p) => p.type === "month").value) - 1;
  const d = Number(today.find((p) => p.type === "day").value);

  for (let i = 0; i < 8; i++) {
    const base = new Date(Date.UTC(y, m, d) + i * 86400000);
    const dow = base.getUTCDay(); // 0 = нд, 6 = сб
    if (dow === 0 || dow === 6) continue;
    const sec = kyivWallToEpochSec(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm);
    if (sec * 1000 > nowMs) return sec;
  }
  return Math.floor(nowMs / 1000); // фолбек
}

// "09:30" → [9, 30].
function parseDepartAt(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value || "");
  return m ? [Number(m[1]), Number(m[2])] : [9, 30];
}

// "год" + "хв" з підпису Google → хвилини. Напр. "16 хв" → 16, "1 год 5 хв" → 65.
function parseMinutes(text) {
  if (!text) return null;
  let total = 0;
  const h = text.match(/(\d+)\s*год/);
  const m = text.match(/(\d+)\s*хв/);
  if (h) total += Number(h[1]) * 60;
  if (m) total += Number(m[1]);
  return total || null;
}

// Виконуються в контексті сторінки (серіалізуються браузеру) — без зовнішніх залежностей.
// Обраний radio режиму пересування, чий текст містить час ("16 хв", "1 год 5 хв").
function hasCheckedDuration() {
  return Array.from(document.querySelectorAll('[role="radio"]')).some(
    (r) =>
      r.getAttribute("aria-checked") === "true" &&
      /\d+\s*(год|хв)/.test(r.innerText || "")
  );
}

function readCheckedDuration() {
  const radios = Array.from(document.querySelectorAll('[role="radio"]'));
  for (const r of radios) {
    if (r.getAttribute("aria-checked") !== "true") continue;
    const t = (r.innerText || "").trim();
    if (/\d+\s*(год|хв)/.test(t)) return t;
  }
  return null;
}

// Google іноді показує cookie-згоду (частіше на IP ЄС, зокрема раннери GitHub).
// Best-effort: тиснемо будь-яку кнопку прийняття, якщо вона є. Не спрацює — підемо далі.
async function dismissConsent(page) {
  try {
    const btn = page.getByRole("button", {
      name: /(Прийняти всі|Погоджуюсь|Accept all|I agree)/i,
    });
    if (await btn.first().isVisible({ timeout: 2500 })) {
      await btn.first().click();
      await page.waitForLoadState("domcontentloaded");
    }
  } catch {
    // згоди немає або вже прийнято
  }
}

// Час "метро + ходьба" (хвилини) від кожної квартири до офісу через Google Maps.
// Скрейпимо режим transit одним браузером на всі точки. Помилка/недоступний
// маршрут → null (квартира не пройде transit-фільтр, але бот не впаде).
export async function transitMinutes(office, destinations) {
  if (destinations.length === 0) return [];

  const [officeLon, officeLat] = office;

  // Час виїзду фіксуємо на наступний будній 09:30 за Києвом (зашивається в URL
  // як Unix-timestamp !8j..., режим transit — !3e3). Час у самому маршруті
  // (тривалість) від TZ браузера не залежить.
  const [hh, mm] = parseDepartAt(config.transit.departAt);
  const departSec = nextWeekdayDepartureSec(hh, mm);

  // Динамічний імпорт: playwright потрібен тільки коли transit увімкнено.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  const results = [];
  try {
    const page = await browser.newPage();
    for (const [lon, lat] of destinations) {
      const url =
        `https://www.google.com/maps/dir/${lat},${lon}/${officeLat},${officeLon}/` +
        `data=!4m6!4m5!2m3!6e0!7e2!8j${departSec}!3e3?hl=uk`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await dismissConsent(page);
        // Ми завжди відкриваємо режим transit, тож обраний (aria-checked) radio режиму
        // показує сумарний час "метро + ходьба" (напр. "16 хв"). aria-label у headless
        // порожній, тому читаємо видимий текст обраного radio з часом.
        await page.waitForFunction(hasCheckedDuration, { timeout: 20000 });
        const text = await page.evaluate(readCheckedDuration);
        results.push(parseMinutes(text));
      } catch {
        results.push(null);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
