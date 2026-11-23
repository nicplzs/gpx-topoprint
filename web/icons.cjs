// Génère icons/icon-192.png et icons/icon-512.png (fond #131416, tracé magenta #E6007E).
// À relancer seulement si le logo change. Nécessite Playwright (non inclus au projet) : node web/icons.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

// Même dessin que l'icône de l'onglet, resserré au centre pour rester visible
// quand Android découpe l'icône en cercle (zone sûre « maskable »).
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
<rect width="32" height="32" fill="#131416"/>
<g transform="translate(16 16) scale(.72) translate(-16 -15.5)">
<path d="M6 24c5-1 4-8 9-9s6 5 11-8" fill="none" stroke="#E6007E" stroke-width="3" stroke-linecap="round"/></g></svg>`;

(async () => {
  const out = path.join(__dirname, '../icons');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}</style>${svg(size)}`);
    await page.locator('svg').screenshot({ path: path.join(out, `icon-${size}.png`), omitBackground: false });
    await page.close();
  }
  await browser.close();
  console.log('icons/icon-192.png, icons/icon-512.png');
})().catch((e) => { console.error(e); process.exit(1); });
