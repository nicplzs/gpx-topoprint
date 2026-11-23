import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, Notice, Section, Segmented, StatTile, textStyles } from './src/components/ui';
import { pickAndReadGpx, type LoadedGpx } from './src/lib/fileLoader';
import { computeStats, formatDistance, formatDuration } from './src/lib/geo';
import { GpxParseError } from './src/lib/gpx';
import { computeLayout, layoutRequest } from './src/lib/sheets';
import { BASE_MAPS, BASE_MAP_ORDER } from './src/lib/tileLayers';
import { computeWalkingTime } from './src/lib/walkingTime';
import { TopoMap, type EngineTrack, type TopoMapHandle } from './src/map/TopoMap';
import { generatePdf, printPdf, sharePdf, type ExportProgress } from './src/pdf/exportPdf';
import { colors, radius } from './src/theme/colors';
import type {
  BaseMapId,
  GridChoice,
  Orientation,
  PaperSize,
  PrintMode,
  ScaleDenominator,
} from './src/types';

const GRID_CHOICES: Array<{ value: GridChoice; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '2x2', label: '2 × 2' },
  { value: '2x3', label: '2 × 3' },
  { value: '3x2', label: '3 × 2' },
  { value: '3x3', label: '3 × 3' },
];

const orientationLabel = (o: Orientation) => (o === 'portrait' ? 'portrait' : 'paysage');

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface LastPdf {
  uri: string;
  fileName: string;
  pages: number;
  orientation: Orientation;
}

function TopoPrintScreen() {
  const mapRef = useRef<TopoMapHandle>(null);
  const { height: windowHeight } = useWindowDimensions();

  const [engineGeneration, setEngineGeneration] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [gpx, setGpx] = useState<LoadedGpx | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [title, setTitle] = useState('');
  const [baseMap, setBaseMap] = useState<BaseMapId>('opentopomap');
  const [mode, setMode] = useState<PrintMode>('poster');
  const [grid, setGrid] = useState<GridChoice>('auto');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [scale, setScale] = useState<ScaleDenominator>(25000);
  const [heavyPack, setHeavyPack] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [lastPdf, setLastPdf] = useState<LastPdf | null>(null);
  const [trackReady, setTrackReady] = useState(0);

  const mapReady = engineGeneration > 0;

  const stats = useMemo(() => (gpx ? computeStats(gpx.data.points) : null), [gpx]);
  const standardTime = useMemo(
    () => (stats ? computeWalkingTime({ distanceKm: stats.distanceKm, ascent: stats.ascent, descent: stats.descent, heavyPack: false }) : null),
    [stats],
  );
  const heavyPackTime = useMemo(
    () => (stats ? computeWalkingTime({ distanceKm: stats.distanceKm, ascent: stats.ascent, descent: stats.descent, heavyPack: true }) : null),
    [stats],
  );
  // Tuilage Mercator à zoom fixe : calcul pur, recalculé à chaque changement de réglage.
  const layout = useMemo(
    () => (stats ? computeLayout(stats.bounds, layoutRequest(mode, grid, orientation, paper, scale)) : null),
    [stats, mode, grid, orientation, paper, scale],
  );

  const engineTrack = useMemo<EngineTrack | null>(() => {
    if (!gpx || !stats) return null;
    return {
      points: gpx.data.points.map((p) => [p.lat, p.lon] as [number, number]),
      segmentStarts: gpx.data.points.flatMap((p, i) => (p.newSegment ? [i] : [])),
      waypoints: gpx.data.waypoints,
      kmMarkers: stats.kmMarkers,
      bounds: stats.bounds,
    };
  }, [gpx, stats]);

  const handleEngineReady = useCallback(() => {
    setEngineError(null);
    setEngineGeneration((g) => g + 1);
  }, []);

  const handleEngineError = useCallback((message: string) => {
    setEngineError(message);
  }, []);

  // Fond de carte (renvoyé aussi après un rechargement de la WebView).
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.setBaseMap(BASE_MAPS[baseMap]).catch((e) => setEngineError(errorMessage(e)));
  }, [baseMap, engineGeneration, mapReady]);

  // Trace GPX.
  useEffect(() => {
    if (!mapReady || !engineTrack) return;
    let cancelled = false;
    mapRef.current
      ?.setTrack(engineTrack)
      .then(() => {
        if (!cancelled) setTrackReady((n) => n + 1);
      })
      .catch((e) => setEngineError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [engineTrack, engineGeneration, mapReady]);

  // Grille des feuilles sur l'aperçu, une fois la trace affichée.
  useEffect(() => {
    if (!mapReady || trackReady === 0 || !layout) return;
    mapRef.current?.showLayout(layout).catch((e) => setEngineError(errorMessage(e)));
  }, [layout, trackReady, mapReady]);

  const importGpx = useCallback(async () => {
    setLoadingFile(true);
    try {
      const loaded = await pickAndReadGpx();
      if (!loaded) return;
      setGpx(loaded);
      setTitle(loaded.data.name);
      setLastPdf(null);
    } catch (e) {
      Alert.alert(
        e instanceof GpxParseError ? 'Fichier GPX invalide' : 'Lecture impossible',
        errorMessage(e),
      );
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const exportPdf = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !gpx || !stats || !layout || !standardTime || !heavyPackTime) return;
    setLastPdf(null);
    setProgress({ step: 0, total: layout.sheets.length + 2, label: 'Préparation' });
    try {
      const result = await generatePdf(
        map,
        {
          title: title.trim() || gpx.data.name,
          layout,
          stats,
          standardTime,
          heavyPackTime,
          start: gpx.data.points[0],
          end: gpx.data.points[gpx.data.points.length - 1],
          waypoints: gpx.data.waypoints,
          baseMap: BASE_MAPS[baseMap],
        },
        setProgress,
      );
      setLastPdf({ uri: result.uri, fileName: result.fileName, pages: result.pages, orientation: layout.orientation });
      if (result.missingTiles > 0) {
        Alert.alert(
          'PDF créé avec des manques',
          `${result.missingTiles} tuile(s) n'ont pas pu être téléchargées. Vérifiez la connexion puis relancez l'export pour une carte complète.`,
        );
      }
      await sharePdf(result.uri);
    } catch (e) {
      Alert.alert('Export impossible', errorMessage(e));
    } finally {
      setProgress(null);
      mapRef.current?.showLayout(layout).catch(() => undefined);
    }
  }, [gpx, stats, layout, standardTime, heavyPackTime, title, baseMap]);

  const displayedTime = heavyPack ? heavyPackTime : standardTime;
  const sheetCount = layout ? layout.sheets.length : 0;
  const busy = progress !== null;
  const mapHeight = Math.max(260, Math.round(windowHeight * 0.4));

  const alternativeHint =
    layout && layout.alternative && layout.alternative.cols * layout.alternative.rows < sheetCount
      ? layout.alternative
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.appTitle}>GPX TopoPrint</Text>
          <Text style={styles.appSubtitle}>Votre trace sur une carte topo à imprimer</Text>
        </View>
        <Pressable
          onPress={importGpx}
          disabled={loadingFile || busy}
          accessibilityRole="button"
          accessibilityLabel="Importer un fichier GPX"
          style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
        >
          {loadingFile ? <ActivityIndicator color={colors.text} /> : <Ionicons name="folder-open-outline" size={20} color={colors.text} />}
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" scrollEnabled={!busy}>
          <View style={[styles.mapWrap, { height: mapHeight }]}>
            <TopoMap ref={mapRef} onReady={handleEngineReady} onFatalError={handleEngineError} />
            {!gpx ? (
              <View style={styles.mapEmpty} pointerEvents="box-none">
                <Text style={styles.mapEmptyTitle}>Aucune trace chargée</Text>
                <Text style={styles.mapEmptyText}>Importez un fichier .gpx : randonnée, trail, course d'orientation</Text>
                <Button label="Importer un GPX" icon="folder-open-outline" onPress={importGpx} loading={loadingFile} disabled={!mapReady} />
              </View>
            ) : (
              <Pressable
                style={styles.recenter}
                onPress={() => mapRef.current?.fitTrack().catch(() => undefined)}
                accessibilityLabel="Recentrer sur la trace"
              >
                <Ionicons name="locate-outline" size={20} color={colors.text} />
              </Pressable>
            )}
            {!mapReady && !engineError ? (
              <View style={styles.mapLoading}>
                <ActivityIndicator color={colors.textMuted} />
                <Text style={textStyles.muted}>Chargement de la carte</Text>
              </View>
            ) : null}
          </View>

          {engineError ? (
            <Notice tone="warning">
              <Text style={textStyles.body}>{engineError}</Text>
            </Notice>
          ) : null}

          {gpx && stats && displayedTime ? (
            <Section title="Itinéraire" right={<Text style={styles.fileName} numberOfLines={1}>{gpx.fileName}</Text>}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Titre de la carte"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                maxLength={60}
                returnKeyType="done"
              />
              <View style={styles.stats}>
                <StatTile label="Distance" value={formatDistance(stats.distanceKm)} />
                <StatTile label="Dénivelé +" value={stats.hasElevation ? `${stats.ascent} m` : '—'} />
                <StatTile label="Dénivelé −" value={stats.hasElevation ? `${stats.descent} m` : '—'} />
                <StatTile label="Alt. min / max" value={stats.hasElevation ? `${stats.minEle}/${stats.maxEle} m` : '—'} />
                <StatTile label="Bornes km" value={String(stats.kmMarkers.length)} />
                <StatTile label={heavyPack ? 'Temps sac lourd' : 'Temps DIN 33466'} value={formatDuration(displayedTime.totalMinutes)} />
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={textStyles.body}>Sac lourd</Text>
                  <Text style={textStyles.muted}>
                    {heavyPack
                      ? `3,2 km/h sur le plat et 10 min de pause par heure (${formatDuration(displayedTime.walkMinutes)} de marche, ${displayedTime.pauseMinutes} min de pauses)`
                      : '4 km/h sur le plat, 300 m/h en montée, 600 m/h en descente (DIN 33466)'}
                  </Text>
                </View>
                <Switch
                  value={heavyPack}
                  onValueChange={setHeavyPack}
                  trackColor={{ false: colors.surfaceRaised, true: colors.accent }}
                  thumbColor={colors.text}
                />
              </View>
              {!stats.hasElevation ? (
                <Notice tone="info">
                  <Text style={textStyles.muted}>Ce GPX ne contient pas d'altitudes : le temps de marche est calculé sur la distance seule.</Text>
                </Notice>
              ) : null}
              {gpx.data.waypoints.length > 0 ? (
                <Text style={textStyles.muted}>
                  {gpx.data.waypoints.length} point(s) d'intérêt repérés sur la carte : eau, abris, bivouacs, dangers, points de vue.
                </Text>
              ) : null}
            </Section>
          ) : null}

          <Section title="Mise en page">
            <Segmented
              options={[
                { value: 'single', label: 'Une feuille' },
                { value: 'poster', label: 'Plusieurs feuilles' },
              ]}
              value={mode}
              onChange={setMode}
              disabled={busy}
            />
            <View style={styles.field}>
              <Text style={styles.label}>Papier</Text>
              <Segmented
                options={[
                  { value: 'A4', label: 'A4', hint: '210 × 297' },
                  { value: 'A3', label: 'A3', hint: '297 × 420' },
                ]}
                value={paper}
                onChange={setPaper}
                disabled={busy}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Orientation</Text>
              <Segmented
                options={[
                  { value: 'portrait', label: 'Portrait' },
                  { value: 'landscape', label: 'Paysage' },
                ]}
                value={orientation}
                onChange={setOrientation}
                disabled={busy}
              />
            </View>
            {mode === 'poster' ? (
              <View style={styles.field}>
                <Text style={styles.label}>Grille</Text>
                <View style={styles.chips}>
                  {GRID_CHOICES.map((g) => (
                    <Chip key={g.value} label={g.label} active={grid === g.value} onPress={() => setGrid(g.value)} disabled={busy} />
                  ))}
                </View>
              </View>
            ) : null}
            <View style={styles.field}>
              <Text style={styles.label}>Échelle</Text>
              <Segmented
                options={[
                  { value: '10000', label: '1:10 000', hint: '10 cm = 1 km' },
                  { value: '25000', label: '1:25 000', hint: '4 cm = 1 km' },
                  { value: '50000', label: '1:50 000', hint: '2 cm = 1 km' },
                ]}
                value={String(scale) as '10000' | '25000' | '50000'}
                onChange={(v) => setScale(Number(v) as ScaleDenominator)}
                disabled={busy}
              />
            </View>

            {layout ? (
              <View style={styles.layoutSummary}>
                <Text style={styles.summaryMain}>
                  {sheetCount === 1
                    ? `1 feuille ${layout.paper} ${orientationLabel(layout.orientation)}`
                    : `${sheetCount} feuilles ${layout.paper} ${orientationLabel(layout.orientation)}, de A1 à ${layout.sheets[sheetCount - 1].id}`}
                </Text>
                <Text style={textStyles.muted}>
                  {sheetCount === 1
                    ? 'Plus une page de garde. Marge blanche de 6 mm.'
                    : `Plus une page de garde. Recouvrement de 1 cm entre feuilles, avec repères de collage.`}
                </Text>
              </View>
            ) : null}
            {layout && !layout.fits ? (
              <Notice tone="warning">
                <Text style={textStyles.body}>
                  {mode === 'single'
                    ? 'La trace dépasse une seule feuille à cette échelle. Passez en plusieurs feuilles pour la carte complète.'
                    : 'La trace dépasse la grille choisie. Choisissez Auto ou une grille plus grande.'}
                </Text>
              </Notice>
            ) : null}
            {alternativeHint ? (
              <Notice tone="info">
                <Text style={textStyles.body}>
                  {`En ${orientationLabel(alternativeHint.orientation)}, ${alternativeHint.cols * alternativeHint.rows} feuilles suffiraient. `}
                  <Text style={textStyles.link} onPress={() => setOrientation(alternativeHint.orientation)}>
                    Changer
                  </Text>
                </Text>
              </Notice>
            ) : null}
          </Section>

          <Section title="Fond de carte">
            <View>
              {BASE_MAP_ORDER.map((id) => {
                const def = BASE_MAPS[id];
                const active = id === baseMap;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setBaseMap(id)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    style={({ pressed }) => [styles.baseMapRow, pressed && { opacity: 0.75 }]}
                  >
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? colors.accent : colors.textFaint} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={textStyles.body}>
                        {def.label}
                        {id === 'opentopomap' ? <Text style={styles.defaultTag}>{'  par défaut'}</Text> : null}
                      </Text>
                      <Text style={textStyles.muted}>{def.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title="Export PDF">
            <Text style={textStyles.muted}>
              Page de garde (plan d'assemblage, profil, sécurité, notes et azimuts), puis les feuilles de carte avec leurs repères
              d'assemblage.
            </Text>
            <Button
              label={layout ? `Générer le PDF (${sheetCount + 1} pages)` : 'Générer le PDF'}
              icon="document-text-outline"
              onPress={exportPdf}
              disabled={!layout || busy || !gpx}
              loading={busy}
            />
            {lastPdf ? (
              <View style={styles.pdfRow}>
                <Text style={[textStyles.muted, { flexBasis: '100%' }]} numberOfLines={2}>
                  {lastPdf.fileName} · {lastPdf.pages} pages
                </Text>
                <Button label="Partager" icon="share-outline" variant="secondary" onPress={() => sharePdf(lastPdf.uri).catch((e) => Alert.alert('Partage impossible', errorMessage(e)))} style={styles.smallButton} />
                <Button label="Imprimer" icon="print-outline" variant="secondary" onPress={() => printPdf(lastPdf.uri, lastPdf.orientation).catch((e) => Alert.alert('Impression impossible', errorMessage(e)))} style={styles.smallButton} />
              </View>
            ) : null}
            <Text style={styles.tip}>Imprimez à 100 % (taille réelle) pour garder l'échelle exacte</Text>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      {progress ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>Génération de la carte</Text>
            <Text style={textStyles.muted}>
              {progress.label} ({Math.min(progress.step, progress.total)}/{progress.total})
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round((Math.min(progress.step, progress.total) / progress.total) * 100)}%` }]} />
            </View>
            <Text style={styles.tip}>Téléchargement des tuiles en haute définition, gardez l'application ouverte</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <TopoPrintScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  appSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },
  mapWrap: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  mapEmpty: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  mapEmptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  mapEmptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 8 },
  mapLoading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  recenter: {
    position: 'absolute',
    right: 12,
    bottom: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { color: colors.textFaint, fontSize: 12, maxWidth: 160 },
  input: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '500',
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  field: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { color: colors.textMuted, fontSize: 13 },
  layoutSummary: { gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  summaryMain: { color: colors.text, fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] },
  baseMapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  defaultTag: { color: colors.textFaint, fontSize: 12 },
  pdfRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  smallButton: { paddingVertical: 8, paddingHorizontal: 12 },
  tip: { color: colors.textFaint, fontSize: 12, textAlign: 'center' },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 12,
  },
  overlayTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  progressTrack: { width: '100%', height: 4, borderRadius: 2, backgroundColor: colors.background, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.accent },
});
