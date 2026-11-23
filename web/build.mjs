// Construit index.html à la racine du dépôt (page d'accueil GitHub Pages) : un seul fichier,
// sans dépendance réseau (Leaflet, CSS et JS inclus), qui marche aussi en double-clic.
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const bundle = await build({
  entryPoints: [new URL('./main.ts', import.meta.url).pathname],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  write: false,
  legalComments: 'none',
  loader: { '.gpx': 'text' },
});
// Le JS est placé dans une balise <script> : « </script » doit y être échappé.
const appJs = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const leafletJs = readFileSync(new URL('../node_modules/leaflet/dist/leaflet.js', import.meta.url), 'utf8')
  .replace(/\/\/# sourceMappingURL=.*$/m, '')
  .replace(/<\/script/gi, '<\\/script');
// Les images de Leaflet (boutons de zoom, couches) ne sont pas utilisées : on retire leurs url().
const leafletCss = (await transform(readFileSync(new URL('../node_modules/leaflet/dist/leaflet.css', import.meta.url), 'utf8').replace(/url\(images\/[^)]*\)/g, 'none'), { loader: 'css', minify: true })).code;
const appCss = (await transform(read('./app.css'), { loader: 'css', minify: true })).code;

// split/join : le contenu inséré peut contenir « $& » ou « $1 », que replace() interpréterait.
const html = read('./template.html')
  .split('/*LEAFLET_CSS*/').join(leafletCss)
  .split('/*APP_CSS*/').join(appCss)
  .split('/*LEAFLET_JS*/').join(leafletJs)
  .split('/*APP_JS*/').join(appJs);

writeFileSync(new URL('../index.html', import.meta.url), html);
console.log(`index.html : ${(html.length / 1024).toFixed(0)} Ko, ${(gzipSync(html).length / 1024).toFixed(0)} Ko compressé`);
