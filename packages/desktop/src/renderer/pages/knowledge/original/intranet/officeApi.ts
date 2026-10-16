import { httpRequest } from '@/common/adapter/httpBridge';

export type OfficeSession = { sessionId: string; scriptUrl: string; config: Record<string, unknown> };
export type OfficeSaved = { saved: boolean; revision: number; sourceVersion: string };
export const officeApi = {
  available: () =>
    httpRequest<{ enabled: boolean }>('GET', '/api/one/devops/office', undefined, { silentStatuses: [404] }),
  open: (id: string) =>
    httpRequest<OfficeSession>('POST', `/api/one/devops/rag/documents/${encodeURIComponent(id)}/office`, {}),
  flush: (id: string) =>
    httpRequest<OfficeSaved>(
      'POST',
      `/api/one/devops/office/sessions/${encodeURIComponent(id)}/flush`,
      {},
      { timeoutMs: 60000 }
    ),
};

type Editor = { destroyEditor: () => void };
type EditorApi = { DocEditor: new (id: string, config: Record<string, unknown>) => Editor };
declare global {
  interface Window {
    DocsAPI?: EditorApi;
  }
}
const scripts = new Map<string, Promise<EditorApi>>();
export function loadOfficeApi(url: string): Promise<EditorApi> {
  const cached = scripts.get(url);
  if (cached) return cached;
  const promise = new Promise<EditorApi>((resolve, reject) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid intranet Office URL');
    const script = document.createElement('script');
    script.src = parsed.href;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Intranet Office service unavailable'));
    }, 30000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.DocsAPI) resolve(window.DocsAPI);
      else reject(new Error('Intranet Office API unavailable'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Intranet Office service unavailable'));
    };
    document.head.appendChild(script);
  });
  scripts.set(url, promise);
  void promise.catch(() => scripts.delete(url));
  return promise;
}
