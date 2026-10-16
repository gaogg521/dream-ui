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
};
const sessions = new Map<string, OfficeSession>();
let runtime: ReturnType<typeof startOfficeRuntime> | undefined;
const LIMIT = 100 * 1024 * 1024;

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
    async (event, request: { fileName: string; base64: string; bounds: OfficeBounds; readOnly?: boolean }) => {
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
      const bytes = Buffer.from(request.base64, 'base64');
      if (!bytes.length || bytes.length > LIMIT) throw new Error('Invalid Office file');
      runtime ??= startOfficeRuntime(
        app.isPackaged
          ? join(process.resourcesPath, 'offline-office')
          : join(app.getAppPath(), 'resources', 'offline-office')
      );
      const server = await runtime.catch((error) => {
        runtime = undefined;
        throw error;
      });
      if (owner.isDestroyed()) throw new Error('Application window closed');
      if ([...sessions.values()].some((session) => session.owner === owner))
        throw new Error('Office editor is already open');
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
      // Keep the isolated loading surface visible while Qt initializes rendering.
      view.setVisible(true);
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('console-message', (details) => {
        if (!app.isPackaged && details.message.startsWith('[office-input]')) console.debug(details.message);
        if (
          details.level === 'error' &&
          /Uncaught|Refused to|Failed to load|WebAssembly|SharedArrayBuffer|TypeError|ReferenceError|EvalError/.test(
            details.message
          )
        ) {
          console.error('[offline-office]', details.message.slice(0, 700));
          emit(session, { kind: 'error', message: details.message.slice(0, 300) });
        }
      });
      view.webContents.on('render-process-gone', () => {
        session.ready = false;
        session.view.setVisible(false);
        emit(session, { kind: 'error', message: 'Office editor stopped unexpectedly' });
      });
      view.webContents.on('will-navigate', (navigation, url) => {
        if (!url.startsWith(server.url)) navigation.preventDefault();
      });
      try {
        await view.webContents.loadURL(`${server.url}index.html`);
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
    const session = engine(event);
    const result = {
      fileName: session.fileName,
      base64: session.base64,
      readOnly: session.readOnly,
      debug: !app.isPackaged,
    };
    session.base64 = '';
    return result;
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
