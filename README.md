# GPX TopoPrint

Application mobile **React Native / Expo SDK 57 (TypeScript)** qui transforme une trace `.gpx` en carte
topographique papier à l'échelle exacte (**1:25 000** par défaut, 1:10 000 ou 1:50 000) : une feuille unique
ou une **carte en plusieurs feuilles A4 ou A3 à assembler** (portrait ou paysage), avec page de garde
« sécurité », pour la randonnée, le trail, la course d'orientation ou toute sortie sans réseau.

## Démarrer

```bash
npm install
npx expo start          # puis « a » (Android) ou « i » (iOS), ou scanner le QR code avec Expo Go
npm run typecheck       # tsc --noEmit
npm test                # tests du lecteur GPX et de la géométrie des feuilles (node:test + tsx)
```

Un GPX d'exemple est fourni : `samples/boucle-semnoz.gpx` (boucle de 19,8 km, 960 m D+, 4 waypoints).

## Version web (un seul fichier HTML, publiée sur GitHub Pages)

```bash
npm run build:web       # produit index.html à la racine (environ 230 Ko, 70 Ko compressé, Leaflet inclus)
```

`index.html` est autonome (CSS et JS inclus) : il s'ouvre en double-clic et sert de page d'accueil sur
GitHub Pages (Settings > Pages > Deploy from a branch > `main` / racine). À côté, pour l'appli installable :
`sw.js` (service worker : réseau d'abord, repli hors ligne ; les tuiles de carte ne sont pas interceptées),
`manifest.webmanifest` et `icons/` (192 et 512 px, régénérables avec `node web/icons.cjs`). Le manifeste et le
service worker ne sont activés qu'en http/https, jamais en double-clic.

Même moteur de carte, mêmes calculs et même document d'impression que l'application mobile
(`src/lib`, `src/map`, `src/pdf` sont partagés). L'interface est dans `web/` (`main.ts`, `pwa.ts`, `app.css`,
`template.html`). Pensée pour le PC (réglages à gauche, carte à droite) et adaptée au téléphone.
Le bouton « Essayer avec une trace d'exemple » charge `samples/exemple-randonnee.gpx` (boucle illustrative de
7 km en forêt de Meudon, 4 points d'intérêt), incluse dans `index.html`.
Le fichier GPX reste dans le navigateur : seules les tuiles de carte sont demandées aux serveurs de fonds.
`node web/e2e.cjs [dossier-captures]` rejoue tout le parcours dans Chromium avec de fausses tuiles
(trace d'exemple, installation, hors ligne, double-clic ; nécessite Playwright, non inclus au projet).

## Ce que produit l'export PDF

**Page 1 : page de garde**
- Titre modifiable, format (ex. « Carte 3×2 · 6 feuilles A4 paysage »), échelle, fond, date.
- Distance, D+, D−, altitudes min/max, temps de marche **DIN 33466** et **sac lourd**.
- **Plan d'assemblage** : grille bleue A1, B1, A2… tracée avec exactement les coins des feuilles.
- Profil altimétrique avec bornes km.
- **Bandeau sécurité** : 112, 114 (SMS), 15, 18 + coordonnées WGS84 du départ et de l'arrivée (décimal et DMS).
- Rose des vents, légende, **échelle graphique en vraie grandeur**, liste des points d'intérêt.
- Encadré vierge **« Notes et azimuts »** (De → Vers / Azimut / Distance / Observations).
- Mode d'emploi de l'assemblage + rappel d'imprimer à 100 %.

**Pages 2 à N : feuilles de carte**, cadre de carte entouré d'une **marge blanche de 6 mm** (zone non
imprimable des imprimantes, bord de découpe) :
- tracé magenta avec liseré blanc et chevrons de sens de marche ;
- bornes `1k`, `2k`… ; départ `D` vert, arrivée `A` rouge ; points d'intérêt en pictogrammes SVG (eau, abri,
  bivouac, danger, point de vue), sans dépendre d'une police d'emojis ;
- carroyage 1 km aligné sur le Nord, continu d'une feuille à l'autre ;
- pied de page `A1 · 1:25 000 · voisines : B1 à droite, A2 en dessous`, flèche du Nord en haut à gauche ;
- **assemblage** : deux feuilles voisines partagent exactement **1 cm de carte**. Une ligne pointillée marque
  où vient le bord de la voisine, et des croix de repérage coupées en deux par ce bord se rejoignent une fois
  la feuille posée. La géométrie est testée (`src/lib/sheets.test.ts`).

## Règles techniques appliquées

| Règle | Où |
| --- | --- |
| Lecture GPX sans `readAsStringAsync` : `new File(uri).text()` (API moderne SDK 54+) + `copyToCacheDirectory: true` pour les URI `content://` Android | `src/lib/fileLoader.ts` |
| Leaflet dans `react-native-webview`, OpenTopoMap par défaut (`maxNativeZoom 17`, `maxZoom 19`, `crossOrigin`), CyclOSM, IGN Plan V2 WMTS Géoplateforme | `src/lib/tileLayers.ts`, `src/map/` |
| Filtre `.leaflet-tile-pane { filter: contrast(1.08) saturate(1.12) }` (et le même filtre appliqué aux tuiles dans l'image capturée) | `src/map/leafletHtml.ts`, `engineScript.ts` |
| Capture après l'événement `load` de toutes les tuiles + 400 ms | `waitForTiles()` dans `engineScript.ts` |
| Tuilage Mercator à zoom fixe calculé en TypeScript pur (projection identique à Leaflet), **jamais de `fitBounds` par feuille** : cadre = page − 2 × 6 mm à 5,39 px/mm, recouvrement 10 mm, `setView(center, Z, { animate: false })` | `src/lib/sheets.ts` / `captureSheet()` |
| Plan d'assemblage dessiné avec les coins `unproject(topLeftPx)` / `unproject(bottomRightPx)` des feuilles | `captureOverview()` |
| `@page { size: A4|A3 portrait|landscape; margin: 0 }` dynamique, `expo-print` (taille en points), puis `expo-sharing`. En A3, la page de garde A4 est agrandie (zoom √2) | `src/pdf/` |

### Zoom fixe et échelle exacte

Le zoom unique `Z` est calculé pour que l'impression soit **exactement à l'échelle choisie** à la latitude
du centre de la trace : `mètres/pixel = échelle / (5,386 px/mm × 1000)`, puis
`Z = log2(40 075 017 × cos(lat) / (256 × mètres/pixel))`. Au 1:25 000 à 45° N on obtient `Z ≈ 14,5` (zoom
fractionnaire Leaflet, `zoomSnap: 0`). Pendant la capture, les tuiles du niveau supérieur (`ceil(Z)`) sont
utilisées et réduites, pour une impression plus nette. A4 et A3 ont la même densité, donc le même zoom.

### Mode Auto

Le mode Auto calcule le nombre minimal de colonnes/lignes pour couvrir la trace (+ une marge de 60 px) avec le
pas « cadre − 1 cm », et suggère l'autre orientation si elle demande moins de feuilles.

### Temps de marche

- DIN 33466 : temps horizontal à 4 km/h, temps vertical à 300 m/h en montée et 600 m/h en descente,
  total = le plus grand + la moitié du plus petit (règle de combinaison de la norme).
- Mode « Sac lourd » : 3,2 km/h sur le plat + 10 min de pause à la fin de chaque heure de marche.
- D+/D− calculés avec une hystérésis de 5 m pour filtrer le bruit GPS.

## Architecture

```
App.tsx                     Écran unique (thème sombre graphite) et orchestration
src/types.ts                Types partagés
src/lib/gpx.ts              Parseur GPX 1.0/1.1 (trkpt, rtept, wpt, classification des waypoints)
src/lib/geo.ts              Distance, bornes km, D+/D−, profil, formats (DMS…)
src/lib/walkingTime.ts      DIN 33466 et mode sac lourd
src/lib/sheets.ts           Géométrie des feuilles (A4/A3, marges, recouvrement, repères) + projection Mercator
src/lib/pictos.ts           Pictogrammes SVG des points d'intérêt
src/lib/fileLoader.ts       expo-document-picker + File (expo-file-system moderne)
src/lib/tileLayers.ts       Fonds de carte
src/map/engineScript.ts     Moteur Leaflet exécuté dans la WebView (aperçu, captures Base64)
src/map/leafletHtml.ts      Page HTML de la WebView
src/map/TopoMap.tsx         Composant WebView + pont de messages typé (promesses)
src/pdf/printHtml.ts        HTML d'impression (page de garde + feuilles)
src/pdf/exportPdf.ts        Captures → expo-print → Documents → expo-sharing / impression
src/components/ui.tsx       Composants UI
src/theme/colors.ts         Palette
```

## Notes

- Une connexion internet est nécessaire pour charger Leaflet et les tuiles au moment de la génération ; le PDF,
  lui, s'utilise ensuite hors réseau.
- Imprimez à **100 % / taille réelle** (sans « Ajuster à la page ») pour conserver l'échelle.
- Respectez les conditions d'usage des serveurs de tuiles (OpenTopoMap, CyclOSM, IGN) : usage raisonnable,
  attribution présente sur chaque page.
