import type { BaseMapId } from '../types';

export interface BaseMapDefinition {
  id: BaseMapId;
  label: string;
  description: string;
  url: string;
  subdomains: string;
  maxNativeZoom: number;
  maxZoom: number;
  attribution: string;
}

export const BASE_MAPS: Record<BaseMapId, BaseMapDefinition> = {
  opentopomap: {
    id: 'opentopomap',
    label: 'Topo Rando',
    description: 'Style Visorando, courbes de niveau (OpenTopoMap)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxNativeZoom: 17,
    maxZoom: 19,
    attribution: '© OpenStreetMap, SRTM | Style © OpenTopoMap (CC-BY-SA)',
  },
  cyclosm: {
    id: 'cyclosm',
    label: 'OSM Outdoor',
    description: 'Sentiers et chemins détaillés (CyclOSM)',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxNativeZoom: 20,
    maxZoom: 20,
    attribution: '© OpenStreetMap | CyclOSM',
  },
  ignplan: {
    id: 'ignplan',
    label: 'IGN Plan V2',
    description: 'Plan IGN Géoplateforme (France uniquement)',
    url:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
      '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    subdomains: '',
    maxNativeZoom: 19,
    maxZoom: 19,
    attribution: '© IGN Géoplateforme',
  },
};

export const BASE_MAP_ORDER: BaseMapId[] = ['opentopomap', 'cyclosm', 'ignplan'];
