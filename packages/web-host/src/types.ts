// Core types for @dream/web-host (M3 interface contract, locked for M4-M8)

/**
 * App metadata injected by host environment (Electron or Node)
 */
export type AppMetadata = {
  version: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
};

/**
 * Backend binary resolver function injected by host environment
 */
export type BackendBinaryResolver = () => string;

/**
 * System dirs exported to the backend via AIONUI_{CACHE,WORK,LOG}_DIR env.
 * Backend surfaces these on `/api/system/info`. Omit and the backend inherits
 * process.env, which may carry stale values from the parent shell — better to
 * be explicit.
 */
export type BackendSystemDirs = {
  cacheDir: string;
  workDir: string;
  logDir: string;
};

/**
 * Options for starting WebHost
 */
export type WebHostOptions = {
  app: AppMetadata;
  staticDir: string;
  /**
   * Dev-only renderer dev-server origin. When set, renderer requests are
   * proxied there instead of read from `staticDir`. See
   * `StaticServerOptions.rendererDevServerUrl` for why this is needed.
   */
  rendererDevServerUrl?: string;
  /**
   * Extra request handlers forwarded to the static server. See
   * `StaticServerOptions.extraHandlers` — the desktop shell uses this to serve
   * generated media to browser clients under a policy only it can evaluate.
   */
  extraHandlers?: Array<
    (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean> | boolean
  >;
  /**
   * URL prefixes among `extraHandlers` that require a logged-in session. See
   * `StaticServerOptions.sessionGuardedPrefixes`.
   */
  sessionGuardedPrefixes?: string[];
  port?: number;
  allowRemote?: boolean;
  dataDir?: string;
  logDir?: string;
  dirs?: BackendSystemDirs;
  backend: { kind: 'ownBackend'; resolveBackend: BackendBinaryResolver } | { kind: 'useExistingBackend'; port: number };
};

/**
 * Handle returned by startWebHost
 */
export type WebHostHandle = {
  port: number;
  backendPort: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};
