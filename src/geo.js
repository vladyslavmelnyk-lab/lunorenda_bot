// Відстань по прямій між двома точками [lon, lat] у кілометрах (haversine).
// Використовується як дешевий префільтр перед платними викликами ORS.

const R = 6371; // радіус Землі, км

const toRad = (deg) => (deg * Math.PI) / 180;

export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
