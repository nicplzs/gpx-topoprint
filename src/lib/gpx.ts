import type { GpxData, TrackPoint, Waypoint, WaypointKind } from '../types';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .trim();
}

function readAttr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (!m) return null;
  return m[2] ?? m[3] ?? null;
}

function readChild(body: string, tag: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i').exec(body);
  return m ? decodeXml(m[1]) : null;
}

/** Itère sur les balises <tag ...>corps</tag> ou <tag .../>. */
function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    yield { attrs: m[1] ?? '', body: m[2] ?? '' };
  }
}

/** Nombre XML strict : « 45,1 » ou « 12abc » sont refusés au lieu d'être tronqués par parseFloat. */
function toNumber(text: string | null): number {
  return text === null || text.trim() === '' ? NaN : Number(text);
}

function parsePoint(attrs: string, body: string): TrackPoint | null {
  const lat = toNumber(readAttr(attrs, 'lat'));
  const lon = toNumber(readAttr(attrs, 'lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const ele = toNumber(readChild(body, 'ele'));
  return { lat, lon, ele: Number.isFinite(ele) ? ele : null };
}

/**
 * Lit les points <tag> de chaque <container> (trkseg ou rte), dans l'ordre du fichier.
 * Le premier point de chaque segment suivant est marqué newSegment.
 */
function readSegments(xml: string, container: string, tag: string, invalid: { count: number }): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const chunk of xml.split(new RegExp(`<(?:\\w+:)?${container}\\b`, 'i'))) {
    let first = points.length > 0;
    for (const { attrs, body } of elements(chunk, tag)) {
      const p = parsePoint(attrs, body);
      if (!p) {
        invalid.count++;
        continue;
      }
      if (first) {
        p.newSegment = true;
        first = false;
      }
      points.push(p);
    }
  }
  return points;
}

const KIND_RULES: Array<[WaypointKind, RegExp]> = [
  ['water', /(?:^|\P{L})eaux?(?!\p{L})|water|source|fontaine|fountain|drinking|potable|puits|lavoir|spring/iu],
  ['camp', /bivouac|bivvy|camp|(?:^|\P{L})tentes?(?!\p{L})|(?:^|\P{L})tents?(?!\p{L})/iu],
  ['shelter', /abri|refuge|shelter|cabane|(?:^|\P{L})huts?(?!\p{L})|chalet|buron|grange|lodge/iu],
  ['danger', /danger|attention|warning|prudence|passage délicat|caution/i],
  ['viewpoint', /vue|view|panorama|belvédère|belvedere|sommet|summit|peak|croix|calvaire/i],
];

export function classifyWaypoint(...texts: Array<string | null>): WaypointKind {
  const haystack = texts.filter(Boolean).join(' ');
  for (const [kind, re] of KIND_RULES) {
    if (re.test(haystack)) return kind;
  }
  return 'generic';
}

export class GpxParseError extends Error {}

/** Analyse un fichier GPX 1.0 / 1.1 (traces, routes et waypoints). */
export function parseGpx(rawXml: string, fallbackName: string): GpxData {
  // Les commentaires XML peuvent contenir d'anciens points : on les retire avant toute lecture.
  const xml = rawXml.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<(?:\w+:)?gpx\b/i.test(xml)) {
    throw new GpxParseError("Ce fichier n'est pas un GPX valide (balise <gpx> introuvable).");
  }

  const invalid = { count: 0 };
  let points = readSegments(xml, 'trkseg', 'trkpt', invalid);
  if (points.length === 0) points = readSegments(xml, 'rte', 'rtept', invalid);

  const waypoints: Waypoint[] = [];
  for (const { attrs, body } of elements(xml, 'wpt')) {
    const p = parsePoint(attrs, body);
    if (!p) continue;
    const name = readChild(body, 'name') ?? '';
    const sym = readChild(body, 'sym');
    const type = readChild(body, 'type');
    const desc = readChild(body, 'desc') ?? readChild(body, 'cmt');
    waypoints.push({
      lat: p.lat,
      lon: p.lon,
      name: name || sym || 'Point',
      kind: classifyWaypoint(name, sym, type, desc),
    });
  }

  if (points.length < 2) {
    const hint =
      invalid.count > 0
        ? ` ${invalid.count} point(s) ignoré(s) : coordonnées illisibles ou hors limites (le séparateur doit être un point décimal, ex. 45.123).`
        : '';
    throw new GpxParseError(`Aucune trace exploitable : le GPX doit contenir au moins 2 points de trace ou de route.${hint}`);
  }

  const trkName = /<(?:\w+:)?trk\b[^>]*>([\s\S]*?)<\/(?:\w+:)?trk>/i.exec(xml);
  const metaName = /<(?:\w+:)?metadata\b[^>]*>([\s\S]*?)<\/(?:\w+:)?metadata>/i.exec(xml);
  const rteName = /<(?:\w+:)?rte\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rte>/i.exec(xml);
  const name =
    (trkName && readChild(trkName[1].split(/<(?:\w+:)?trkseg/i)[0], 'name')) ||
    (metaName && readChild(metaName[1], 'name')) ||
    (rteName && readChild(rteName[1].split(/<(?:\w+:)?rtept/i)[0], 'name')) ||
    fallbackName.replace(/\.gpx$/i, '');

  return { name, points, waypoints };
}
