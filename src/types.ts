/** Point de trace GPX (trkpt / rtept). */
export interface TrackPoint {
  lat: number;
  lon: number;
  /** Altitude en mètres, null si absente du fichier. */
  ele: number | null;
  /** Premier point d'un segment (trkseg / rte) autre que le premier : pas de liaison avec le point précédent. */
  newSegment?: true;
}

export type WaypointKind = 'water' | 'shelter' | 'camp' | 'danger' | 'viewpoint' | 'generic';

/** Point d'intérêt GPX (wpt). */
export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
  kind: WaypointKind;
}

export interface GpxData {
  name: string;
  /** Tous les segments dans l'ordre du fichier (début de segment : TrackPoint.newSegment). */
  points: TrackPoint[];
  waypoints: Waypoint[];
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface KmMarker {
  km: number;
  lat: number;
  lon: number;
}

export interface TrackStats {
  distanceKm: number;
  ascent: number;
  descent: number;
  minEle: number | null;
  maxEle: number | null;
  hasElevation: boolean;
  bounds: Bounds;
  kmMarkers: KmMarker[];
  /** Profil altimétrique échantillonné : [distance km, altitude m]. */
  profile: Array<[number, number]>;
}

export interface WalkingTime {
  /** Temps de marche effectif en minutes. */
  walkMinutes: number;
  /** Temps de pause en minutes. */
  pauseMinutes: number;
  totalMinutes: number;
  flatSpeedKmh: number;
}

export type Orientation = 'portrait' | 'landscape';

export type PrintMode = 'single' | 'poster';

/** Grille du poster : 'auto' = Mode Smart Auto. */
export type GridChoice = 'auto' | '2x2' | '2x3' | '3x2' | '3x3';

export type BaseMapId = 'opentopomap' | 'cyclosm' | 'ignplan';

/** Échelle papier visée (dénominateur), ex. 25000 pour 1:25 000. */
export type ScaleDenominator = 10000 | 25000 | 50000;

export type PaperSize = 'A4' | 'A3';

/** Une feuille calculée par le tuilage Mercator à zoom fixe. */
export interface SheetLayout {
  id: string;
  col: number;
  row: number;
  center: [number, number];
  /** Coin haut-gauche = map.unproject(topLeftPx, Z). */
  nw: [number, number];
  /** Coin bas-droit = map.unproject(bottomRightPx, Z). */
  se: [number, number];
  /** Coin haut-gauche de la carte, en pixels Web Mercator au zoom Z. */
  topLeftPx: [number, number];
}

export interface PosterLayout {
  zoom: number;
  cols: number;
  rows: number;
  canvasW: number;
  canvasH: number;
  orientation: Orientation;
  paper: PaperSize;
  /** Dimensions de la page en mm, dans l'orientation choisie. */
  pageWidthMm: number;
  pageHeightMm: number;
  /** Recouvrement entre feuilles voisines, en pixels de capture. */
  overlapPx: number;
  scale: ScaleDenominator;
  /** Mètres représentés par 1 pixel de capture au centre de la trace. */
  metersPerPixel: number;
  /** Vrai si la trace (avec marge) tient entièrement dans la grille. */
  fits: boolean;
  sheets: SheetLayout[];
  /** En mode Auto : nombre de feuilles dans l'autre orientation. */
  alternative: { orientation: Orientation; cols: number; rows: number } | null;
}

export interface LayoutRequest {
  orientation: Orientation;
  paper: PaperSize;
  cols: number;
  rows: number;
  auto: boolean;
  scale: ScaleDenominator;
}

export interface CaptureResult {
  dataUrl: string;
  missingTiles: number;
}
