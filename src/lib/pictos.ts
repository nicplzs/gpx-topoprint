import type { WaypointKind } from '../types';

/**
 * Pictogrammes des points d'intérêt : un tracé SVG plein (viewBox 0 0 24 24,
 * règle evenodd) et une couleur. Utilisés tels quels sur la carte (canvas Path2D),
 * dans l'aperçu Leaflet et dans le PDF, pour ne dépendre d'aucune police d'emojis.
 */
export const WAYPOINT_PICTOS: Record<WaypointKind, { label: string; color: string; path: string }> = {
  water: { label: 'Eau', color: '#1E6FB8', path: 'M12 3C9.2 7.4 6.5 10.6 6.5 14a5.5 5.5 0 0 0 11 0c0-3.4-2.7-6.6-5.5-11z' },
  shelter: { label: 'Abri', color: '#6D4C41', path: 'M12 4 3.5 11.5H6V20h4.5v-5h3v5H18v-8.5h2.5z' },
  camp: { label: 'Bivouac', color: '#2E6B34', path: 'M12 4 3 20h7.5L12 16l1.5 4H21z' },
  danger: { label: 'Danger', color: '#C2410C', path: 'M12 3 2 21h20zM11 9h2v6h-2zm0 8h2v2h-2z' },
  viewpoint: { label: 'Point de vue', color: '#5B3B8C', path: 'M2.5 19 9.5 8l3.6 5.4 2.4-3.4 6 9z' },
  generic: { label: 'Point', color: '#37474F', path: 'M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0z' },
};

/** Pictogramme en SVG inline, pour le HTML (aperçu et PDF). */
export function pictoSvg(kind: WaypointKind, size: string): string {
  const p = WAYPOINT_PICTOS[kind];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><path d="${p.path}" fill="${p.color}" fill-rule="evenodd"/></svg>`;
}
