import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { TopoMapHandle } from '../map/TopoMap';
import type { PosterLayout } from '../types';
import { buildPrintHtml, overviewCaptureSize, type PrintDocumentInput } from './printHtml';

export interface ExportProgress {
  step: number;
  total: number;
  label: string;
}

export type ExportInput = Omit<PrintDocumentInput, 'overviewDataUrl' | 'sheetDataUrls' | 'layout'> & {
  layout: PosterLayout;
};

export interface ExportResult {
  uri: string;
  fileName: string;
  pages: number;
  missingTiles: number;
}

/** mm → points PostScript (72 dpi) pour expo-print. */
const mmToPoints = (mm: number) => Math.round((mm * 72) / 25.4);

function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'carte'
  );
}

/**
 * Capture toutes les pages dans la WebView (plan d'assemblage puis feuilles
 * A1…), assemble le HTML d'impression et génère le PDF A4 natif.
 */
export async function generatePdf(
  map: TopoMapHandle,
  input: ExportInput,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  const { layout } = input;
  const total = layout.sheets.length + 2;
  let missingTiles = 0;
  const sheetDataUrls: string[] = [];
  let overviewDataUrl: string;

  try {
    onProgress({ step: 1, total, label: "Plan d'assemblage" });
    const size = overviewCaptureSize(layout.orientation);
    const overview = await map.captureOverview(layout, size.width, size.height);
    overviewDataUrl = overview.dataUrl;
    missingTiles += overview.missingTiles;

    for (let i = 0; i < layout.sheets.length; i++) {
      onProgress({ step: i + 2, total, label: `Feuille ${layout.sheets[i].id}` });
      const capture = await map.captureSheet(layout, i);
      sheetDataUrls.push(capture.dataUrl);
      missingTiles += capture.missingTiles;
    }
  } finally {
    await map.endCapture().catch(() => undefined);
  }

  onProgress({ step: total, total, label: 'Création du PDF' });
  const html = buildPrintHtml({ ...input, overviewDataUrl, sheetDataUrls });
  const printed = await Print.printToFileAsync({
    html,
    width: mmToPoints(layout.pageWidthMm),
    height: mmToPoints(layout.pageHeightMm),
    margins: { left: 0, top: 0, right: 0, bottom: 0 },
  });

  // Renomme le PDF temporaire dans les Documents de l'app (API File moderne).
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `TopoPrint_${slugify(input.title)}_${layout.paper}_${layout.cols}x${layout.rows}_${date}.pdf`;
  const destination = new File(Paths.document, fileName);
  if (destination.exists) destination.delete();
  const temp = new File(printed.uri);
  temp.move(destination);

  return { uri: destination.uri, fileName, pages: layout.sheets.length + 1, missingTiles };
}

export async function sharePdf(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage n'est pas disponible sur cet appareil.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Partager la carte PDF',
  });
}

export async function printPdf(uri: string, orientation: PosterLayout['orientation']): Promise<void> {
  await Print.printAsync({
    uri,
    orientation: orientation === 'landscape' ? Print.Orientation.landscape : Print.Orientation.portrait,
  });
}
