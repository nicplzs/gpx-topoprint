import { WAYPOINT_PICTOS } from '../lib/pictos';

/**
 * Moteur cartographique exécuté DANS la WebView (Leaflet 1.9.4).
 *
 * Ce script est volontairement écrit en JavaScript ES2017 sans template
 * literals ni regex, afin d'être injecté tel quel dans le HTML de la WebView.
 *
 * Responsabilités :
 *  - aperçu interactif (trace, bornes km, D/A, waypoints, grille du poster) ;
 *  - capture Base64 des feuilles et du plan d'assemblage, après chargement
 *    complet des tuiles + 400 ms de sécurité.
 *
 * Protocole :
 *  RN → WebView : window.TopoEngine.receive(message)
 *  WebView → RN : window.ReactNativeWebView.postMessage(JSON)
 */
export const ENGINE_SCRIPT = `
(function () {
  'use strict';

  var CAPTURE_SCALE = 2;
  var TILE_SETTLE_MS = 400;
  var TILE_TIMEOUT_MS = 30000;
  var TRACK_COLOR = '#E6007E';
  var GRID_COLOR = '#1565C0';
  var TILE_FILTER = 'contrast(1.08) saturate(1.12)';
  var PICTOS = ${JSON.stringify(WAYPOINT_PICTOS)};

  function post(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  if (typeof L === 'undefined') {
    post({ type: 'error', message: 'Leaflet n\\'a pas pu être chargé : vérifiez la connexion internet.' });
    return;
  }

  // Couche de tuiles « haute définition » : pendant la capture, on force le
  // niveau de tuiles supérieur (ceil) au lieu de l'arrondi, pour que le zoom
  // fractionnaire de l'échelle 1:25 000 utilise toujours des tuiles réduites
  // (plus nettes) plutôt qu'agrandies.
  var PrintTileLayer = L.TileLayer.extend({
    _clampZoom: function (zoom) {
      if (this._hdMode && this._map) {
        zoom = Math.ceil(this._map.getZoom() - 1e-6);
      }
      return L.TileLayer.prototype._clampZoom.call(this, zoom);
    }
  });

  var mapEl = document.getElementById('map');
  var map = L.map(mapEl, {
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    minZoom: 3,
    maxZoom: 19,
    fadeAnimation: false,
    preferCanvas: false
  }).setView([46.6, 2.4], 6);

  var state = {
    tileLayer: null,
    tileErrors: 0,
    track: null,
    segmentStarts: {},
    overlays: L.layerGroup().addTo(map),
    gridLayer: L.layerGroup().addTo(map),
    capturing: false
  };

  function setBaseMap(def) {
    if (state.tileLayer) map.removeLayer(state.tileLayer);
    state.tileLayer = new PrintTileLayer(def.url, {
      subdomains: def.subdomains || 'abc',
      maxNativeZoom: def.maxNativeZoom,
      maxZoom: def.maxZoom,
      crossOrigin: true,
      attribution: def.attribution,
      keepBuffer: 1
    });
    state.tileLayer.on('tileerror', function () { state.tileErrors += 1; });
    state.tileLayer.addTo(map);
    map.setMaxZoom(def.maxZoom);
  }

  // ---------------------------------------------------------------- Aperçu

  function divIcon(html, className, size) {
    return L.divIcon({ html: html, className: className, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
  }

  function drawPreviewTrack() {
    state.overlays.clearLayers();
    var t = state.track;
    if (!t) return;
    var latlngs = t.points.map(function (p) { return [p[0], p[1]]; });
    // Une polyligne par segment : Leaflet accepte un tableau de tableaux.
    var parts = [];
    latlngs.forEach(function (p, i) {
      if (i === 0 || isSegmentStart(i)) parts.push([]);
      parts[parts.length - 1].push(p);
    });
    L.polyline(parts, { color: '#FFFFFF', weight: 7, opacity: 0.9, interactive: false }).addTo(state.overlays);
    L.polyline(parts, { color: TRACK_COLOR, weight: 4, opacity: 1, interactive: false }).addTo(state.overlays);
    t.kmMarkers.forEach(function (m) {
      L.marker([m.lat, m.lon], { icon: divIcon(m.km + 'k', 'km-marker', [30, 18]), interactive: false }).addTo(state.overlays);
    });
    t.waypoints.forEach(function (w) {
      var style = PICTOS[w.kind] || PICTOS.generic;
      var html = '<span style="border-color:' + style.color + '"><svg viewBox="0 0 24 24" width="15" height="15"><path d="' +
        style.path + '" fill="' + style.color + '" fill-rule="evenodd"/></svg></span>';
      L.marker([w.lat, w.lon], { icon: divIcon(html, 'wpt-marker', [26, 26]), title: w.name }).addTo(state.overlays);
    });
    var start = latlngs[0];
    var end = latlngs[latlngs.length - 1];
    L.marker(end, { icon: divIcon('A', 'end-marker', [26, 26]), interactive: false }).addTo(state.overlays);
    L.marker(start, { icon: divIcon('D', 'start-marker', [26, 26]), interactive: false }).addTo(state.overlays);
  }

  function fitTrack() {
    var t = state.track;
    if (!t) return;
    var b = t.bounds;
    map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [30, 30], animate: false });
  }

  function showLayout(layout) {
    state.gridLayer.clearLayers();
    if (!layout) return;
    layout.sheets.forEach(function (s) {
      L.rectangle([s.nw, s.se], {
        color: GRID_COLOR, weight: 2, fill: true, fillOpacity: 0.04, dashArray: '6 4', interactive: false
      }).addTo(state.gridLayer);
      L.marker(s.center, { icon: divIcon(s.id, 'sheet-label', [44, 26]), interactive: false }).addTo(state.gridLayer);
    });
  }

  // ------------------------------------------------------------- Captures

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function nextFrame() { return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); }); }

  /** Attend l'événement 'load' de la couche (toutes les tuiles visibles) + 400 ms. */
  function waitForTiles() {
    var layer = state.tileLayer;
    return nextFrame().then(function () {
      return new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          layer.off('load', finish);
          resolve();
        }
        var timer = setTimeout(finish, TILE_TIMEOUT_MS);
        layer.on('load', finish);
        if (!layer.isLoading()) finish();
      });
    }).then(function () { return sleep(TILE_SETTLE_MS); });
  }

  function enterPrintMode(width, height) {
    state.capturing = true;
    map.removeLayer(state.overlays);
    map.removeLayer(state.gridLayer);
    document.body.classList.add('printing');
    mapEl.style.width = width + 'px';
    mapEl.style.height = height + 'px';
    map.options.zoomSnap = 0;
    state.tileLayer._hdMode = true;
    // 3. Obligatoire : Leaflet doit relire la taille réelle du conteneur.
    map.invalidateSize({ animate: false });
  }

  function exitPrintMode() {
    if (!state.capturing) return;
    state.capturing = false;
    document.body.classList.remove('printing');
    mapEl.style.width = '100%';
    mapEl.style.height = '100%';
    map.options.zoomSnap = 0.25;
    state.tileLayer._hdMode = false;
    map.invalidateSize({ animate: false });
    state.overlays.addTo(map);
    state.gridLayer.addTo(map);
    fitTrack();
  }

  function newCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(width * CAPTURE_SCALE);
    canvas.height = Math.round(height * CAPTURE_SCALE);
    var ctx = canvas.getContext('2d');
    ctx.scale(CAPTURE_SCALE, CAPTURE_SCALE);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { canvas: canvas, ctx: ctx };
  }

  /** Recopie les tuiles affichées (positions réelles à l'écran) dans le canvas. */
  function drawTiles(ctx) {
    var origin = mapEl.getBoundingClientRect();
    var containers = Array.prototype.slice.call(mapEl.querySelectorAll('.leaflet-tile-container'));
    containers.sort(function (a, b) { return (parseInt(a.style.zIndex, 10) || 0) - (parseInt(b.style.zIndex, 10) || 0); });
    ctx.save();
    ctx.filter = TILE_FILTER;
    containers.forEach(function (container) {
      var tiles = container.querySelectorAll('img.leaflet-tile');
      for (var i = 0; i < tiles.length; i++) {
        var img = tiles[i];
        if (!img.complete || img.naturalWidth === 0) continue;
        var r = img.getBoundingClientRect();
        ctx.drawImage(img, r.left - origin.left, r.top - origin.top, r.width, r.height);
      }
    });
    ctx.restore();
  }

  function pt(lat, lon) { return map.latLngToContainerPoint([lat, lon]); }

  function drawCarroyage(ctx, width, height, layout) {
    // Carroyage kilométrique aligné sur le Nord cartographique (méridiens
    // verticaux en Web Mercator), ancré sur le coin haut-gauche de la feuille A1
    // pour rester continu d'une feuille à l'autre.
    var kmPx = 1000 / layout.metersPerPixel;
    var anchor = map.project(layout.sheets[0].nw, layout.zoom);
    var viewMin = map.getPixelBounds().min;
    var offX = ((anchor.x - viewMin.x) % kmPx + kmPx) % kmPx;
    var offY = ((anchor.y - viewMin.y) % kmPx + kmPx) % kmPx;
    ctx.save();
    ctx.strokeStyle = 'rgba(21, 101, 192, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (var x = offX; x <= width; x += kmPx) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (var y = offY; y <= height; y += kmPx) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    ctx.restore();
  }

  function isSegmentStart(i) { return state.segmentStarts[i] === true; }

  function trackPixels() {
    return state.track.points.map(function (p) { return pt(p[0], p[1]); });
  }

  function strokeTrack(ctx, pixels, width) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pixels.forEach(function (p, i) { if (i === 0 || isSegmentStart(i)) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = width + 3;
    ctx.stroke();
    ctx.strokeStyle = TRACK_COLOR;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  /** Chevrons de sens de marche, tous les ~220 px le long du tracé. */
  function drawDirectionArrows(ctx, pixels) {
    var spacing = 220;
    var acc = spacing / 2;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = TRACK_COLOR;
    ctx.lineWidth = 1.2;
    for (var i = 1; i < pixels.length; i++) {
      if (isSegmentStart(i)) continue;
      var a = pixels[i - 1];
      var b = pixels[i];
      var seg = a.distanceTo(b);
      while (seg > 0 && acc <= seg) {
        var t = acc / seg;
        var x = a.x + (b.x - a.x) * t;
        var y = a.y + (b.y - a.y) * t;
        var angle = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, -4.5);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        acc += spacing;
      }
      acc -= seg;
    }
    ctx.restore();
  }

  function haloText(ctx, text, x, y, font, color, align) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function drawKmMarkers(ctx) {
    ctx.save();
    ctx.font = 'bold 10px -apple-system, Roboto, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    state.track.kmMarkers.forEach(function (m) {
      var p = pt(m.lat, m.lon);
      var label = m.km + 'k';
      var w = ctx.measureText(label).width + 8;
      roundRect(ctx, p.x - w / 2, p.y - 7.5, w, 15, 7.5);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = TRACK_COLOR;
      ctx.stroke();
      ctx.fillStyle = '#5A0033';
      ctx.fillText(label, p.x, p.y + 0.5);
    });
    ctx.restore();
  }

  function disc(ctx, x, y, radius, fill, label, labelSize) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + labelSize + 'px -apple-system, Roboto, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
  }

  function drawStartEnd(ctx, radius) {
    var pts = state.track.points;
    var s = pt(pts[0][0], pts[0][1]);
    var e = pt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    var loop = s.distanceTo(e) < radius * 1.6;
    if (loop) {
      disc(ctx, e.x + radius * 1.1, e.y, radius, '#C62828', 'A', radius * 1.05);
      disc(ctx, s.x - radius * 1.1, s.y, radius, '#2E7D32', 'D', radius * 1.05);
    } else {
      disc(ctx, e.x, e.y, radius, '#C62828', 'A', radius * 1.05);
      disc(ctx, s.x, s.y, radius, '#2E7D32', 'D', radius * 1.05);
    }
  }

  function drawWaypoints(ctx, withLabels) {
    state.track.waypoints.forEach(function (w) {
      var style = PICTOS[w.kind] || PICTOS.generic;
      var p = pt(w.lat, w.lon);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = style.color;
      ctx.stroke();
      ctx.translate(p.x - 7, p.y - 7);
      ctx.scale(14 / 24, 14 / 24);
      ctx.fillStyle = style.color;
      ctx.fill(new Path2D(style.path), 'evenodd');
      ctx.restore();
      if (withLabels && w.name) {
        haloText(ctx, w.name, p.x + 14, p.y, 'bold 11px -apple-system, Roboto, Helvetica, Arial, sans-serif', '#1B1B1B', 'left');
      }
    });
  }

  function exportCanvas(canvas) {
    try {
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch (e) {
      throw new Error('Ce fond de carte ne peut pas être enregistré dans le PDF. Choisissez un autre fond de carte.');
    }
  }

  function captureSheet(layout, index) {
    var sheet = layout.sheets[index];
    var w = layout.canvasW;
    var h = layout.canvasH;
    enterPrintMode(w, h);
    state.tileErrors = 0;
    // 8. Positionnement exact au zoom fixe, jamais de fitBounds par cellule.
    map.setView(sheet.center, layout.zoom, { animate: false });
    return waitForTiles().then(function () {
      var c = newCanvas(w, h);
      drawTiles(c.ctx);
      drawCarroyage(c.ctx, w, h, layout);
      var pixels = trackPixels();
      strokeTrack(c.ctx, pixels, 3.4);
      drawDirectionArrows(c.ctx, pixels);
      drawKmMarkers(c.ctx);
      drawWaypoints(c.ctx, true);
      drawStartEnd(c.ctx, 11);
      return { dataUrl: exportCanvas(c.canvas), missingTiles: state.tileErrors };
    });
  }

  function captureOverview(layout, width, height) {
    enterPrintMode(width, height);
    state.tileErrors = 0;
    var first = layout.sheets[0];
    var last = layout.sheets[layout.sheets.length - 1];
    // Vue d'ensemble : un fitBounds global est permis (ce n'est pas une feuille).
    map.fitBounds([first.nw, last.se], { padding: [18, 18], animate: false });
    return waitForTiles().then(function () {
      var c = newCanvas(width, height);
      var ctx = c.ctx;
      drawTiles(ctx);
      var pixels = trackPixels();
      strokeTrack(ctx, pixels, 2.6);
      drawWaypoints(ctx, false);
      // 9. Grille d'assemblage tracée avec EXACTEMENT les coins des feuilles.
      if (layout.sheets.length > 1) {
        ctx.save();
        layout.sheets.forEach(function (s) {
          var a = map.latLngToContainerPoint(s.nw);
          var b = map.latLngToContainerPoint(s.se);
          ctx.fillStyle = 'rgba(21, 101, 192, 0.06)';
          ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.strokeStyle = GRID_COLOR;
          ctx.lineWidth = 1.6;
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        });
        layout.sheets.forEach(function (s) {
          var center = map.latLngToContainerPoint(s.center);
          var size = Math.max(14, Math.min(34, (map.latLngToContainerPoint(s.se).x - map.latLngToContainerPoint(s.nw).x) / 5));
          haloText(ctx, s.id, center.x, center.y, 'bold ' + Math.round(size) + 'px -apple-system, Roboto, Helvetica, Arial, sans-serif', GRID_COLOR, 'center');
        });
        ctx.restore();
      }
      drawStartEnd(ctx, 9);
      return { dataUrl: exportCanvas(c.canvas), missingTiles: state.tileErrors };
    });
  }

  // ------------------------------------------------------------- Messages

  var queue = Promise.resolve();

  function respond(id, work) {
    queue = queue.then(work).then(function (result) {
      post({ type: 'result', id: id, result: result === undefined ? null : result });
    }, function (err) {
      post({ type: 'error', id: id, message: (err && err.message) || String(err) });
    });
  }

  window.TopoEngine = {
    receive: function (msg) {
      switch (msg.type) {
        case 'setBaseMap':
          respond(msg.id, function () { setBaseMap(msg.baseMap); });
          break;
        case 'setTrack':
          respond(msg.id, function () {
            state.track = msg.track;
            state.segmentStarts = {};
            msg.track.segmentStarts.forEach(function (i) { state.segmentStarts[i] = true; });
            drawPreviewTrack();
            fitTrack();
          });
          break;
        case 'fitTrack':
          respond(msg.id, function () { fitTrack(); });
          break;
        case 'showLayout':
          respond(msg.id, function () { showLayout(msg.layout); });
          break;
        case 'captureSheet':
          respond(msg.id, function () { return captureSheet(msg.layout, msg.index); });
          break;
        case 'captureOverview':
          respond(msg.id, function () { return captureOverview(msg.layout, msg.width, msg.height); });
          break;
        case 'endCapture':
          respond(msg.id, function () { exitPrintMode(); });
          break;
        default:
          post({ type: 'error', id: msg.id, message: 'Commande inconnue : ' + msg.type });
      }
    }
  };

  post({ type: 'ready' });
})();
`;
