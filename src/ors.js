import { config } from "../config.js";

const ORS_BASE = "https://api.openrouteservice.org";

function apiKey() {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("Немає ORS_API_KEY у середовищі");
  return key;
}

// Геокодимо адресу офісу в [lon, lat]. Фолбек — координати з config.
export async function resolveOffice() {
  const { office } = config;
  try {
    const url =
      `${ORS_BASE}/geocode/search?api_key=${apiKey()}` +
      `&text=${encodeURIComponent(office.address)}` +
      `&boundary.country=UA&size=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords)) return coords; // [lon, lat]
    }
  } catch {
    // мовчки падаємо у фолбек
  }
  if (office.coords) return office.coords;
  throw new Error("Не вдалося визначити координати офісу (геокодинг і фолбек порожні)");
}

// Час пішки (хвилини) від офісу до кожного з destinations ([lon,lat][]).
// Один matrix-виклик на всіх. Повертає масив хвилин (null, якщо маршруту немає).
export async function walkMinutes(office, destinations) {
  if (destinations.length === 0) return [];

  const locations = [office, ...destinations];
  const url = `${ORS_BASE}/v2/matrix/foot-walking`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations,
      sources: [0], // офіс
      destinations: destinations.map((_, i) => i + 1),
      metrics: ["duration"],
    }),
  });

  if (!res.ok) {
    throw new Error(`ORS matrix ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const seconds = data.durations?.[0] || [];
  return seconds.map((s) => (s == null ? null : Math.round(s / 60)));
}
