import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { computeStats } from './geo';
import { classifyWaypoint, GpxParseError, parseGpx } from './gpx';

const pt = (lat: number, lon: number, ele?: number) =>
  `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;
const gpx = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test">${body}</gpx>`;
const trk = (...segments: string[]) => `<trk>${segments.map((s) => `<trkseg>${s}</trkseg>`).join('')}</trk>`;

test('rejette un fichier sans balise gpx', () => {
  assert.throws(() => parseGpx('<kml></kml>', 'a.gpx'), GpxParseError);
});

test('trace vide : erreur claire', () => {
  assert.throws(() => parseGpx(gpx(trk('')), 'a.gpx'), GpxParseError);
});

test('un seul point : erreur claire', () => {
  assert.throws(() => parseGpx(gpx(trk(pt(45.1, 6.1))), 'a.gpx'), /au moins 2 points/);
});

test('garde coordonnées, altitudes et ordre des points', () => {
  const d = parseGpx(gpx(trk(pt(45.3, 6.3, 300) + pt(45.1, 6.1, 100) + pt(45.2, 6.2))), 'a.gpx');
  assert.deepEqual(
    d.points.map((p) => [p.lat, p.lon, p.ele]),
    [
      [45.3, 6.3, 300],
      [45.1, 6.1, 100],
      [45.2, 6.2, null],
    ],
  );
});

test('lit les points auto-fermants et les horodatages sans les confondre', () => {
  const xml = gpx(
    trk('<trkpt lat="45.1" lon="6.1"/><trkpt lat="45.2" lon="6.2"><ele>12.5</ele><time>2024-05-01T08:00:00Z</time></trkpt>'),
  );
  const d = parseGpx(xml, 'a.gpx');
  assert.deepEqual(
    d.points.map((p) => [p.lat, p.lon, p.ele]),
    [
      [45.1, 6.1, null],
      [45.2, 6.2, 12.5],
    ],
  );
});

test('virgule décimale : le point est refusé, jamais tronqué à 45', () => {
  const xml = gpx(trk('<trkpt lat="45,1" lon="6.1"/>' + pt(45.2, 6.2) + pt(45.3, 6.3)));
  const d = parseGpx(xml, 'a.gpx');
  assert.equal(d.points.length, 2);
  assert.ok(d.points.every((p) => p.lat !== 45));
});

test('virgule décimale partout : le message explique le séparateur', () => {
  const xml = gpx(trk('<trkpt lat="45,1" lon="6,1"/><trkpt lat="45,2" lon="6,2"/>'));
  assert.throws(() => parseGpx(xml, 'a.gpx'), /point décimal/);
});

test('attribut lat absent ou vide : point refusé (pas lu comme 0)', () => {
  const xml = gpx(trk('<trkpt lon="6.1"/><trkpt lat="" lon="6.1"/>' + pt(45.2, 6.2) + pt(45.3, 6.3)));
  assert.equal(parseGpx(xml, 'a.gpx').points.length, 2);
});

test('altitude vide ou illisible : null, pas 0', () => {
  const xml = gpx(trk('<trkpt lat="45.1" lon="6.1"><ele></ele></trkpt><trkpt lat="45.2" lon="6.2"><ele>abc</ele></trkpt>'));
  assert.deepEqual(
    parseGpx(xml, 'a.gpx').points.map((p) => p.ele),
    [null, null],
  );
});

test('les points en commentaire sont ignorés', () => {
  const xml = gpx(`<!-- ${pt(1, 1)} <wpt lat="1" lon="1"><name>x</name></wpt> -->${trk(pt(45.1, 6.1) + pt(45.2, 6.2))}`);
  const d = parseGpx(xml, 'a.gpx');
  assert.equal(d.points.length, 2);
  assert.equal(d.waypoints.length, 0);
});

test('plusieurs segments : pas de ligne fantôme dans la distance', () => {
  // Deux segments de ~1,1 km séparés de ~110 km.
  const xml = gpx(trk(pt(45.0, 6.0) + pt(45.01, 6.0), pt(46.0, 6.0) + pt(46.01, 6.0)));
  const d = parseGpx(xml, 'a.gpx');
  assert.deepEqual(
    d.points.map((p) => p.newSegment === true),
    [false, false, true, false],
  );
  const stats = computeStats(d.points);
  assert.ok(Math.abs(stats.distanceKm - 2.22) < 0.01, `distance ${stats.distanceKm}`);
});

test('plusieurs traces <trk> : même règle, nom de la première trace', () => {
  const xml = gpx(
    `<trk><name>T1</name><trkseg>${pt(45.0, 6.0)}${pt(45.01, 6.0)}</trkseg></trk>` +
      `<trk><name>T2</name><trkseg>${pt(46.0, 6.0)}${pt(46.01, 6.0)}</trkseg></trk>`,
  );
  const d = parseGpx(xml, 'a.gpx');
  assert.equal(d.name, 'T1');
  assert.equal(computeStats(d.points).distanceKm < 2.3, true);
});

test('plusieurs routes <rte> : segments séparés aussi', () => {
  const rte = (a: number) => `<rte><rtept lat="${a}" lon="6"/><rtept lat="${a + 0.01}" lon="6"/></rte>`;
  const d = parseGpx(gpx(rte(45) + rte(46)), 'a.gpx');
  assert.deepEqual(
    d.points.map((p) => p.newSegment === true),
    [false, false, true, false],
  );
});

test('pas de D+ compté dans le saut entre deux segments', () => {
  const xml = gpx(trk(pt(45.0, 6.0, 100) + pt(45.01, 6.0, 100), pt(46.0, 6.0, 900) + pt(46.01, 6.0, 900)));
  const stats = computeStats(parseGpx(xml, 'a.gpx').points);
  assert.equal(stats.ascent, 0);
  assert.equal(stats.maxEle, 900);
});

test('caractères spéciaux dans les noms (entités, CDATA, accents)', () => {
  const xml = gpx(
    `<trk><name>Tom &amp; Jérôme &lt;3 &#233;&#x00E8;</name><trkseg>${pt(45.1, 6.1)}${pt(45.2, 6.2)}</trkseg></trk>` +
      '<wpt lat="45" lon="6"><name><![CDATA[Source « A & B » <x>]]></name></wpt>',
  );
  const d = parseGpx(xml, 'a.gpx');
  assert.equal(d.name, 'Tom & Jérôme <3 éè');
  assert.equal(d.waypoints[0].name, 'Source « A & B » <x>');
  assert.equal(d.waypoints[0].kind, 'water');
});

test('sans nom : nom du fichier sans extension', () => {
  assert.equal(parseGpx(gpx(trk(pt(45.1, 6.1) + pt(45.2, 6.2))), 'Ma trace.GPX').name, 'Ma trace');
});

test('très longue trace (100 000 points) : tout est lu, dans l’ordre', () => {
  const n = 100000;
  const body = Array.from({ length: n }, (_, i) => pt(45 + i * 1e-5, 6, i % 500)).join('');
  const d = parseGpx(gpx(trk(body)), 'a.gpx');
  assert.equal(d.points.length, n);
  assert.equal(d.points[n - 1].lat, 45 + (n - 1) * 1e-5);
  assert.ok(computeStats(d.points).distanceKm > 100);
});

test('fichier d’exemple du projet', () => {
  const xml = readFileSync(join(__dirname, '../../samples/boucle-semnoz.gpx'), 'utf8');
  const d = parseGpx(xml, 'boucle-semnoz.gpx');
  const stats = computeStats(d.points);
  assert.equal(d.points.length, 421);
  assert.equal(d.waypoints.length, 4);
  assert.equal(stats.distanceKm.toFixed(1), '19.8');
  assert.equal(stats.ascent, 960);
});

test('mots courts reconnus seulement en entier (Attention, chute, Château)', () => {
  assert.equal(classifyWaypoint('Traversée de route', 'Danger Area', 'Attention, route passante'), 'danger');
  assert.equal(classifyWaypoint('Attention chute de pierres'), 'danger');
  assert.equal(classifyWaypoint('Aire de tente'), 'camp');
  assert.equal(classifyWaypoint('Tent site'), 'camp');
  assert.equal(classifyWaypoint('Hut'), 'shelter');
  assert.equal(classifyWaypoint("Point d'eau"), 'water');
  assert.equal(classifyWaypoint('Château de Meudon'), 'generic');
  assert.equal(classifyWaypoint('Plateau'), 'generic');
});

test('la trace de démonstration est une boucle de 7 km avec 4 points d\'intérêt', () => {
  const data = parseGpx(readFileSync(join(__dirname, '../../samples/exemple-randonnee.gpx'), 'utf8'), 'x');
  const stats = computeStats(data.points);
  assert.equal(data.name, 'Boucle de démonstration - Forêt de Meudon');
  assert.ok(data.points.length >= 50);
  assert.ok(stats.hasElevation);
  assert.ok(Math.abs(stats.distanceKm - 7) < 0.3, `distance ${stats.distanceKm}`);
  assert.deepEqual(data.waypoints.map((w) => w.kind), ['water', 'shelter', 'viewpoint', 'danger']);
});
