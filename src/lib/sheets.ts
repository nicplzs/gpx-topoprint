import type {
  Bounds,
  GridChoice,
  LayoutRequest,
  Orientation,
  PaperSize,
  PosterLayout,
  PrintMode,
  ScaleDenominator,
  SheetLayout,
} from '../types';

/** Formats papier en mm, en portrait. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};
/** Marge blanche autour de la carte : hors de la zone non imprimable des imprimantes, et sert de bord de découpe. */
export const MARGIN_MM = 6;
/** Bande de carte commune à deux feuilles voisines, pour le collage. */
export const OVERLAP_MM = 10;
/** Densité des captures : 1131 px pour 210 mm (environ 137 dpi, doublée à la capture). */
export const PX_PER_MM = 1131 / 210;

/** Marge autour de la trace en mode Auto, en pixels de capture. */
const TRACK_MARGIN_PX = 60;
const TILE_SIZE = 256;
/** Sphère Web Mercator (EPSG:3857), la même que Leaflet. */
const EARTH_RADIUS_M = 6378137;
const MAX_LATITUDE = 85.0511287798;

/** Pixel Web Mercator [x, y] d'un point au zoom donné (identique à map.project de Leaflet). */
export function project(lat: number, lon: number, zoom: number): [number, number] {
  const size = TILE_SIZE * 2 ** zoom;
  const phi = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / 180;
  return [(size * (lon + 180)) / 360, size * (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI))];
}

/** Inverse de project : [lat, lon]. */
export function unproject(x: number, y: number, zoom: number): [number, number] {
  const size = TILE_SIZE * 2 ** zoom;
  const lat = ((2 * Math.atan(Math.exp((0.5 - y / size) * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI;
  return [lat, (x / size) * 360 - 180];
}

export interface PaperSpec {
  pageWidthMm: number;
  pageHeightMm: number;
  /** Cadre de carte = page moins les marges. */
  frameWidthMm: number;
  frameHeightMm: number;
  canvasW: number;
  canvasH: number;
  overlapPx: number;
}

export function paperSpec(paper: PaperSize, orientation: Orientation): PaperSpec {
  const p = PAPER_MM[paper];
  const [pageWidthMm, pageHeightMm] = orientation === 'portrait' ? [p.w, p.h] : [p.h, p.w];
  const frameWidthMm = pageWidthMm - 2 * MARGIN_MM;
  const frameHeightMm = pageHeightMm - 2 * MARGIN_MM;
  return {
    pageWidthMm,
    pageHeightMm,
    frameWidthMm,
    frameHeightMm,
    canvasW: Math.round(frameWidthMm * PX_PER_MM),
    canvasH: Math.round(frameHeightMm * PX_PER_MM),
    overlapPx: OVERLAP_MM * PX_PER_MM,
  };
}

/** Nombre de feuilles pour couvrir `need` pixels avec un pas de `step`. */
function gridCount(need: number, canvas: number, step: number): number {
  return need <= canvas ? 1 : Math.ceil((need - canvas) / step) + 1;
}

function sheetId(col: number, row: number): string {
  let letters = '';
  let n = col;
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${letters}${row + 1}`;
}

/**
 * Tuilage Web Mercator à zoom fixe : toutes les feuilles ont la même échelle,
 * deux voisines partagent exactement OVERLAP_MM de carte.
 */
export function computeLayout(b: Bounds, req: LayoutRequest): PosterLayout {
  const spec = paperSpec(req.paper, req.orientation);
  // 1 px de capture = 1/PX_PER_MM mm de papier = scale/PX_PER_MM mm de terrain.
  const metersPerPixel = req.scale / (PX_PER_MM * 1000);

  // Latitude du centre Mercator de la trace (milieu de la boîte projetée, pas des degrés).
  const nw0 = project(b.north, b.west, 0);
  const se0 = project(b.south, b.east, 0);
  const centerLat = unproject((nw0[0] + se0[0]) / 2, (nw0[1] + se0[1]) / 2, 0)[0];
  const zoom = Math.log2((2 * Math.PI * EARTH_RADIUS_M * Math.cos((centerLat * Math.PI) / 180)) / (TILE_SIZE * metersPerPixel));

  const nw = project(b.north, b.west, zoom);
  const se = project(b.south, b.east, zoom);
  const bboxW = se[0] - nw[0];
  const bboxH = se[1] - nw[1];
  const stepX = spec.canvasW - spec.overlapPx;
  const stepY = spec.canvasH - spec.overlapPx;

  let { cols, rows } = req;
  let alternative: PosterLayout['alternative'] = null;
  if (req.auto) {
    cols = gridCount(bboxW + 2 * TRACK_MARGIN_PX, spec.canvasW, stepX);
    rows = gridCount(bboxH + 2 * TRACK_MARGIN_PX, spec.canvasH, stepY);
    const otherOrientation: Orientation = req.orientation === 'portrait' ? 'landscape' : 'portrait';
    const o = paperSpec(req.paper, otherOrientation);
    alternative = {
      orientation: otherOrientation,
      cols: gridCount(bboxW + 2 * TRACK_MARGIN_PX, o.canvasW, o.canvasW - o.overlapPx),
      rows: gridCount(bboxH + 2 * TRACK_MARGIN_PX, o.canvasH, o.canvasH - o.overlapPx),
    };
  }

  // Grille centrée sur la trace : on centre l'emprise réellement imprimée.
  const coveredW = (cols - 1) * stepX + spec.canvasW;
  const coveredH = (rows - 1) * stepY + spec.canvasH;
  const originX = (nw[0] + se[0]) / 2 - coveredW / 2;
  const originY = (nw[1] + se[1]) / 2 - coveredH / 2;

  const sheets: SheetLayout[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = originX + col * stepX;
      const y = originY + row * stepY;
      sheets.push({
        id: sheetId(col, row),
        col,
        row,
        center: unproject(x + spec.canvasW / 2, y + spec.canvasH / 2, zoom),
        nw: unproject(x, y, zoom),
        se: unproject(x + spec.canvasW, y + spec.canvasH, zoom),
        topLeftPx: [x, y],
      });
    }
  }

  return {
    zoom,
    cols,
    rows,
    canvasW: spec.canvasW,
    canvasH: spec.canvasH,
    orientation: req.orientation,
    paper: req.paper,
    pageWidthMm: spec.pageWidthMm,
    pageHeightMm: spec.pageHeightMm,
    overlapPx: spec.overlapPx,
    scale: req.scale,
    metersPerPixel,
    fits: coveredW >= bboxW && coveredH >= bboxH,
    sheets,
    alternative,
  };
}

export interface SheetMarks {
  /** Lignes pointillées où vient le bord de la feuille voisine (mm depuis le bord de la page). */
  rightEdgeMm: number | null;
  bottomEdgeMm: number | null;
  /** Centres des croix de repérage, en mm depuis le coin haut-gauche de la page. */
  crosses: Array<[number, number]>;
}

/**
 * Repères d'assemblage d'une feuille. Calculés en pixels de capture puis
 * convertis en mm avec le rapport réel image/cadre : une croix posée au même
 * endroit de la carte tombe ainsi exactement au même endroit sur les deux feuilles.
 */
export function sheetMarks(layout: PosterLayout, sheet: SheetLayout): SheetMarks {
  const frameW = layout.pageWidthMm - 2 * MARGIN_MM;
  const frameH = layout.pageHeightMm - 2 * MARGIN_MM;
  const mmX = (px: number) => MARGIN_MM + (px * frameW) / layout.canvasW;
  const mmY = (px: number) => MARGIN_MM + (px * frameH) / layout.canvasH;
  const edgeX = layout.canvasW - layout.overlapPx;
  const edgeY = layout.canvasH - layout.overlapPx;
  const thirdsX = [layout.canvasW / 3, (2 * layout.canvasW) / 3];
  const thirdsY = [layout.canvasH / 3, (2 * layout.canvasH) / 3];
  const crosses: Array<[number, number]> = [];
  const hasRight = sheet.col < layout.cols - 1;
  const hasBottom = sheet.row < layout.rows - 1;
  // Une croix coupée en deux par le bord de la feuille du dessus : les deux moitiés se rejoignent une fois collées.
  if (hasRight) thirdsY.forEach((y) => crosses.push([mmX(edgeX), mmY(y)]));
  if (sheet.col > 0) thirdsY.forEach((y) => crosses.push([mmX(0), mmY(y)]));
  if (hasBottom) thirdsX.forEach((x) => crosses.push([mmX(x), mmY(edgeY)]));
  if (sheet.row > 0) thirdsX.forEach((x) => crosses.push([mmX(x), mmY(0)]));
  return {
    rightEdgeMm: hasRight ? mmX(edgeX) : null,
    bottomEdgeMm: hasBottom ? mmY(edgeY) : null,
    crosses,
  };
}

/** Réglages de l'écran → demande de tuilage. « Auto » laisse computeLayout choisir la grille. */
export function layoutRequest(
  mode: PrintMode,
  grid: GridChoice,
  orientation: Orientation,
  paper: PaperSize,
  scale: ScaleDenominator,
): LayoutRequest {
  if (mode === 'single') return { orientation, paper, cols: 1, rows: 1, auto: false, scale };
  if (grid === 'auto') return { orientation, paper, cols: 1, rows: 1, auto: true, scale };
  const [cols, rows] = grid.split('x').map((n) => parseInt(n, 10));
  return { orientation, paper, cols, rows, auto: false, scale };
}
