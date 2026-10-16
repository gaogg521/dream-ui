import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__officeEngine', {
  document: () => ipcRenderer.invoke('office-engine:document'),
  ready: () => ipcRenderer.send('office-engine:ready'),
  dirty: () => ipcRenderer.send('office-engine:dirty'),
  save: (base64: string) => ipcRenderer.invoke('office-engine:save', base64),
  error: (message: string) => ipcRenderer.send('office-engine:error', message),
  unlocked: () => ipcRenderer.send('office-engine:unlocked'),
  onUnlock: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('office-engine:unlock', handler);
    return () => ipcRenderer.off('office-engine:unlock', handler);
  },
  flushed: (id: string, success: boolean) => ipcRenderer.send('office-engine:flushed', id, success),
  onFlush: (callback: (id: string) => void) => {
    const handler = (_event: unknown, id: string) => callback(id);
    ipcRenderer.on('office-engine:flush', handler);
    return () => ipcRenderer.off('office-engine:flush', handler);
  },
});
