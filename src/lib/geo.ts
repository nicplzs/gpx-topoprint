import type { Bounds, KmMarker, TrackPoint, TrackStats } from '../types';

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Seuil d'hystérésis (m) : filtre le bruit altimétrique des GPS pour un D+/D- réaliste. */
const ELEVATION_THRESHOLD_M = 5;
const MAX_PROFILE_SAMPLES = 400;

export function computeStats(points: TrackPoint[]): TrackStats {
  const bounds: Bounds = { south: 90, west: 180, north: -90, east: -180 };
  for (const p of points) {
    bounds.south = Math.min(bounds.south, p.lat);
    bounds.north = Math.max(bounds.north, p.lat);
    bounds.west = Math.min(bounds.west, p.lon);
    bounds.east = Math.max(bounds.east, p.lon);
  }

  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + (points[i].newSegment ? 0 : haversineMeters(points[i - 1], points[i])));
  }
  const totalM = cumulative[cumulative.length - 1];

  // Bornes kilométriques interpolées sur le tracé.
  const kmMarkers: KmMarker[] = [];
  let nextKm = 1;
  for (let i = 1; i < points.length; i++) {
    while (cumulative[i] >= nextKm * 1000) {
      const segLen = cumulative[i] - cumulative[i - 1];
      const t = segLen > 0 ? (nextKm * 1000 - cumulative[i - 1]) / segLen : 0;
      kmMarkers.push({
        km: nextKm,
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
        lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * t,
      });
      nextKm++;
    }
  }

  // Dénivelés avec hystérésis.
  let ascent = 0;
  let descent = 0;
  let minEle: number | null = null;
  let maxEle: number | null = null;
  let reference: number | null = null;
  const profileRaw: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].newSegment) reference = null;
    const ele = points[i].ele;
    if (ele === null) continue;
    minEle = minEle === null ? ele : Math.min(minEle, ele);
    maxEle = maxEle === null ? ele : Math.max(maxEle, ele);
    profileRaw.push([cumulative[i] / 1000, ele]);
    if (reference === null) {
      reference = ele;
    } else if (ele - reference >= ELEVATION_THRESHOLD_M) {
      ascent += ele - reference;
      reference = ele;
    } else if (reference - ele >= ELEVATION_THRESHOLD_M) {
      descent += reference - ele;
      reference = ele;
    }
  }

  const hasElevation = profileRaw.length >= 2;
  let profile = profileRaw;
  if (profileRaw.length > MAX_PROFILE_SAMPLES) {
    profile = [];
    const step = (profileRaw.length - 1) / (MAX_PROFILE_SAMPLES - 1);
    for (let i = 0; i < MAX_PROFILE_SAMPLES; i++) profile.push(profileRaw[Math.round(i * step)]);
  }

  return {
    distanceKm: totalM / 1000,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    minEle: minEle === null ? null : Math.round(minEle),
    maxEle: maxEle === null ? null : Math.round(maxEle),
    hasElevation,
    bounds,
    kmMarkers,
    profile: hasElevation ? profile : [],
  };
}

function toDms(value: number, positive: string, negative: string): string {
  const hemi = value >= 0 ? positive : negative;
  // Arrondi au dixième de seconde AVANT découpage, pour ne jamais afficher 60,0".
  const tenths = Math.round(Math.abs(value) * 36000);
  const deg = Math.floor(tenths / 36000);
  const min = Math.floor((tenths % 36000) / 600);
  const sec = (tenths % 600) / 10;
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}" ${hemi}`;
}

/** Coordonnées en degrés décimaux (WGS84) et en DMS, lisibles par les secours. */
export function formatCoords(lat: number, lon: number): { decimal: string; dms: string } {
  return {
    decimal: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    dms: `${toDms(lat, 'N', 'S')}  ${toDms(lon, 'E', 'O')}`,
  };
}

export function formatDistance(km: number): string {
  return `${km.toFixed(km < 10 ? 2 : 1).replace('.', ',')} km`;
}

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
