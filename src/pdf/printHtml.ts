import { formatCoords, formatDistance, formatDuration } from '../lib/geo';
import { pictoSvg } from '../lib/pictos';
import { MARGIN_MM, OVERLAP_MM, PAPER_MM, sheetMarks } from '../lib/sheets';
import type { BaseMapDefinition } from '../lib/tileLayers';
import type { PosterLayout, TrackPoint, TrackStats, WalkingTime, Waypoint } from '../types';

export interface PrintDocumentInput {
  title: string;
  layout: PosterLayout;
  stats: TrackStats;
  standardTime: WalkingTime;
  heavyPackTime: WalkingTime;
  start: TrackPoint;
  end: TrackPoint;
  waypoints: Waypoint[];
  baseMap: BaseMapDefinition;
  overviewDataUrl: string;
  sheetDataUrls: string[];
}

/** Taille de capture du plan d'assemblage, au ratio exact de son cadre sur la page 1. */
export function overviewCaptureSize(orientation: PosterLayout['orientation']): { width: number; height: number } {
  // Portrait : cadre 194 × 98 mm. Paysage : cadre 170 × 118 mm.
  return orientation === 'portrait' ? { width: 1400, height: 707 } : { width: 1400, height: 972 };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatScale(scale: number): string {
  return `1:${scale.toLocaleString('fr-FR').replace(/ | /g, ' ')}`;
}

const NORTH_ARROW_SVG = `<svg viewBox="0 0 40 56" xmlns="http://www.w3.org/2000/svg">
  <polygon points="20,2 32,40 20,32 8,40" fill="#1B1B1B" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="20,2 20,32 8,40" fill="#fff"/>
  <polygon points="20,2 32,40 20,32 8,40" fill="none" stroke="#1B1B1B" stroke-width="1.2" stroke-linejoin="round"/>
  <text x="20" y="54" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#1B1B1B" stroke="#fff" stroke-width="3" paint-order="stroke">N</text>
</svg>`;

const COMPASS_ROSE_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <circle cx="60" cy="60" r="44" fill="none" stroke="#2F3E2F" stroke-width="1"/>
  <circle cx="60" cy="60" r="36" fill="none" stroke="#2F3E2F" stroke-width="0.5" stroke-dasharray="2 2"/>
  <g stroke="#2F3E2F" stroke-width="0.6">
    ${Array.from({ length: 36 }, (_, i) => {
      const a = (i * 10 * Math.PI) / 180;
      const r1 = i % 9 === 0 ? 38 : 41;
      return `<line x1="${(60 + r1 * Math.sin(a)).toFixed(2)}" y1="${(60 - r1 * Math.cos(a)).toFixed(2)}" x2="${(60 + 44 * Math.sin(a)).toFixed(2)}" y2="${(60 - 44 * Math.cos(a)).toFixed(2)}"/>`;
    }).join('')}
  </g>
  <polygon points="60,60 52,52 60,14 68,52" fill="#C62828"/>
  <polygon points="60,60 52,68 60,106 68,68" fill="#2F3E2F"/>
  <polygon points="60,60 68,52 106,60 68,68" fill="#5B6B5B"/>
  <polygon points="60,60 52,52 14,60 52,68" fill="#5B6B5B"/>
  <polygon points="60,14 60,60 52,52" fill="#8E1C1C"/>
  <circle cx="60" cy="60" r="3.5" fill="#fff" stroke="#2F3E2F"/>
  <g font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="12" text-anchor="middle" fill="#1B1B1B">
    <text x="60" y="10">N</text><text x="60" y="119">S</text><text x="113" y="64">E</text><text x="7" y="64">O</text>
  </g>
</svg>`;

/** Échelle graphique en vraie grandeur papier : 1 km = 1e6 mm / dénominateur. */
function scaleBarHtml(scale: number): string {
  const kmMm = 1e6 / scale;
  // Barre de 5 à 10 cm quelle que soit l'échelle.
  const totalKm = scale <= 10000 ? 0.5 : scale <= 25000 ? 1 : 2;
  const segments = 4;
  const segKm = totalKm / segments;
  const segMm = segKm * kmMm;
  const blocks = Array.from(
    { length: segments },
    (_, i) =>
      `<div style="position:absolute;left:${(i * segMm).toFixed(2)}mm;top:0;width:${segMm.toFixed(2)}mm;height:2.2mm;background:${i % 2 === 0 ? '#1B1B1B' : '#fff'};box-sizing:border-box;border:0.25mm solid #1B1B1B"></div>`,
  ).join('');
  const labels = Array.from({ length: segments + 1 }, (_, i) => {
    const meters = Math.round(i * segKm * 1000);
    const text = i === segments ? `${String(totalKm).replace('.', ',')} km` : `${meters}`;
    return `<span style="position:absolute;left:${(i * segMm).toFixed(2)}mm;top:2.8mm;transform:translateX(-50%);font-size:6.5pt;white-space:nowrap">${text}</span>`;
  }).join('');
  return `<div class="scalebar" style="width:${(totalKm * kmMm).toFixed(2)}mm">${blocks}${labels}</div>
  <div class="scalebar-caption">${formatScale(scale)} — 1 cm = ${Math.round(scale / 100)} m · ${(kmMm / 10).toLocaleString('fr-FR')} cm = 1 km</div>`;
}

function profileSvg(stats: TrackStats, width: number, height: number): string {
  if (!stats.hasElevation || stats.profile.length < 2) {
    return `<div class="no-profile">Profil altimétrique indisponible : le GPX ne contient pas d'altitudes.</div>`;
  }
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const minE = stats.minEle ?? 0;
  const maxE = stats.maxEle ?? 1;
  const range = Math.max(50, maxE - minE);
  const lo = Math.floor((minE - range * 0.08) / 10) * 10;
  const hi = Math.ceil((maxE + range * 0.08) / 10) * 10;
  const maxD = Math.max(0.01, stats.distanceKm);
  const x = (d: number) => padL + (d / maxD) * (width - padL - padR);
  const y = (e: number) => padT + (1 - (e - lo) / (hi - lo)) * (height - padT - padB);
  const line = stats.profile.map(([d, e], i) => `${i === 0 ? 'M' : 'L'}${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
  const area = `${line} L${x(maxD).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;

  const eleStep = [10, 20, 50, 100, 200, 250, 500, 1000].find((s) => (hi - lo) / s <= 5) ?? 1000;
  const eleTicks: string[] = [];
  for (let e = Math.ceil(lo / eleStep) * eleStep; e <= hi; e += eleStep) {
    eleTicks.push(
      `<line x1="${padL}" x2="${width - padR}" y1="${y(e).toFixed(1)}" y2="${y(e).toFixed(1)}" stroke="#C9D2C4" stroke-width="0.5"/>` +
        `<text x="${padL - 3}" y="${(y(e) + 3).toFixed(1)}" text-anchor="end">${e}</text>`,
    );
  }
  const kmStep = [1, 2, 5, 10, 20, 50].find((s) => maxD / s <= 12) ?? 50;
  const kmTicks: string[] = [];
  for (let k = 0; k <= maxD + 1e-9; k += kmStep) {
    kmTicks.push(
      `<line x1="${x(k).toFixed(1)}" x2="${x(k).toFixed(1)}" y1="${padT}" y2="${height - padB}" stroke="#E1E7DD" stroke-width="0.5"/>` +
        `<text x="${x(k).toFixed(1)}" y="${height - 5}" text-anchor="middle">${k}k</text>`,
    );
  }
  return `<svg class="profile" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <g font-family="Helvetica, Arial, sans-serif" font-size="8" fill="#4A5A48">${kmTicks.join('')}${eleTicks.join('')}</g>
    <path d="${area}" fill="rgba(230,0,126,0.12)"/>
    <path d="${line}" fill="none" stroke="#E6007E" stroke-width="1.4" stroke-linejoin="round"/>
    <text x="${padL}" y="${padT - 1}" font-family="Helvetica, Arial, sans-serif" font-size="7" fill="#4A5A48">m</text>
  </svg>`;
}

function waypointListHtml(waypoints: Waypoint[]): string {
  if (waypoints.length === 0) return '';
  const items = waypoints
    .slice(0, 10)
    .map((w) => `<li><span class="wpt-glyph">${pictoSvg(w.kind, '3.2mm')}</span>${esc(w.name)}</li>`)
    .join('');
  const more = waypoints.length > 10 ? `<li class="muted">+ ${waypoints.length - 10} autres points</li>` : '';
  return `<div class="box"><h3>Points d'intérêt</h3><ul class="wpt-list">${items}${more}</ul></div>`;
}

function notesTableHtml(rows: number): string {
  const body = Array.from({ length: rows }, () => '<tr><td></td><td></td><td></td><td></td></tr>').join('');
  return `<div class="box notes"><h3>Notes et azimuts</h3>
    <table><thead><tr><th style="width:26%">De → Vers</th><th style="width:16%">Azimut (°)</th><th style="width:16%">Distance</th><th>Observations / Heure</th></tr></thead><tbody>${body}</tbody></table>
  </div>`;
}

function coverHtml(input: PrintDocumentInput): string {
  const { layout, stats, standardTime, heavyPackTime, start, end, title, baseMap } = input;
  const isLandscape = layout.orientation === 'landscape';
  const sheetCount = layout.sheets.length;
  const startC = formatCoords(start.lat, start.lon);
  const endC = formatCoords(end.lat, end.lon);
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const formatLabel =
    sheetCount === 1
      ? `Carte ${layout.paper} ${isLandscape ? 'paysage' : 'portrait'}`
      : `Carte ${layout.cols}×${layout.rows} · ${sheetCount} feuilles ${layout.paper} ${isLandscape ? 'paysage' : 'portrait'}`;
  const dash = '—';

  const statsHtml = `<div class="stats">
    <div class="stat"><b>${formatDistance(stats.distanceKm)}</b><span>Distance</span></div>
    <div class="stat"><b>${stats.hasElevation ? `${stats.ascent} m` : dash}</b><span>Dénivelé +</span></div>
    <div class="stat"><b>${stats.hasElevation ? `${stats.descent} m` : dash}</b><span>Dénivelé −</span></div>
    <div class="stat"><b>${stats.hasElevation ? `${stats.minEle} / ${stats.maxEle} m` : dash}</b><span>Alt. min / max</span></div>
    <div class="stat"><b>${formatDuration(standardTime.totalMinutes)}</b><span>Marche DIN 33466 (4 km/h)</span></div>
    <div class="stat"><b>${formatDuration(heavyPackTime.totalMinutes)}</b><span>Sac lourd (3,2 km/h + pauses)</span></div>
  </div>`;

  const overviewHtml = `<div class="overview">
    <img src="${input.overviewDataUrl}" alt="Plan d'assemblage"/>
    <div class="overview-title">${sheetCount > 1 ? "Plan d'assemblage" : 'Vue d’ensemble'}</div>
    <div class="overview-north">${NORTH_ARROW_SVG}</div>
  </div>`;

  const safetyHtml = `<div class="safety">
    <div class="safety-head">Sécurité et urgences</div>
    <div class="numbers">
      <div><b>112</b><span>Urgence européen</span></div>
      <div><b>114</b><span>SMS (sourds, ou si parler est impossible)</span></div>
      <div><b>15</b><span>SAMU</span></div>
      <div><b>18</b><span>Pompiers / secours montagne</span></div>
    </div>
    <div class="coords">
      <div><b class="dot green">D</b> Départ : ${startC.decimal} <span class="muted">(${startC.dms})</span></div>
      <div><b class="dot red">A</b> Arrivée : ${endC.decimal} <span class="muted">(${endC.dms})</span></div>
      <div class="muted small">Coordonnées WGS84. Communiquez-les aux secours avec la borne km la plus proche.</div>
    </div>
  </div>`;

  const legendHtml = `<div class="box legend">
    <h3>Légende et orientation</h3>
    <div class="legend-grid">
      <div class="rose">${COMPASS_ROSE_SVG}</div>
      <div class="legend-items">
        <div><i class="lg-track"></i> Itinéraire GPX (sens : chevrons)</div>
        <div><i class="lg-km">1k</i> Borne kilométrique</div>
        <div><i class="lg-dot green">D</i> Départ <i class="lg-dot red">A</i> Arrivée</div>
        <div><i class="lg-grid"></i> Carroyage 1 km (Nord en haut)</div>
        ${sheetCount > 1 ? `<div><i class="lg-cut"></i> Bord de la voisine (${OVERLAP_MM / 10} cm)</div>` : ''}
        <div class="scale-wrap">${scaleBarHtml(layout.scale)}</div>
      </div>
    </div>
  </div>`;

  const assemblyHtml =
    sheetCount > 1
      ? `<div class="assembly"><b>Assemblage.</b> Sur chaque feuille sauf la colonne A, coupez la marge blanche de gauche le long du cadre ; sauf la ligne 1, coupez aussi celle du haut. Posez la feuille sur sa voisine de gauche (ou du haut) : son bord suit la ligne pointillée et les demi-croix se rejoignent. Collez de A1 à ${layout.sheets[layout.cols - 1].id}, puis ligne par ligne. Imprimez à <b>100 % / taille réelle</b> (sans « Ajuster à la page ») pour conserver l'échelle ${formatScale(layout.scale)}.</div>`
      : `<div class="assembly">Imprimez à <b>100 % / taille réelle</b> (sans « Ajuster à la page ») pour conserver l'échelle ${formatScale(layout.scale)}.</div>`;

  const header = `<div class="header">
    <div class="header-left">
      <div class="brand">GPX TopoPrint</div>
      <h1>${esc(title)}</h1>
      <div class="sub">${formatLabel} · Échelle ${formatScale(layout.scale)} · ${esc(baseMap.label)} · ${dateStr}</div>
    </div>
  </div>`;

  // La page de garde est mise en page pour l'A4 ; en A3, elle est agrandie d'un bloc (zoom √2).
  const coverStyle = `width:${isLandscape ? 297 : 210}mm;height:${isLandscape ? 210 : 297}mm;zoom:${PAPER_MM[layout.paper].w / PAPER_MM.A4.w}`;
  if (!isLandscape) {
    return `<section class="page cover portrait" style="${coverStyle}">
      ${header}
      ${statsHtml}
      ${overviewHtml}
      <div class="profile-box"><h3>Profil altimétrique</h3>${profileSvg(stats, 700, 120)}</div>
      ${safetyHtml}
      <div class="row2">
        <div class="col">${legendHtml}${waypointListHtml(input.waypoints)}</div>
        <div class="col">${notesTableHtml(7)}</div>
      </div>
      ${assemblyHtml}
      <div class="attrib">Fond : ${esc(baseMap.attribution)}</div>
    </section>`;
  }

  return `<section class="page cover landscape" style="${coverStyle}">
    ${header}
    <div class="land-grid">
      <div class="land-left">
        ${overviewHtml}
        <div class="profile-box"><h3>Profil altimétrique</h3>${profileSvg(stats, 640, 110)}</div>
        ${assemblyHtml}
      </div>
      <div class="land-right">
        ${statsHtml}
        ${safetyHtml}
        <div class="row2">
          <div class="col">${legendHtml}</div>
          <div class="col">${notesTableHtml(5)}</div>
        </div>
      </div>
    </div>
    <div class="attrib">Fond : ${esc(baseMap.attribution)}</div>
  </section>`;
}

const CROSS_SVG = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="2.2" fill="none" stroke="#000" stroke-width="0.35"/><path d="M0 5h10M5 0v10" stroke="#000" stroke-width="0.35"/></svg>`;

function sheetHtml(input: PrintDocumentInput, index: number, isLast: boolean): string {
  const { layout, baseMap } = input;
  const sheet = layout.sheets[index];
  const marks = sheetMarks(layout, sheet);
  const right = layout.sheets.find((s) => s.row === sheet.row && s.col === sheet.col + 1);
  const below = layout.sheets.find((s) => s.col === sheet.col && s.row === sheet.row + 1);
  const neighbours = [right ? `${right.id} à droite` : '', below ? `${below.id} en dessous` : ''].filter(Boolean).join(', ');
  const edges =
    (marks.rightEdgeMm !== null ? `<div class="edge edge-v" style="left:${marks.rightEdgeMm.toFixed(3)}mm"></div>` : '') +
    (marks.bottomEdgeMm !== null ? `<div class="edge edge-h" style="top:${marks.bottomEdgeMm.toFixed(3)}mm"></div>` : '');
  const crosses = marks.crosses
    .map(([x, y]) => `<div class="cross" style="left:${(x - 3).toFixed(3)}mm;top:${(y - 3).toFixed(3)}mm">${CROSS_SVG}</div>`)
    .join('');
  return `<section class="page sheet${isLast ? ' last' : ''}">
    <img class="sheet-img" src="${input.sheetDataUrls[index]}" alt="${sheet.id}"/>
    <div class="frame"></div>
    ${edges}${crosses}
    <div class="north">${NORTH_ARROW_SVG}</div>
    <div class="sheet-foot"><b>${sheet.id}</b> · ${formatScale(layout.scale)}${neighbours ? ` · voisines : ${neighbours}` : ''}</div>
    <div class="sheet-attrib">${esc(baseMap.attribution)}</div>
  </section>`;
}

/** Document HTML imprimable complet : page de garde + feuilles de carte. */
export function buildPrintHtml(input: PrintDocumentInput): string {
  const { layout } = input;
  const pageW = `${layout.pageWidthMm}mm`;
  const pageH = `${layout.pageHeightMm}mm`;
  const sheets = input.layout.sheets.map((_, i) => sheetHtml(input, i, i === input.layout.sheets.length - 1)).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>${esc(input.title)}</title>
<style>
  @page {
    size: ${layout.paper} ${layout.orientation};
    margin: 0;
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif; color: #1B241B; font-size: 8.5pt; }
  .page { width: ${pageW}; height: ${pageH}; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
  .page.last { page-break-after: auto; break-after: auto; }

  /* ---------- Feuilles de carte : cadre entouré d'une marge blanche de ${MARGIN_MM} mm ---------- */
  .sheet { margin: 0; padding: 0; }
  .sheet-img, .frame { position: absolute; left: ${MARGIN_MM}mm; top: ${MARGIN_MM}mm;
           width: calc(100% - ${2 * MARGIN_MM}mm); height: calc(100% - ${2 * MARGIN_MM}mm); margin: 0; display: block; }
  .frame { border: 0.2mm solid #000; }
  .edge { position: absolute; }
  .edge-v { top: ${MARGIN_MM}mm; bottom: ${MARGIN_MM}mm; width: 0; border-left: 0.3mm dashed #000; }
  .edge-h { left: ${MARGIN_MM}mm; right: ${MARGIN_MM}mm; height: 0; border-top: 0.3mm dashed #000; }
  .cross { position: absolute; width: 6mm; height: 6mm; }
  .cross svg { width: 100%; height: 100%; display: block; }
  .north { position: absolute; top: ${MARGIN_MM + 3}mm; left: ${MARGIN_MM + 3}mm; width: 7mm; height: 10mm; }
  .north svg, .overview-north svg { width: 100%; height: 100%; }
  .sheet-foot { position: absolute; left: ${MARGIN_MM}mm; bottom: 1.6mm; font-size: 7pt; color: #1B1B1B; }
  .sheet-attrib { position: absolute; right: ${MARGIN_MM}mm; bottom: 1.6mm; font-size: 5pt; color: #555; }

  /* ---------- Page de garde ---------- */
  .cover { padding: 9mm 8mm 7mm; display: flex; flex-direction: column; gap: 2.6mm; }
  .header { border-bottom: 0.3mm solid #1B1B1B; padding: 0 0 2.4mm; }
  .brand { font-size: 7pt; color: #6B6B6B; }
  h1 { margin: 0.8mm 0; font-size: 17pt; line-height: 1.1; font-weight: 600; }
  .sub { font-size: 7.5pt; color: #4A4A4A; }
  h3 { margin: 0 0 1.4mm; font-size: 8.5pt; font-weight: 600; color: #1B1B1B; }
  .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1.6mm; }
  .landscape .stats { grid-template-columns: repeat(3, 1fr); }
  .stat { border: 0.25mm solid #D4D4D4; border-radius: 1.6mm; padding: 1.8mm 1.5mm; }
  .stat b { display: block; font-size: 11pt; font-weight: 600; color: #1B1B1B; font-variant-numeric: tabular-nums; }
  .stat span { display: block; font-size: 6.2pt; color: #555; margin-top: 0.5mm; }
  .overview { position: relative; border: 0.3mm solid #1B1B1B; border-radius: 1.6mm; overflow: hidden; }
  .portrait .overview { height: 98mm; }
  .landscape .overview { height: 118mm; }
  .overview img { width: 100%; height: 100%; display: block; }
  .overview-title { position: absolute; left: 2mm; top: 2mm; background: rgba(255,255,255,0.9); color: #1B1B1B;
                    font-weight: 600; font-size: 7.5pt; padding: 0.8mm 2mm; border-radius: 1mm; }
  .overview-north { position: absolute; right: 2.5mm; top: 2mm; width: 6mm; height: 8.5mm; }
  .profile-box { border: 0.3mm solid #C9D2C4; border-radius: 1.6mm; padding: 1.8mm 2mm 1mm; }
  .profile { width: 100%; height: 24mm; display: block; }
  .landscape .profile { height: 22mm; }
  .no-profile { font-style: italic; color: #6A7A68; padding: 3mm 0; }
  .safety { border: 0.6mm solid #C62828; border-radius: 1.6mm; padding: 1.8mm 2.5mm; background: #FFF6F5; }
  .safety-head { font-weight: 600; color: #C62828; font-size: 8.5pt; margin-bottom: 1.2mm; }
  .numbers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5mm; margin-bottom: 1.4mm; }
  .numbers div { display: flex; align-items: center; gap: 1.5mm; }
  .numbers b { font-size: 14pt; color: #C62828; }
  .numbers span { font-size: 6.4pt; line-height: 1.15; }
  .coords div { margin-top: 0.5mm; }
  .dot { display: inline-block; width: 4mm; height: 4mm; line-height: 4mm; border-radius: 50%; color: #fff; text-align: center; font-size: 6.5pt; }
  .green { background: #2E7D32; }
  .red { background: #C62828; }
  .muted { color: #6A7A68; }
  .small { font-size: 6.5pt; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2.4mm; flex: 1; min-height: 0; overflow: hidden; }
  .landscape .row2 { grid-template-columns: 1fr; }
  .col { display: flex; flex-direction: column; gap: 2.4mm; min-height: 0; }
  .box { border: 0.3mm solid #C9D2C4; border-radius: 1.6mm; padding: 1.8mm 2mm; }
  .legend-grid { display: flex; gap: 2mm; align-items: center; }
  .rose { width: 24mm; height: 24mm; flex: none; }
  .rose svg { width: 100%; height: 100%; }
  .legend-items div { margin: 0.7mm 0; display: flex; align-items: center; gap: 1.2mm; }
  .legend-items i { font-style: normal; flex: none; }
  .lg-track { width: 7mm; height: 1.3mm; background: #E6007E; border: 0.3mm solid #fff; outline: 0.2mm solid #ccc; }
  .lg-km { font-size: 6pt; font-weight: 700; color: #5A0033; border: 0.4mm solid #E6007E; border-radius: 2mm; padding: 0 1mm; }
  .lg-dot { width: 3.6mm; height: 3.6mm; line-height: 3.6mm; border-radius: 50%; color: #fff; text-align: center; font-size: 6pt; font-weight: 700; }
  .lg-grid { width: 7mm; height: 4mm; border: 0.25mm solid rgba(21,101,192,0.6);
             background: linear-gradient(90deg, transparent 48%, rgba(21,101,192,0.6) 48%, rgba(21,101,192,0.6) 52%, transparent 52%); }
  .lg-cut { width: 7mm; border-top: 0.3mm dashed #000; }
  .scale-wrap { display: block !important; margin-top: 1.6mm !important; }
  .scalebar { position: relative; height: 6.5mm; margin-left: 1mm; }
  .scalebar-caption { font-size: 6.2pt; color: #4A5A48; }
  .wpt-list { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 2mm; font-size: 7pt; }
  .wpt-list li { margin: 0.4mm 0; break-inside: avoid; }
  .wpt-glyph { display: inline-block; width: 4mm; vertical-align: -0.6mm; }
  .notes { flex: 1; display: flex; flex-direction: column; }
  .notes table { width: 100%; border-collapse: collapse; flex: 1; }
  .notes th { font-size: 6.4pt; text-align: left; color: #4A5A48; border-bottom: 0.4mm solid #2D5A3D; padding: 0.6mm 1mm; }
  .notes td { border-bottom: 0.2mm solid #B8C4B2; border-right: 0.2mm dotted #C9D2C4; height: 6.5mm; }
  .notes td:last-child { border-right: none; }
  .assembly { font-size: 6.8pt; color: #333; border: 0.25mm solid #D4D4D4; border-radius: 1.4mm; padding: 1.4mm 2mm; }
  .attrib { position: absolute; bottom: 2.5mm; right: 8mm; font-size: 5pt; color: #7A8A78; }
  .land-grid { display: grid; grid-template-columns: 170mm 1fr; gap: 3mm; flex: 1; min-height: 0; }
  .land-left, .land-right { display: flex; flex-direction: column; gap: 2.4mm; min-height: 0; }
  .landscape .numbers { grid-template-columns: repeat(2, 1fr); }
</style>
</head>
<body>
${coverHtml(input)}
${sheets}
</body>
</html>`;
}
