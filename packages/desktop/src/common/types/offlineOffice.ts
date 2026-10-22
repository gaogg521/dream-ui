export type OfficeBounds = { x: number; y: number; width: number; height: number };
export type OfficeEvent = {
  sessionId: string;
  kind: 'ready' | 'dirty' | 'save' | 'error' | 'snapshot';
  revision?: number;
  base64?: string;
  message?: string;
  /** `snapshot`: JPEG data URL of the first screen, shown on the next open while the engine loads. */
  image?: string;
};
export type OfflineOfficeApi = {
  open: (request: {
    fileName: string;
    base64: string;
    bounds: OfficeBounds;
    readOnly?: boolean;
    /** The renderer shows a placeholder while loading: keep the engine view hidden until the document is ready. */
    hideUntilReady?: boolean;
  }) => Promise<{ sessionId: string }>;
  unlock: (sessionId: string) => Promise<void>;
  dispatch: (sessionId: string, command: string) => Promise<void>;
  bounds: (sessionId: string, bounds: OfficeBounds) => Promise<void>;
  visibility: (sessionId: string, visible: boolean) => Promise<string | null>;
  flush: (sessionId: string) => Promise<boolean>;
  close: (sessionId: string) => Promise<void>;
  acknowledge: (sessionId: string, revision: number, error?: string) => Promise<void>;
  /** Boot an engine for this window ahead of the next open (no-op while one is open or already warm). */
  prewarm: () => Promise<void>;
  /** Drop this window's idle pre-booted engine. */
  releasePrewarm: () => Promise<void>;
  subscribe: (callback: (event: OfficeEvent) => void) => () => void;
};

declare global {
  interface Window {
    __offlineOffice?: OfflineOfficeApi;
  }
}
