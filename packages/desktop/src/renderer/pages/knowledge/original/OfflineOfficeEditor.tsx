import React, { useContext, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import type { OfficeEvent } from '@/common/types/offlineOffice';

type Props = {
  fileName: string;
  mime: string;
  load: () => Promise<Blob>;
  save: (file: File) => Promise<unknown>;
  registerBeforeLeave: (guard: (() => Promise<boolean>) | null) => void;
};
export default function OfflineOfficeEditor(props: Props) {
  const { t } = useTranslation();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const [canRetrySave, setCanRetrySave] = useState(false);
  const retrySave = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const api = window.__offlineOffice;
    if (!api || !container.current) return;
    let id: string | undefined,
      disposed = false;
    const queued: OfficeEvent[] = [];
    retrySave.current = async () => {
      if (!id || disposed) return;
      setStatus('saving');
      try {
        if (await api.flush(id)) {
          setStatus('saved');
          setError('');
          setCanRetrySave(false);
        } else setStatus('error');
      } catch (reason) {
        setStatus('error');
        setError(String(reason));
      }
    };
    const bounds = () => {
      const rect = container.current!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const handle = (event: OfficeEvent) => {
      if (!id) {
        queued.push(event);
        return;
      }
      if (event.sessionId !== id || disposed) return;
      if (event.kind === 'ready') {
        setStatus('ready');
        setError('');
      }
      if (event.kind === 'dirty') setStatus('saving');
      if (event.kind === 'error') {
        setStatus('error');
        setError(event.message ?? '');
      }
      if (event.kind === 'save' && event.revision !== undefined && event.base64) {
        const sessionId = id,
          revision = event.revision;
        setStatus('saving');
        const bytes = Uint8Array.from(atob(event.base64), (character) => character.charCodeAt(0));
        const file = new File([bytes], latest.current.fileName, { type: latest.current.mime });
        void latest.current
          .save(file)
          .then(async () => {
            await api.acknowledge(sessionId, revision);
            if (!disposed) {
              setStatus('saved');
              setError('');
              setCanRetrySave(false);
            }
          })
          .catch(async (reason: unknown) => {
            await api.acknowledge(sessionId, revision, String(reason));
            if (!disposed) {
              setStatus('error');
              setError(String(reason));
              setCanRetrySave(true);
            }
          });
      }
    };
    // HashRouter has no public async blocker. Defer its navigation methods
    // while this editor owns unsaved bytes, and restore them on cleanup.
    const navigationRestores: Array<() => void> = [];
    let navigating = false;
    for (const key of ['push', 'replace', 'go'] as const) {
      const original = navigator[key];
      const deferred = (...args: unknown[]) => {
        if (navigating) return;
        navigating = true;
        void (id ? api.flush(id) : Promise.resolve(true))
          .then((success) => {
            if (success && !disposed) (original as (...values: unknown[]) => void).apply(navigator, args);
          })
          .catch((reason: unknown) => {
            setStatus('error');
            setError(String(reason));
          })
          .finally(() => {
            navigating = false;
          });
      };
      navigator[key] = deferred;
      navigationRestores.push(() => {
        if (navigator[key] === deferred) navigator[key] = original as (typeof navigator)[typeof key];
      });
    }
    const unsubscribe = api.subscribe(handle);
    const resize = () => {
      if (id && !disposed && container.current) void api.bounds(id, bounds());
    };
    let visible = true;
    const updateVisibility = () => {
      if (!id || disposed || !container.current) return;
      const area = bounds();
      const overlap = Array.from(
        document.querySelectorAll('.arco-trigger-popup, .arco-modal-wrapper, .arco-drawer')
      ).some((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(node).visibility !== 'hidden' &&
          rect.right > area.x &&
          rect.left < area.x + area.width &&
          rect.bottom > area.y &&
          rect.top < area.y + area.height
        );
      });
      if (visible === !overlap) return;
      visible = !overlap;
      void api.visibility(id, visible).then((image) => {
        if (!disposed) setSnapshot(image);
      });
    };
    const popups = new MutationObserver(updateVisibility);
    popups.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    latest.current.registerBeforeLeave(async () => (id ? api.flush(id) : true));
    void latest.current
      .load()
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      )
      .then(async (base64) => {
        if (disposed) return;
        const opened = await api.open({ fileName: latest.current.fileName, base64, bounds: bounds() });
        id = opened.sessionId;
        if (disposed) {
          await api.close(id);
          return;
        }
        queued.splice(0).forEach(handle);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setStatus('error');
          setError(String(reason));
        }
      });
    return () => {
      disposed = true;
      retrySave.current = null;
      navigationRestores.forEach((restore) => restore());
      popups.disconnect();
      unsubscribe();
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
      latest.current.registerBeforeLeave(null);
      if (id) void api.close(id);
    };
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 500 }}>
      <div role='status' style={{ padding: '8px 16px' }}>
        {status === 'loading' ? (
          <Spin />
        ) : (
          t(
            `common.knowledgeLibrary.${status === 'error' ? 'saveFailed' : status === 'saving' ? 'saving' : status === 'saved' ? 'autoSaved' : 'autoSave'}`
          )
        )}
      </div>
      {error && (
        <Alert
          type='error'
          content={error}
          action={
            canRetrySave && (
              <Button loading={status === 'saving'} onClick={() => void retrySave.current?.()}>
                {t('common.retry')}
              </Button>
            )
          }
        />
      )}
      <div ref={container} style={{ flex: 1, minHeight: 450, position: 'relative' }}>
        {snapshot && (
          <img
            alt=''
            src={snapshot}
            style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'fill' }}
          />
        )}
      </div>
    </div>
  );
}
