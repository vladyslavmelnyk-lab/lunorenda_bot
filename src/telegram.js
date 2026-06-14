const TG_BASE = "https://api.telegram.org";

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatMessage(listing) {
  const price = `${listing.price.toLocaleString("uk-UA")} ${listing.currency}`;
  const rooms = listing.rooms ? `${listing.rooms}-кімн.` : "";
  const area = listing.area ? `${listing.area} м²` : "";
  const floor =
    listing.floor && listing.floorCount
      ? `поверх ${listing.floor}/${listing.floorCount}`
      : "";
  const owner = listing.isOwner ? "👤 власник" : "🏢 агентство/інше";
  const head = [rooms, area, floor].filter(Boolean).join(", ");

  const lines = [
    `🏠 <b>${escapeHtml(price)}</b> — ${listing.walkMinutes} хв пішки 🚶`,
    head ? escapeHtml(head) : null,
    listing.address ? `📍 ${escapeHtml(listing.address)}` : null,
    owner,
    listing.url,
  ].filter(Boolean);

  return lines.join("\n");
}

export async function sendMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("Немає TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID");
  }

  const res = await fetch(`${TG_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
}
