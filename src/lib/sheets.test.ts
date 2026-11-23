import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Bounds, LayoutRequest, PosterLayout, SheetLayout } from '../types';
import { haversineMeters } from './geo';
import { MARGIN_MM, OVERLAP_MM, PX_PER_MM, computeLayout, layoutRequest, paperSpec, project, sheetMarks, unproject } from './sheets';

// Trace d'environ 9 km × 11 km autour du Semnoz (45,75° N).
const BOUNDS: Bounds = { south: 45.7, west: 6.05, north: 45.8, east: 6.17 };
const req = (over: Partial<LayoutRequest> = {}): LayoutRequest => ({
  orientation: 'portrait',
  paper: 'A4',
  cols: 1,
  rows: 1,
  auto: true,
  scale: 25000,
  ...over,
});
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what} : ${a} ≠ ${b}`);

/** Position d'un point de page (mm) en pixels Web Mercator globaux. */
function pageMmToWorldPx(layout: PosterLayout, sheet: SheetLayout, [xMm, yMm]: [number, number]): [number, number] {
  const frameW = layout.pageWidthMm - 2 * MARGIN_MM;
  const frameH = layout.pageHeightMm - 2 * MARGIN_MM;
  return [
    sheet.topLeftPx[0] + ((xMm - MARGIN_MM) * layout.canvasW) / frameW,
    sheet.topLeftPx[1] + ((yMm - MARGIN_MM) * layout.canvasH) / frameH,
  ];
}

test('project / unproject : aller-retour exact', () => {
  for (const [lat, lon] of [
    [45.75, 6.1],
    [-33.9, 18.4],
    [69.6, 18.9],
  ]) {
    const [x, y] = project(lat, lon, 14.6);
    const [lat2, lon2] = unproject(x, y, 14.6);
    near(lat2, lat, 1e-9, 'lat');
    near(lon2, lon, 1e-9, 'lon');
  }
});

test('cadre = page moins les marges, même densité en largeur et en hauteur', () => {
  for (const paper of ['A4', 'A3'] as const) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const s = paperSpec(paper, orientation);
      assert.equal(s.frameWidthMm, s.pageWidthMm - 2 * MARGIN_MM);
      near(s.canvasW / s.frameWidthMm, s.canvasH / s.frameHeightMm, 0.01, `${paper} ${orientation} densité`);
    }
  }
  assert.deepEqual([paperSpec('A3', 'landscape').pageWidthMm, paperSpec('A3', 'landscape').pageHeightMm], [420, 297]);
});

for (const scale of [10000, 25000, 50000] as const) {
  test(`échelle 1:${scale} : 1 km sur le terrain = ${1e6 / scale} mm sur le papier, au centre de la feuille`, () => {
    const layout = computeLayout(BOUNDS, req({ scale, auto: false }));
    const [cx, cy] = project(layout.sheets[0].center[0], layout.sheets[0].center[1], layout.zoom);
    // 100 mm de papier vers l'est depuis le centre.
    const east = unproject(cx + 100 * PX_PER_MM, cy, layout.zoom);
    const meters = haversineMeters({ lat: layout.sheets[0].center[0], lon: layout.sheets[0].center[1] }, { lat: east[0], lon: east[1] });
    near(meters, (100 * scale) / 1000, (100 * scale) / 1000 * 0.002, 'distance terrain');
  });
}

test('A3 et A4 : même zoom à la même échelle (même densité)', () => {
  near(computeLayout(BOUNDS, req({ paper: 'A3' })).zoom, computeLayout(BOUNDS, req()).zoom, 1e-12, 'zoom');
});

test('feuilles voisines : exactement OVERLAP_MM de carte en commun, sur les deux axes', () => {
  for (const paper of ['A4', 'A3'] as const) {
    const layout = computeLayout(BOUNDS, req({ paper, auto: false, cols: 3, rows: 2 }));
    const at = (col: number, row: number) => layout.sheets.find((s) => s.col === col && s.row === row)!;
    const frameW = layout.pageWidthMm - 2 * MARGIN_MM;
    const frameH = layout.pageHeightMm - 2 * MARGIN_MM;
    const overlapXmm = ((at(0, 0).topLeftPx[0] + layout.canvasW - at(1, 0).topLeftPx[0]) * frameW) / layout.canvasW;
    const overlapYmm = ((at(0, 0).topLeftPx[1] + layout.canvasH - at(0, 1).topLeftPx[1]) * frameH) / layout.canvasH;
    near(overlapXmm, OVERLAP_MM, 0.01, `${paper} recouvrement horizontal`);
    near(overlapYmm, OVERLAP_MM, 0.01, `${paper} recouvrement vertical`);
    assert.deepEqual(
      layout.sheets.map((s) => s.id),
      ['A1', 'B1', 'C1', 'A2', 'B2', 'C2'],
    );
  }
});

test('mode Auto : la grille couvre toute la trace, centrée', () => {
  for (const scale of [10000, 25000, 50000] as const) {
    const layout = computeLayout(BOUNDS, req({ scale }));
    assert.ok(layout.fits, `1:${scale} doit tenir`);
    const first = layout.sheets[0];
    const last = layout.sheets[layout.sheets.length - 1];
    assert.ok(first.nw[0] >= BOUNDS.north && first.nw[1] <= BOUNDS.west, `1:${scale} coin nord-ouest`);
    assert.ok(last.se[0] <= BOUNDS.south && last.se[1] >= BOUNDS.east, `1:${scale} coin sud-est`);
  }
  assert.ok(computeLayout(BOUNDS, req({ scale: 50000 })).sheets.length < computeLayout(BOUNDS, req()).sheets.length);
  assert.ok(computeLayout(BOUNDS, req({ scale: 10000 })).sheets.length > computeLayout(BOUNDS, req()).sheets.length);
});

test('grille imposée trop petite : fits = false', () => {
  assert.equal(computeLayout(BOUNDS, req({ scale: 10000, auto: false, cols: 1, rows: 1 })).fits, false);
});

test('repères : les deux moitiés de chaque croix tombent au même point de la carte', () => {
  for (const paper of ['A4', 'A3'] as const) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const layout = computeLayout(BOUNDS, req({ paper, orientation, auto: false, cols: 2, rows: 2 }));
      const [a1, b1, a2] = layout.sheets;
      const m = (s: SheetLayout) => sheetMarks(layout, s);
      // A1 a 2 croix à droite puis 2 en bas ; B1 a 2 croix à gauche puis 2 en bas ; A2 a 2 croix en haut.
      const a1Right = m(a1).crosses.slice(0, 2).map((c) => pageMmToWorldPx(layout, a1, c));
      const b1Left = m(b1).crosses.slice(0, 2).map((c) => pageMmToWorldPx(layout, b1, c));
      const a1Bottom = m(a1).crosses.slice(2, 4).map((c) => pageMmToWorldPx(layout, a1, c));
      const a2Top = m(a2).crosses.slice(2, 4).map((c) => pageMmToWorldPx(layout, a2, c));
      for (let i = 0; i < 2; i++) {
        near(a1Right[i][0], b1Left[i][0], 1e-6, 'x droite/gauche');
        near(a1Right[i][1], b1Left[i][1], 1e-6, 'y droite/gauche');
        near(a1Bottom[i][0], a2Top[i][0], 1e-6, 'x bas/haut');
        near(a1Bottom[i][1], a2Top[i][1], 1e-6, 'y bas/haut');
      }
      // La ligne pointillée de A1 est exactement le bord gauche de la carte de B1.
      near(pageMmToWorldPx(layout, a1, [m(a1).rightEdgeMm!, MARGIN_MM])[0], b1.topLeftPx[0], 1e-6, 'bord');
      near(pageMmToWorldPx(layout, a1, [MARGIN_MM, m(a1).bottomEdgeMm!])[1], a2.topLeftPx[1], 1e-6, 'bord bas');
    }
  }
});

test('repères : aucun sur les bords extérieurs du poster, tous dans la page', () => {
  const layout = computeLayout(BOUNDS, req({ auto: false, cols: 2, rows: 2 }));
  const marks = layout.sheets.map((s) => sheetMarks(layout, s));
  assert.deepEqual(
    marks.map((mk) => mk.crosses.length),
    [4, 4, 4, 4],
  );
  assert.equal(marks[3].rightEdgeMm, null);
  assert.equal(marks[3].bottomEdgeMm, null);
  const single = computeLayout(BOUNDS, req({ auto: false }));
  assert.deepEqual(sheetMarks(single, single.sheets[0]).crosses, []);
  for (const mk of marks) {
    for (const [x, y] of mk.crosses) {
      assert.ok(x >= MARGIN_MM - 1e-9 && x <= layout.pageWidthMm - MARGIN_MM && y >= MARGIN_MM - 1e-9 && y <= layout.pageHeightMm - MARGIN_MM);
    }
  }
});

test('layoutRequest : une feuille, Auto, et grille imposée', () => {
  assert.deepEqual(layoutRequest('single', '3x3', 'portrait', 'A4', 25000), { orientation: 'portrait', paper: 'A4', cols: 1, rows: 1, auto: false, scale: 25000 });
  assert.equal(layoutRequest('poster', 'auto', 'landscape', 'A3', 10000).auto, true);
  const g = layoutRequest('poster', '3x2', 'portrait', 'A4', 50000);
  assert.deepEqual([g.cols, g.rows, g.auto], [3, 2, false]);
});
