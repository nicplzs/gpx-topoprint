import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';

import type { GpxData } from '../types';
import { parseGpx } from './gpx';

export interface LoadedGpx {
  fileName: string;
  data: GpxData;
}

/**
 * Lit le contenu texte d'une URI renvoyée par expo-document-picker.
 *
 * Trois stratégies, dans l'ordre :
 *  1. la classe `File` moderne d'expo-file-system (SDK 54+) ;
 *  2. `readAsStringAsync` importé depuis `expo-file-system/legacy` (import
 *     autorisé, sans avertissement de dépréciation). Dans Expo Go, la classe
 *     `File` refuse les fichiers copiés par le sélecteur dans `cache/DocumentPicker`,
 *     hors du dossier réservé à l'app : l'API legacy, elle, y a accès ;
 *  3. `fetch(uri)`, qui lit aussi les URI `file://` locales.
 */
async function readPickedFile(uri: string): Promise<string> {
  const errors: string[] = [];

  try {
    return await new File(uri).text();
  } catch (e) {
    errors.push(`File : ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    return await LegacyFileSystem.readAsStringAsync(uri, { encoding: LegacyFileSystem.EncodingType.UTF8 });
  } catch (e) {
    errors.push(`legacy : ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const response = await fetch(uri);
    return await response.text();
  } catch (e) {
    errors.push(`fetch : ${e instanceof Error ? e.message : String(e)}`);
  }

  throw new Error(`Impossible de lire le fichier choisi.\n${errors.join('\n')}`);
}

/**
 * Ouvre le sélecteur de documents et lit le GPX choisi.
 *
 * `copyToCacheDirectory: true` force expo-document-picker à recopier les URI
 * `content://` d'Android (Drive, Téléchargements, WhatsApp…) dans le cache :
 * on obtient une URI `file://` lisible localement.
 * Retourne null si l'utilisateur annule.
 */
export async function pickAndReadGpx(): Promise<LoadedGpx | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Beaucoup de gestionnaires de fichiers n'associent pas de type MIME au .gpx :
    // on accepte tout et on valide le contenu nous-mêmes.
    type: ['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const fileName = asset.name ?? 'trace.gpx';
  const xml = await readPickedFile(asset.uri);

  return { fileName, data: parseGpx(xml, fileName) };
}
