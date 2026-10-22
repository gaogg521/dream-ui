import { app, BrowserWindow, ipcMain, WebContentsView, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import type { OfficeBounds, OfficeEvent } from '@/common/types/offlineOffice';
import { startOfficeRuntime } from './runtimeServer';

type OfficeSession = {
  id: string;
  owner: BrowserWindow;
  view: WebContentsView;
  fileName: string;
  base64: string;
  readOnly: boolean;
  revision: number;
  ready: boolean;
  visible: boolean;
  closing: boolean;
  acknowledgements: Map<number, { resolve: () => void; reject: (error: Error) => void }>;
  flushes: Map<string, (success: boolean) => void>;
  onClosed: () => void;
  onClose: (event: Electron.Event) => void;
  /** Milestones of this open, for the timing line logged when the document is ready. */
  timing: {
    started: number;
    runtime?: number;
    page?: number;
    booted?: number;
    bytes: number;
    warm?: boolean;
    logged?: boolean;
  };
};
const sessions = new Map<string, OfficeSession>();
let runtime: ReturnType<typeof startOfficeRuntime> | undefined;
const LIMIT = 100 * 1024 * 1024;

/**
 * An engine booted ahead of time for one window. Booting (WASM instantiation, UNO bootstrap) is ~4.5 s of every
 * ~9 s open and does not depend on the document, so it runs while the user is still browsing the library; the
 * engine then waits in `office-engine:document` until an open claims it. Idle engines cost ~1 GB, hence the TTL.
 */
type WarmEngine = {
  owner: BrowserWindow;
  view: WebContentsView;
  /** Pending `office-engine:document` reply once the engine has booted. */
  deliver?: (session: OfficeSession) => void;
  timer: NodeJS.Timeout;
  onClosed: () => void;
};
const warmEngines = new Map<number, WarmEngine>();
const WARM_ENGINE_TTL_MS = 5 * 60 * 1000;

function ensureRuntime(): Promise<{ url: string; close: () => Promise<void> }> {
  runtime ??= startOfficeRuntime(
    app.isPackaged
      ? join(process.resourcesPath, 'offline-office')
      : join(app.getAppPath(), 'resources', 'offline-office')
  );
  return runtime.catch((error) => {
    runtime = undefined;
    throw error;
  });
}

function createEngineView(serverUrl: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/office.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:offline-office',
      backgroundThrottling: false,
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (navigation, url) => {
    if (!url.startsWith(serverUrl)) navigation.preventDefault();
  });
  view.webContents.on('console-message', (details) => {
    if (!app.isPackaged && details.message.startsWith('[office-input]')) console.debug(details.message);
    if (
      details.level === 'error' &&
      /Uncaught|Refused to|Failed to load|WebAssembly|SharedArrayBuffer|TypeError|ReferenceError|EvalError/.test(
        details.message
      )
    ) {
      console.error('[offline-office]', details.message.slice(0, 700));
      const session = sessionOf(view);
      if (session) emit(session, { kind: 'error', message: details.message.slice(0, 300) });
    }
  });
  view.webContents.on('render-process-gone', () => {
    const warm = [...warmEngines.values()].find((engine) => engine.view === view);
    if (warm) discardWarm(warm);
    const session = sessionOf(view);
    if (!session) return;
    session.ready = false;
    session.view.setVisible(false);
    emit(session, { kind: 'error', message: 'Office editor stopped unexpectedly' });
  });
  return view;
}

function sessionOf(view: WebContentsView): OfficeSession | undefined {
  return [...sessions.values()].find((session) => session.view === view);
}

function discardWarm(warm: WarmEngine): void {
  if (warmEngines.get(warm.owner.id) !== warm) return;
  warmEngines.delete(warm.owner.id);
  clearTimeout(warm.timer);
  if (!warm.owner.isDestroyed()) warm.owner.removeListener('closed', warm.onClosed);
  if (!warm.view.webContents.isDestroyed()) warm.view.webContents.close();
}

/** Hand the window's warm engine to an open, or undefined when there is none. */
function claimWarm(owner: BrowserWindow): WarmEngine | undefined {
  const warm = warmEngines.get(owner.id);
  if (!warm || warm.view.webContents.isDestroyed()) return undefined;
  warmEngines.delete(owner.id);
  clearTimeout(warm.timer);
  owner.removeListener('closed', warm.onClosed);
  return warm;
}

async function prewarm(owner: BrowserWindow): Promise<void> {
  const existing = warmEngines.get(owner.id);
  if (existing) {
    // Still wanted: push the expiry back.
    existing.timer.refresh();
    return;
  }
  const server = await ensureRuntime();
  if (owner.isDestroyed() || warmEngines.has(owner.id)) return;
  const view = createEngineView(server.url);
  // Lay the canvas out at the window's size; an open moves it to the editor's real bounds.
  const [width, height] = owner.getContentSize();
  view.setBounds({ x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) });
  const warm: WarmEngine = {
    owner,
    view,
    timer: setTimeout(() => discardWarm(warm), WARM_ENGINE_TTL_MS),
    onClosed: () => discardWarm(warm),
  };
  warmEngines.set(owner.id, warm);
  owner.on('closed', warm.onClosed);
  try {
    await view.webContents.loadURL(`${server.url}index.html`);
  } catch (error) {
    discardWarm(warm);
    throw error;
  }
}

function documentFor(session: OfficeSession) {
  session.timing.booted = Date.now() - session.timing.started;
  const result = {
    fileName: session.fileName,
    base64: session.base64,
    readOnly: session.readOnly,
    debug: !app.isPackaged,
  };
  session.base64 = '';
  return result;
}

function emit(session: OfficeSession, event: Omit<OfficeEvent, 'sessionId'>): void {
  if (!session.owner.webContents.isDestroyed()) {
    session.owner.webContents.send('offline-office:event', { ...event, sessionId: session.id });
  }
}

function owned(event: IpcMainInvokeEvent, id: string): OfficeSession {
  const session = sessions.get(id);
  if (!session || session.owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Office session does not belong to this window');
  }
  return session;
}

function engine(event: Electron.IpcMainEvent | IpcMainInvokeEvent): OfficeSession {
  const session = [...sessions.values()].find((item) => item.view.webContents === event.sender);
  if (!session || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown Office engine');
  return session;
}

function setBounds(session: OfficeSession, bounds: OfficeBounds): void {
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    throw new Error('Invalid Office view bounds');
  const zoom = session.owner.webContents.getZoomFactor();
  const [width, height] = session.owner.getContentSize();
  const x = Math.max(0, Math.min(width - 1, Math.round(bounds.x * zoom)));
  const y = Math.max(0, Math.min(height - 1, Math.round(bounds.y * zoom)));
  session.view.setBounds({
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(bounds.width * zoom))),
    height: Math.max(1, Math.min(height - y, Math.round(bounds.height * zoom))),
  });
}

function dispose(session: OfficeSession): void {
  if (!sessions.delete(session.id)) return;
  session.owner.removeListener('closed', session.onClosed);
  session.owner.removeListener('close', session.onClose);
  if (!session.owner.isDestroyed()) session.owner.contentView.removeChildView(session.view);
  for (const pending of session.acknowledgements.values()) pending.reject(new Error('Office session closed'));
  for (const resolve of session.flushes.values()) resolve(false);
  if (!session.view.webContents.isDestroyed()) session.view.webContents.close();
  session.base64 = '';
}

async function flush(session: OfficeSession): Promise<boolean> {
  if (!session.ready) return session.acknowledgements.size === 0;
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.flushes.delete(id);
      emit(session, { kind: 'error', message: 'Office save timed out' });
      resolve(false);
    }, 30000);
    session.flushes.set(id, (success) => {
      clearTimeout(timer);
      session.flushes.delete(id);
      resolve(success);
    });
    session.view.webContents.send('office-engine:flush', id);
  });
}

export function initOfflineOffice(): void {
  ipcMain.handle(
    'offline-office:open',
    async (
      event,
      request: { fileName: string; base64: string; bounds: OfficeBounds; readOnly?: boolean; hideUntilReady?: boolean }
    ) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || event.senderFrame !== event.sender.mainFrame)
        throw new Error('Office requires an application window');
      if ([...sessions.values()].some((session) => session.owner === owner))
        throw new Error('Office editor is already open');
      if (
        !request?.bounds ||
        ![request.bounds.x, request.bounds.y, request.bounds.width, request.bounds.height].every(Number.isFinite) ||
        request.bounds.width <= 0 ||
        request.bounds.height <= 0
      )
        throw new Error('Invalid Office view bounds');
      const extension = extname(request.fileName).toLowerCase();
      if (!['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.odt', '.ods', '.odp'].includes(extension)) {
        throw new Error('Unsupported Office format');
      }
      if (typeof request.base64 !== 'string' || request.base64.length > Math.ceil(LIMIT / 3) * 4) {
        throw new Error('Office file is too large');
      }
      const started = Date.now();
      const bytes = Buffer.from(request.base64, 'base64');
      if (!bytes.length || bytes.length > LIMIT) throw new Error('Invalid Office file');
      const server = await ensureRuntime();
      const runtimeReady = Date.now();
      if (owner.isDestroyed()) throw new Error('Application window closed');
      if ([...sessions.values()].some((session) => session.owner === owner))
        throw new Error('Office editor is already open');
      const warm = claimWarm(owner);
      const view = warm?.view ?? createEngineView(server.url);
      const session: OfficeSession = {
        id: randomUUID(),
        owner,
        view,
        fileName: `document${extension}`,
        base64: request.base64,
        readOnly: request.readOnly === true,
        revision: 0,
        ready: false,
        visible: true,
        closing: false,
        acknowledgements: new Map(),
        flushes: new Map(),
        timing: { started, runtime: runtimeReady - started, bytes: bytes.length, warm: Boolean(warm) },
        onClosed: () => dispose(session),
        onClose: (closeEvent) => {
          if (closeEvent.defaultPrevented) {
            void flush(session);
            return;
          }
          closeEvent.preventDefault();
          if (session.closing) return;
          session.closing = true;
          void flush(session).then((success) => {
            session.closing = false;
            if (success && !owner.isDestroyed()) {
              dispose(session);
              owner.close();
            }
          });
        },
      };
      sessions.set(session.id, session);
      owner.on('closed', session.onClosed);
      owner.on('close', session.onClose);
      owner.contentView.addChildView(view);
      setBounds(session, request.bounds);
      // Keep the isolated loading surface visible while Qt initializes rendering — unless the renderer has a
      // snapshot of this document to show meanwhile, which the engine view would cover.
      view.setVisible(request.hideUntilReady !== true);
      if (warm) {
        // Already loaded (and maybe booted): hand it the document now if it is waiting for one; otherwise its
        // document request finds this session when the boot completes.
        session.timing.page = 0;
        warm.deliver?.(session);
        return { sessionId: session.id };
      }
      try {
        await view.webContents.loadURL(`${server.url}index.html`);
        session.timing.page = Date.now() - started;
      } catch (error) {
        dispose(session);
        throw error;
      }
      return { sessionId: session.id };
    }
  );
  ipcMain.handle('offline-office:bounds', (event, id: string, bounds: OfficeBounds) =>
    setBounds(owned(event, id), bounds)
  );
  ipcMain.handle('offline-office:visibility', async (event, id: string, visible: boolean) => {
    const session = owned(event, id);
    session.visible = visible === true;
    const snapshot =
      !session.visible && session.ready ? (await session.view.webContents.capturePage()).toDataURL() : null;
    session.view.setVisible(session.visible && session.ready);
    return snapshot;
  });
  ipcMain.handle('offline-office:flush', (event, id: string) => flush(owned(event, id)));
  ipcMain.handle('offline-office:unlock', (event, id: string) => {
    const session = owned(event, id);
    session.readOnly = false;
    session.view.webContents.send('office-engine:unlock');
  });
  ipcMain.handle('offline-office:dispatch', (event, id: string, command: string) => {
    const session = owned(event, id);
    if (!/^[A-Za-z0-9_.]+$/.test(command)) throw new Error('Unsupported Office command');
    session.view.webContents.send('office-engine:dispatch', command);
  });
  ipcMain.handle('offline-office:close', (event, id: string) => dispose(owned(event, id)));
  ipcMain.handle('offline-office:acknowledge', (event, id: string, revision: number, error?: string) => {
    const pending = owned(event, id).acknowledgements.get(revision);
    if (error) pending?.reject(new Error(error));
    else pending?.resolve();
  });
  ipcMain.handle('office-engine:document', (event) => {
    const warm = [...warmEngines.values()].find((engine) => engine.view.webContents === event.sender);
    if (warm && event.senderFrame === event.sender.mainFrame) {
      // Booted ahead of an open: park until one claims this engine.
      return new Promise<ReturnType<typeof documentFor>>((resolve) => {
        warm.deliver = (session) => resolve(documentFor(session));
      });
    }
    return documentFor(engine(event));
  });
  ipcMain.handle('offline-office:prewarm', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    // A window may hold one warm engine next to its open one: unlocking for editing and opening the next
    // document both start from a fresh engine.
    if (!owner || event.senderFrame !== event.sender.mainFrame) return;
    await prewarm(owner);
  });
  ipcMain.handle('offline-office:release-prewarm', (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const warm = owner ? warmEngines.get(owner.id) : undefined;
    if (warm && event.senderFrame === event.sender.mainFrame) discardWarm(warm);
  });
  const engineEvent = (event: Electron.IpcMainEvent): OfficeSession | undefined => {
    try {
      return engine(event);
    } catch {
      return undefined;
    }
  };
  ipcMain.on('office-engine:ready', (event) => {
    const session = engineEvent(event);
    if (!session) return;
    session.ready = true;
    session.view.setVisible(session.visible);
    if (!session.timing.logged) {
      // Where an open spends its time: runtime start (asset verification on the first open), page load, engine
      // boot, then the document itself.
      session.timing.logged = true;
      const { started, runtime: runtimeMs, page, booted, bytes, warm } = session.timing;
      console.info(
        `[offline-office] document ready in ${Date.now() - started}ms (runtime ${runtimeMs}ms, page ${page ?? '?'}ms, ` +
          `engine boot ${booted ?? '?'}ms${warm ? ' (prewarmed)' : ''}, ${Math.round(bytes / 1024)} KiB, ${session.fileName})`
      );
      // Once the first screen has painted, hand the renderer a picture of it for the next open of this document.
      setTimeout(() => {
        if (!sessions.has(session.id) || !session.ready || !session.visible) return;
        void session.view.webContents
          .capturePage()
          .then((image) => {
            if (sessions.has(session.id) && !image.isEmpty()) {
              emit(session, {
                kind: 'snapshot',
                image: `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`,
              });
            }
          })
          .catch(() => {});
      }, 4000);
    }
    emit(session, { kind: 'ready' });
  });
  ipcMain.on('office-engine:dirty', (event) => {
    const session = engineEvent(event);
    if (session) emit(session, { kind: 'dirty' });
  });
  ipcMain.on('office-engine:error', (event, message: string) => {
    const session = engineEvent(event);
    if (session) emit(session, { kind: 'error', message: String(message).slice(0, 300) });
  });
  ipcMain.on('office-engine:flushed', (event, id: string, success: boolean) =>
    engineEvent(event)?.flushes.get(id)?.(success === true)
  );
  ipcMain.handle('office-engine:save', async (event, base64: string) => {
    const session = engine(event);
    if (typeof base64 !== 'string' || base64.length > Math.ceil(LIMIT / 3) * 4)
      throw new Error('Office file is too large');
    const revision = ++session.revision;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Office persistence timed out')), 30000);
        session.acknowledgements.set(revision, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        emit(session, { kind: 'save', revision, base64 });
      });
    } finally {
      session.acknowledgements.delete(revision);
    }
  });
}
