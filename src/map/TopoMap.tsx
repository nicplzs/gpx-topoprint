import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { BaseMapDefinition } from '../lib/tileLayers';
import { colors } from '../theme/colors';
import type { Bounds, CaptureResult, KmMarker, PosterLayout, Waypoint } from '../types';
import { LEAFLET_HTML } from './leafletHtml';

export interface EngineTrack {
  /** [lat, lon] */
  points: Array<[number, number]>;
  /** Index des points qui commencent un nouveau segment (pas de trait depuis le point précédent). */
  segmentStarts: number[];
  waypoints: Waypoint[];
  kmMarkers: KmMarker[];
  bounds: Bounds;
}

export interface TopoMapHandle {
  setBaseMap(def: BaseMapDefinition): Promise<void>;
  setTrack(track: EngineTrack): Promise<void>;
  fitTrack(): Promise<void>;
  showLayout(layout: PosterLayout | null): Promise<void>;
  captureOverview(layout: PosterLayout, width: number, height: number): Promise<CaptureResult>;
  captureSheet(layout: PosterLayout, index: number): Promise<CaptureResult>;
  endCapture(): Promise<void>;
}

interface Props {
  onReady: () => void;
  onFatalError: (message: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type EngineMessage =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id?: number; message: string };

/** Délai maximal d'une commande (une capture attend jusqu'à 30 s les tuiles). */
const COMMAND_TIMEOUT_MS = 60000;

export const TopoMap = forwardRef<TopoMapHandle, Props>(function TopoMap({ onReady, onFatalError }, ref) {
  const webRef = useRef<WebView>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  const send = useCallback(<T,>(message: Record<string, unknown>): Promise<T> => {
    const id = nextId.current++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error("La carte ne répond pas (délai dépassé). Vérifiez votre connexion."));
      }, COMMAND_TIMEOUT_MS);
      pending.current.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      const payload = JSON.stringify({ ...message, id });
      webRef.current?.injectJavaScript(`window.TopoEngine && window.TopoEngine.receive(${payload}); true;`);
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setBaseMap: (baseMap) => send<void>({ type: 'setBaseMap', baseMap }),
      setTrack: (track) => send<void>({ type: 'setTrack', track }),
      fitTrack: () => send<void>({ type: 'fitTrack' }),
      showLayout: (layout) => send<void>({ type: 'showLayout', layout }),
      captureOverview: (layout, width, height) =>
        send<CaptureResult>({ type: 'captureOverview', layout, width, height }),
      captureSheet: (layout, index) => send<CaptureResult>({ type: 'captureSheet', layout, index }),
      endCapture: () => send<void>({ type: 'endCapture' }),
    }),
    [send],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: EngineMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as EngineMessage;
      } catch {
        return;
      }
      if (message.type === 'ready') {
        onReady();
        return;
      }
      if (message.type === 'error' && message.id === undefined) {
        onFatalError(message.message);
        return;
      }
      const entry = message.id !== undefined ? pending.current.get(message.id) : undefined;
      if (!entry || message.id === undefined) return;
      pending.current.delete(message.id);
      if (message.type === 'result') entry.resolve(message.result);
      else entry.reject(new Error(message.message));
    },
    [onReady, onFatalError],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ html: LEAFLET_HTML, baseUrl: 'https://gpx-topoprint.app/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        style={styles.webview}
        onError={(e) => onFatalError(`Erreur WebView : ${e.nativeEvent.description}`)}
        onContentProcessDidTerminate={() => {
          webRef.current?.reload();
        }}
        onRenderProcessGone={() => {
          webRef.current?.reload();
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  webview: { flex: 1, backgroundColor: colors.background },
});
