/**
 * Free geocoding helpers backed by OpenStreetMap Nominatim
 * (same data source as the Leaflet map tiles, no API key needed).
 */

const BASE_URL = 'https://nominatim.openstreetmap.org';

const HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'en',
  // Nominatim usage policy asks for an identifying User-Agent.
  'User-Agent': 'SmartAthleteApp/1.0',
};

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Find the coordinates of a place name. Returns null if nothing matches. */
export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  try {
    const res = await fetch(
      `${BASE_URL}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
      { headers: HEADERS }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    const latitude = parseFloat(hit.lat);
    const longitude = parseFloat(hit.lon);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

/** Find a human-readable name for a coordinate. Returns null on failure. */
export async function reverseGeocode(point: GeoPoint): Promise<string | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${point.latitude}&lon=${point.longitude}`,
      { headers: HEADERS }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;

    const a = data.address ?? {};
    const name: string | undefined =
      data.name ||
      a.amenity ||
      a.leisure ||
      a.building ||
      a.road ||
      a.neighbourhood ||
      a.suburb ||
      a.village ||
      a.city;
    if (name) {
      const area = a.city || a.town || a.municipality || a.village;
      return area && area !== name ? `${name}, ${area}` : name;
    }
    const display: string | undefined = data.display_name;
    return display ? display.split(',').slice(0, 2).join(',').trim() : null;
  } catch {
    return null;
  }
}

