import { ENGINE_SCRIPT } from './engineScript';

const LEAFLET_VERSION = '1.9.4';

/** Styles des marqueurs et de la couche de tuiles, partagés avec la version web. */
export const MAP_CSS = `
  /* Contraste renforcé : courbes de niveau et sentiers lisibles sur papier. */
  .leaflet-tile-pane { filter: contrast(1.08) saturate(1.12); }
  .leaflet-control-attribution { font-size: 9px; background: rgba(19, 20, 22, 0.7) !important; color: #C9CACE; }
  .leaflet-control-attribution a { color: #E4E5E8; }
  .km-marker {
    display: flex; align-items: center; justify-content: center;
    background: #fff; border: 2px solid #E6007E; border-radius: 9px;
    font: bold 10px -apple-system, Roboto, sans-serif; color: #5A0033; box-sizing: border-box;
  }
  .start-marker, .end-marker {
    display: flex; align-items: center; justify-content: center; border-radius: 50%;
    border: 2px solid #fff; color: #fff; font: bold 14px -apple-system, Roboto, sans-serif;
    box-shadow: 0 1px 4px rgba(0,0,0,0.45); box-sizing: border-box;
  }
  .start-marker { background: #2E7D32; }
  .end-marker { background: #C62828; }
  .wpt-marker span {
    display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
    background: #fff; border: 2px solid; border-radius: 50%; font-size: 13px; box-sizing: border-box;
  }
  .sheet-label {
    display: flex; align-items: center; justify-content: center;
    background: rgba(21, 101, 192, 0.88); color: #fff; border-radius: 6px;
    font: bold 14px -apple-system, Roboto, sans-serif;
  }
`;

/** Page HTML complète chargée dans la WebView. */
export const LEAFLET_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" crossorigin="" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #131416; overflow: hidden; }
  #map { width: 100%; height: 100%; background: #DDE3D8; }
  body.printing #map { position: absolute; top: 0; left: 0; }
${MAP_CSS}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js" crossorigin=""></script>
<script>${ENGINE_SCRIPT}</script>
</body>
</html>`;
