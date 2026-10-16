export type OfficeBounds = { x: number; y: number; width: number; height: number };
export type OfficeEvent = {
  sessionId: string;
  kind: 'ready' | 'dirty' | 'save' | 'error';
  revision?: number;
  base64?: string;
  message?: string;
};
export type OfflineOfficeApi = {
  open: (request: {
    fileName: string;
    base64: string;
    bounds: OfficeBounds;
    readOnly?: boolean;
  }) => Promise<{ sessionId: string }>;
  unlock: (sessionId: string) => Promise<void>;
  bounds: (sessionId: string, bounds: OfficeBounds) => Promise<void>;
  visibility: (sessionId: string, visible: boolean) => Promise<string | null>;
  flush: (sessionId: string) => Promise<boolean>;
  close: (sessionId: string) => Promise<void>;
  acknowledge: (sessionId: string, revision: number, error?: string) => Promise<void>;
  subscribe: (callback: (event: OfficeEvent) => void) => () => void;
};

declare global {
  interface Window {
    __offlineOffice?: OfflineOfficeApi;
  }
}
