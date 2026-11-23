import { computeStats, formatDistance, formatDuration } from '../src/lib/geo';
import { GpxParseError, parseGpx } from '../src/lib/gpx';
import { computeLayout, layoutRequest } from '../src/lib/sheets';
import { BASE_MAPS, BASE_MAP_ORDER } from '../src/lib/tileLayers';
import { computeWalkingTime } from '../src/lib/walkingTime';
import { ENGINE_SCRIPT } from '../src/map/engineScript';
import demoGpx from '../samples/exemple-randonnee.gpx';
import { htmlToPdf } from './pdfFile';
import { setupPwa } from './pwa';
import { buildPrintHtml, overviewCaptureSize } from '../src/pdf/printHtml';
import type {
  BaseMapId,
  CaptureResult,
  GpxData,
  GridChoice,
  Orientation,
  PaperSize,
  PosterLayout,
  PrintMode,
  ScaleDenominator,
  TrackStats,
} from '../src/types';

// ---------------------------------------------------------------- Utilitaires

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MAX_GPX_BYTES = 50 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60000;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const orientationLabel = (o: Orientation) => (o === 'portrait' ? 'portrait' : 'paysage');

// ------------------------------------------------- Pont vers le moteur Leaflet
// Le moteur est le même script que celui de l'application mobile : il parle à
// window.ReactNativeWebView.postMessage et reçoit ses ordres par TopoEngine.receive.

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
const pending = new Map<number, Pending>();
let nextId = 1;
let onFatal: (message: string) => void = () => undefined;
let engineReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => (engineReady = resolve));

interface EngineWindow extends Window {
  ReactNativeWebView?: { postMessage(raw: string): void };
  TopoEngine?: { receive(message: unknown): void };
}
const win = window as EngineWindow;

win.ReactNativeWebView = {
  postMessage(raw) {
    const m = JSON.parse(raw) as { type: string; id?: number; result?: unknown; message?: string };
    if (m.type === 'ready') return engineReady();
    if (m.id === undefined) return onFatal(m.message ?? 'Erreur de la carte');
    const entry = pending.get(m.id);
    if (!entry) return;
    pending.delete(m.id);
    if (m.type === 'result') entry.resolve(m.result);
    else entry.reject(new Error(m.message));
  },
};

function send<T = void>(message: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('La carte ne répond pas (délai dépassé). Vérifiez votre connexion.'));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v as T)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    win.TopoEngine!.receive({ ...message, id });
  });
}

// ----------------------------------------------------------------------- État

interface State {
  gpx: GpxData | null;
  fileName: string;
  stats: TrackStats | null;
  title: string;
  baseMap: BaseMapId;
  mode: PrintMode;
  grid: GridChoice;
  orientation: Orientation;
  paper: PaperSize;
  scale: ScaleDenominator;
  heavyPack: boolean;
  layout: PosterLayout | null;
  busy: boolean;
  printHtml: string | null;
}
const state: State = {
  gpx: null,
  fileName: '',
  stats: null,
  title: '',
  baseMap: 'opentopomap',
  mode: 'poster',
  grid: 'auto',
  orientation: 'portrait',
  paper: 'A4',
  scale: 25000,
  heavyPack: false,
  layout: null,
  busy: false,
  printHtml: null,
};

// ------------------------------------------------------------------- Messages

function notify(message: string, tone: 'info' | 'warn' = 'warn', action?: { label: string; run: () => void }) {
  const box = $('notices');
  const div = document.createElement('div');
  div.className = `notice ${tone}`;
  const text = document.createElement('p');
  text.textContent = message;
  div.append(text);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = action.run;
    div.append(b);
  }
  box.replaceChildren(div);
}
const clearNotice = () => $('notices').replaceChildren();

// --------------------------------------------------------------------- Rendu

function setPressed(group: HTMLElement, value: string) {
  group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === value)));
}

function render() {
  const { gpx, stats, layout } = state;
  document.querySelectorAll<HTMLElement>('[data-key]').forEach((g) => setPressed(g, String(state[g.dataset.key as keyof State])));
  $('gridField').hidden = state.mode !== 'poster';
  $('route').hidden = !gpx;
  $('empty').hidden = !!gpx;
  $('recenter').hidden = !gpx;
  $<HTMLInputElement>('pack').checked = state.heavyPack;

  if (gpx && stats) {
    const std = computeWalkingTime({ distanceKm: stats.distanceKm, ascent: stats.ascent, descent: stats.descent, heavyPack: false });
    const pack = computeWalkingTime({ distanceKm: stats.distanceKm, ascent: stats.ascent, descent: stats.descent, heavyPack: true });
    const shown = state.heavyPack ? pack : std;
    const dash = '—';
    const cells: Array<[string, string]> = [
      [formatDistance(stats.distanceKm), 'Distance'],
      [stats.hasElevation ? `${stats.ascent} m` : dash, 'Dénivelé +'],
      [stats.hasElevation ? `${stats.descent} m` : dash, 'Dénivelé −'],
      [stats.hasElevation ? `${stats.minEle}/${stats.maxEle} m` : dash, 'Alt. min / max'],
      [String(stats.kmMarkers.length), 'Bornes km'],
      [formatDuration(shown.totalMinutes), state.heavyPack ? 'Temps sac lourd' : 'Temps de marche'],
    ];
    $('stats').replaceChildren(
      ...cells.map(([value, label]) => {
        const d = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = value;
        const s = document.createElement('span');
        s.textContent = label;
        d.append(b, s);
        return d;
      }),
    );
    $('packHint').textContent = state.heavyPack
      ? `3,2 km/h sur le plat et 10 min de pause par heure (${formatDuration(shown.walkMinutes)} de marche, ${shown.pauseMinutes} min de pauses)`
      : '4 km/h sur le plat, 300 m/h en montée, 600 m/h en descente (DIN 33466)';
    const notes: string[] = [];
    if (!stats.hasElevation) notes.push("Ce GPX ne contient pas d'altitudes : le temps de marche est calculé sur la distance seule.");
    if (gpx.waypoints.length > 0) notes.push(`${gpx.waypoints.length} point(s) d'intérêt repérés sur la carte : eau, abris, bivouacs, dangers, points de vue.`);
    $('routeNotes').textContent = notes.join(' ');
    $('fileName').textContent = state.fileName;
  }

  const summary = $('summary');
  summary.hidden = !layout;
  if (layout) {
    const n = layout.sheets.length;
    const last = layout.sheets[n - 1].id;
    const what = n === 1 ? `1 feuille ${layout.paper} ${orientationLabel(layout.orientation)}` : `${n} feuilles ${layout.paper} ${orientationLabel(layout.orientation)}, de A1 à ${last}`;
    summary.innerHTML = `<b></b><span class="muted"></span>`;
    summary.querySelector('b')!.textContent = what;
    summary.querySelector('span')!.textContent =
      n === 1 ? 'Plus une page de garde. Marge blanche de 6 mm.' : 'Plus une page de garde. Recouvrement de 1 cm entre feuilles, avec repères de collage.';
    $<HTMLButtonElement>('export').textContent = `Générer le PDF (${n + 1} pages)`;
  } else {
    $<HTMLButtonElement>('export').textContent = 'Générer le PDF';
  }
  $<HTMLButtonElement>('export').disabled = !layout || state.busy;
  $('result').hidden = !state.printHtml;
}

/** Avertissements liés à la grille ; ils remplacent un éventuel message précédent. */
function layoutNotice() {
  const { layout } = state;
  if (!layout) return;
  const n = layout.sheets.length;
  if (!layout.fits) {
    notify(
      state.mode === 'single'
        ? 'La trace dépasse une seule feuille à cette échelle. Passez en plusieurs feuilles pour la carte complète.'
        : 'La trace dépasse la grille choisie. Choisissez Auto ou une grille plus grande.',
    );
    return;
  }
  const alt = layout.alternative;
  if (alt && alt.cols * alt.rows < n) {
    notify(`En ${orientationLabel(alt.orientation)}, ${alt.cols * alt.rows} feuilles suffiraient.`, 'info', {
      label: 'Changer',
      run: () => change({ orientation: alt.orientation }),
    });
    return;
  }
  clearNotice();
}

/** Applique un changement de réglage puis recalcule la grille et met la carte à jour. */
function change(patch: Partial<State>) {
  Object.assign(state, patch);
  if ('baseMap' in patch) send({ type: 'setBaseMap', baseMap: BASE_MAPS[state.baseMap] }).catch((e) => notify(errorMessage(e)));
  if (state.stats) {
    state.layout = computeLayout(state.stats.bounds, layoutRequest(state.mode, state.grid, state.orientation, state.paper, state.scale));
    state.printHtml = null;
    send({ type: 'showLayout', layout: state.layout }).catch((e) => notify(errorMessage(e)));
    layoutNotice();
  }
  render();
}

// --------------------------------------------------------------------- Import

async function loadFile(file: File) {
  clearNotice();
  try {
    if (file.size > MAX_GPX_BYTES) throw new GpxParseError('Fichier trop volumineux (50 Mo maximum).');
    const data = parseGpx(await file.text(), file.name);
    const stats = computeStats(data.points);
    state.gpx = data;
    state.stats = stats;
    state.fileName = file.name;
    $<HTMLInputElement>('title').value = state.title = data.name;
    await ready;
    await send({
      type: 'setTrack',
      track: {
        points: data.points.map((p) => [p.lat, p.lon]),
        segmentStarts: data.points.flatMap((p, i) => (p.newSegment ? [i] : [])),
        waypoints: data.waypoints,
        kmMarkers: stats.kmMarkers,
        bounds: stats.bounds,
      },
    });
    change({});
  } catch (e) {
    notify(e instanceof GpxParseError ? `Fichier GPX invalide. ${e.message}` : `Lecture impossible. ${errorMessage(e)}`);
  }
}

// --------------------------------------------------------------------- Export

function showProgress(step: number, total: number, label: string) {
  $('modalStep').textContent = `${label} (${Math.min(step, total)}/${total})`;
  $('bar').style.width = `${Math.round((Math.min(step, total) / total) * 100)}%`;
}

/** Imprime le document dans un iframe invisible : le navigateur propose « Enregistrer au format PDF ». */
function printDocument(html: string) {
  document.getElementById('printFrame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'printFrame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.onload = async () => {
    const doc = frame.contentDocument!;
    await Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => undefined)));
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
  };
  frame.srcdoc = html;
  document.body.append(frame);
}

async function downloadPdf() {
  const { layout, printHtml } = state;
  if (!layout || !printHtml || state.busy) return;
  const button = $<HTMLButtonElement>('download');
  button.disabled = true;
  button.textContent = 'Création du PDF…';
  try {
    const blob = await htmlToPdf(printHtml, layout.pageWidthMm, layout.pageHeightMm);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.title.trim() || state.gpx?.name || 'carte').replace(/[^\p{L}\p{N}]+/gu, '-')}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {
    notify(`Téléchargement impossible. ${errorMessage(e)} Utilisez Imprimer, puis « Enregistrer au format PDF ».`);
  } finally {
    button.disabled = false;
    button.textContent = 'Télécharger le PDF';
  }
}

async function exportPdf() {
  const { gpx, stats, layout } = state;
  if (!gpx || !stats || !layout || state.busy) return;
  state.busy = true;
  state.printHtml = null;
  render();
  $('modal').hidden = false;
  const total = layout.sheets.length + 2;
  let missing = 0;
  try {
    showProgress(1, total, "Plan d'assemblage");
    const size = overviewCaptureSize(layout.orientation);
    const overview = await send<CaptureResult>({ type: 'captureOverview', layout, width: size.width, height: size.height });
    missing += overview.missingTiles;
    const sheets: string[] = [];
    for (let i = 0; i < layout.sheets.length; i++) {
      showProgress(i + 2, total, `Feuille ${layout.sheets[i].id}`);
      const c = await send<CaptureResult>({ type: 'captureSheet', layout, index: i });
      sheets.push(c.dataUrl);
      missing += c.missingTiles;
    }
    showProgress(total, total, 'Création du document');
    const wt = (heavyPack: boolean) => computeWalkingTime({ distanceKm: stats.distanceKm, ascent: stats.ascent, descent: stats.descent, heavyPack });
    state.printHtml = buildPrintHtml({
      title: state.title.trim() || gpx.name,
      layout,
      stats,
      standardTime: wt(false),
      heavyPackTime: wt(true),
      start: gpx.points[0],
      end: gpx.points[gpx.points.length - 1],
      waypoints: gpx.waypoints,
      baseMap: BASE_MAPS[state.baseMap],
      overviewDataUrl: overview.dataUrl,
      sheetDataUrls: sheets,
    });
    $('resultText').textContent = `Document prêt : ${layout.sheets.length + 1} pages ${layout.paper}.`;
    if (missing > 0) notify(`${missing} tuile(s) n'ont pas pu être téléchargées. Vérifiez la connexion puis relancez l'export pour une carte complète.`);
  } catch (e) {
    notify(`Export impossible. ${errorMessage(e)}`);
  } finally {
    await send({ type: 'endCapture' }).catch(() => undefined);
    state.busy = false;
    $('modal').hidden = true;
    render();
    send({ type: 'showLayout', layout }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------- Démarrage

function init() {
  $('basemaps').replaceChildren(
    ...BASE_MAP_ORDER.map((id) => {
      const def = BASE_MAPS[id];
      const label = document.createElement('label');
      label.className = 'radio';
      label.innerHTML = '<input type="radio" name="basemap"><span><span class="body"></span><span class="muted"></span></span>';
      const input = label.querySelector('input')!;
      input.checked = id === state.baseMap;
      input.onchange = () => change({ baseMap: id });
      const spans = label.querySelectorAll('span span');
      spans[0].textContent = id === 'opentopomap' ? `${def.label} (par défaut)` : def.label;
      spans[1].textContent = def.description;
      return label;
    }),
  );

  document.querySelectorAll<HTMLElement>('[data-key]').forEach((group) =>
    group.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest('button')?.dataset.v;
      if (v === undefined) return;
      const key = group.dataset.key as 'mode' | 'paper' | 'orientation' | 'grid' | 'scale';
      change({ [key]: key === 'scale' ? Number(v) : v } as Partial<State>);
    }),
  );

  $<HTMLInputElement>('file').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) loadFile(f);
  };
  $<HTMLInputElement>('title').oninput = (e) => {
    state.title = (e.target as HTMLInputElement).value;
    state.printHtml = null;
    render();
  };
  $<HTMLInputElement>('pack').onchange = (e) => change({ heavyPack: (e.target as HTMLInputElement).checked });
  $('export').onclick = exportPdf;
  $('download').onclick = downloadPdf;
  $('reprint').onclick = () => state.printHtml && printDocument(state.printHtml);
  $('demo').onclick = () => loadFile(new File([demoGpx], 'exemple-randonnee.gpx', { type: 'application/gpx+xml' }));
  $('recenter').onclick = () => send({ type: 'fitTrack' }).catch(() => undefined);

  // Glisser-déposer d'un fichier n'importe où sur la page.
  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  addEventListener('dragenter', (e) => hasFiles(e) && (depth++, ($('drop').hidden = false)));
  addEventListener('dragleave', (e) => hasFiles(e) && --depth <= 0 && (($('drop').hidden = true), (depth = 0)));
  addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('drop').hidden = true;
    const f = e.dataTransfer?.files[0];
    if (f) loadFile(f);
  });

  onFatal = (m) => notify(m);
  const script = document.createElement('script');
  script.textContent = ENGINE_SCRIPT;
  document.head.append(script);
  ready.then(() => send({ type: 'setBaseMap', baseMap: BASE_MAPS[state.baseMap] })).catch((e) => notify(errorMessage(e)));
  render();
  setupPwa($<HTMLButtonElement>('install'));
}

init();
