// Parcours complet de la version web dans Chromium, avec de fausses tuiles (aucun accès réseau).
// Prérequis : « npm run build:web » (index.html à la racine) puis playwright installé (non inclus au projet) : node web/e2e.cjs [dossier-captures]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const sample = path.join(__dirname, '../samples/boucle-semnoz.gpx');
const out = process.argv[2] || null;
const shot = (page, name, opts = {}) => out && page.screenshot({ path: path.join(out, name), ...opts });

(async () => {
  // Sert les fichiers publiés sur GitHub Pages : index.html, sw.js, manifest.webmanifest, icons/.
  const server = http.createServer((q, r) => {
    const name = new URL(q.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
    const file = path.join(root, path.normalize(name));
    const ok = ['/index.html', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'].includes(name);
    if (!ok || !fs.existsSync(file)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
    fs.createReadStream(file).pipe(r);
  }).listen(0);
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    window.print = () => { window.top.__prints = (window.top.__prints || 0) + 1; };
  });
  await context.route('https://*.tile.opentopomap.org/**', (r) => {
    const m = r.request().url().match(/(\d+)\/(\d+)\/(\d+)\.png/);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f3efe4"/><path d="M0 0H256V256" fill="none" stroke="#9a8"/><text x="8" y="20" font-size="14" fill="#576">${m[1]}/${m[2]}/${m[3]}</text></svg>`;
    r.fulfill({ body: svg, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const requests = [];
  page.on('request', (r) => { if (!r.url().startsWith('data:') && !r.url().startsWith(url)) requests.push(new URL(r.url()).hostname); });

  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.leaflet-container'));
  assert.equal(await page.locator('#route').isHidden(), true, 'itinéraire caché avant import');
  await shot(page, 'web_empty.png');

  // Appli installable : manifeste, icône iPhone et service worker actif.
  assert.equal(await page.getAttribute('link[rel=manifest]', 'href'), 'manifest.webmanifest');
  assert.equal(await page.getAttribute('link[rel=apple-touch-icon]', 'href'), 'icons/icon-192.png');
  assert.ok(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active.scriptURL.endsWith('/sw.js'))), 'service worker actif');
  const manifest = await page.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  assert.deepEqual(manifest.icons.map((i) => i.sizes), ['192x192', '512x512', '512x512']);
  assert.equal(await page.locator('#install').isHidden(), true, 'bouton Installer caché tant que le navigateur ne le propose pas');
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__installPrompted = true; return Promise.resolve(); }; dispatchEvent(e); });
  await page.click('#install');
  assert.ok(await page.evaluate(() => window.__installPrompted), 'le bouton ouvre la proposition d\'installation');
  assert.equal(await page.locator('#install').isHidden(), true);

  // Aide « Comment ça marche ? ».
  await page.click('#help summary');
  assert.match(await page.locator('#help').innerText(), /Imprimer le PDF à 100 %/);
  await page.click('#help summary');

  // Trace d'exemple : chargée comme un vrai fichier.
  await page.click('#demo');
  await page.waitForSelector('#route:not([hidden])');
  assert.equal(await page.inputValue('#title'), 'Boucle de démonstration - Forêt de Meudon');
  assert.equal(await page.textContent('#fileName'), 'exemple-randonnee.gpx');
  assert.match(await page.locator('#stats').innerText(), /7,0\d? km/);
  assert.match(await page.textContent('#routeNotes'), /4 point\(s\) d'intérêt/);
  await page.waitForTimeout(800);
  await shot(page, 'web_demo.png');

  // Fichier invalide : message clair, rien ne casse.
  await page.setInputFiles('#file', { name: 'x.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx></gpx>') });
  await page.waitForSelector('.notice');
  assert.match(await page.locator('.notice').innerText(), /Fichier GPX invalide/);

  // Import du GPX d'exemple.
  await page.setInputFiles('#file', sample);
  await page.waitForSelector('#route:not([hidden])');
  assert.equal(await page.inputValue('#title'), 'Boucle du Semnoz');
  const stats = await page.locator('#stats').innerText();
  assert.match(stats, /19,8 km/); assert.match(stats, /960 m/);
  assert.match(await page.locator('#summary').innerText(), /feuilles A4 portrait/);
  await page.waitForTimeout(800);
  await shot(page, 'web_loaded.png');

  // Réglages : échelle, papier, orientation.
  await page.click('[data-key=scale] [data-v="50000"]');
  assert.match(await page.locator('#summary').innerText(), /1 feuille A4 portrait|feuilles A4 portrait/);
  const n50 = Number((await page.locator('#export').innerText()).match(/\((\d+) pages/)[1]);
  await page.click('[data-key=scale] [data-v="10000"]');
  const n10 = Number((await page.locator('#export').innerText()).match(/\((\d+) pages/)[1]);
  assert.ok(n10 > n50, `1:10 000 demande plus de feuilles que 1:50 000 (${n10} > ${n50})`);
  await page.click('[data-key=paper] [data-v="A3"]');
  await page.click('[data-key=orientation] [data-v="landscape"]');
  assert.match(await page.locator('#summary').innerText(), /A3 paysage/);
  await page.click('[data-key=mode] [data-v="single"]');
  assert.match(await page.locator('.notice').innerText(), /dépasse une seule feuille/);
  await page.click('[data-key=mode] [data-v="poster"]');
  await page.click('[data-key=scale] [data-v="25000"]');
  await page.click('[data-key=paper] [data-v="A4"]');
  await page.click('[data-key=orientation] [data-v="portrait"]');
  await page.check('#pack');
  assert.match(await page.locator('#stats').innerText(), /Temps sac lourd/);
  await page.uncheck('#pack');

  // Export : le PDF a le bon nombre de pages, au bon format.
  const pages = Number((await page.locator('#export').innerText()).match(/\((\d+) pages/)[1]);
  await page.click('#export');
  await page.waitForSelector('#result:not([hidden])', { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__prints || 0), 0, 'l\'impression ne doit plus s\'ouvrir toute seule');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#download')]).catch(async (e) => { console.log('NOTICES', await page.textContent('#notices'), 'BTN', await page.textContent('#download'), errors); throw e; });
  const dlPath = path.join(out || '/tmp', 'web_download.pdf');
  await dl.saveAs(dlPath);
  const dlBytes = fs.readFileSync(dlPath);
  assert.equal(dlBytes.subarray(0, 5).toString(), '%PDF-', 'le téléchargement doit être un PDF');
  assert.equal((dlBytes.toString('latin1').match(/\/Type \/Page /g) || []).length, pages, 'pages du PDF téléchargé');
  await page.click('#reprint');
  await page.waitForFunction(() => window.__prints >= 1);
  await shot(page, 'web_done.png');
  const doc = await page.frame({ url: 'about:srcdoc' }).content();
  const pdfPage = await context.newPage();
  await pdfPage.setContent(doc);
  const pdf = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(path.join(out || '/tmp', 'web_export.pdf'), pdf);
  const count = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(count, pages, `PDF : ${count} pages au lieu de ${pages}`);
  await page.click('#reprint');
  await page.waitForFunction(() => window.__prints >= 2);

  // Téléphone : même parcours d'affichage, sans débordement horizontal.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await phone.route('https://*.tile.opentopomap.org/**', (r) => r.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f3efe4"/></svg>', contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }));
  const mp = await phone.newPage();
  mp.on('pageerror', (e) => errors.push('mobile : ' + e.message));
  await mp.goto(url);
  await mp.setInputFiles('#file', sample);
  await mp.waitForSelector('#route:not([hidden])');
  await mp.waitForTimeout(800);
  assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'pas de défilement horizontal sur téléphone');
  await shot(mp, 'web_phone_top.png');
  await shot(mp, 'web_phone_full.png', { fullPage: true });

  // Hors ligne : le service worker sert l'appli depuis son cache.
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#empty');
  assert.equal(await page.title(), 'GPX TopoPrint : votre trace GPX en carte papier');
  await context.setOffline(false);

  // Double-clic local (file://) : l'appli marche, sans manifeste ni service worker, sans erreur.
  const local = await browser.newPage();
  const localErrors = [];
  local.on('pageerror', (e) => localErrors.push(e.message));
  local.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|ERR_PROXY/.test(m.text()) && localErrors.push(m.text()));
  await local.goto('file://' + path.join(root, 'index.html'));
  await local.click('#demo');
  await local.waitForSelector('#route:not([hidden])');
  assert.equal(await local.locator('link[rel=manifest]').count(), 0);
  assert.deepEqual(localErrors, [], 'aucune erreur en file:// : ' + localErrors.join(' | '));

  assert.deepEqual(errors, [], 'aucune erreur JS : ' + errors.join(' | '));
  const hosts = [...new Set(requests)].sort();
  console.log('Hôtes contactés :', hosts.join(', '));
  assert.ok(hosts.every((h) => h.endsWith('opentopomap.org') || h === 'localhost'), 'seules les tuiles sont demandées au réseau');
  console.log('E2E web OK : import, erreurs, réglages, export', pages, 'pages, téléphone');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
