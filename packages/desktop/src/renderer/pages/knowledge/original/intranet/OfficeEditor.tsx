import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadOfficeApi, officeApi } from './officeApi';

type Props = {
  documentId: string;
  /** Viewer-first unified open path: true renders ONLYOFFICE in view mode. */
  locked?: boolean;
  registerBeforeLeave: (guard: (() => Promise<boolean>) | null) => void;
  onSaved?: (sourceVersion: string) => Promise<void>;
};

export default function OfficeEditor(props: Props) {
  const { t, i18n } = useTranslation();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const elementId = `knowledge-office-${useId().replace(/:/g, '')}`;
  const latest = useRef(props);
  latest.current = props;
  const retry = useRef<(() => Promise<boolean>) | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [failureKind, setFailureKind] = useState<'originalLoadFailed' | 'saveFailed'>('originalLoadFailed');
  const sessionRef = useRef<{
    documentId: string;
    sessionId: string;
    scriptUrl: string;
    config: Record<string, unknown>;
  } | null>(null);
  useEffect(() => {
    setStatus('loading');
    setError('');
    let disposed = false,
      ready = false,
      engineDirty = false,
      generation = 0,
      revision = 0;
    let sessionId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let editor: { destroyEditor: () => void } | undefined;
    let saving: Promise<boolean> | undefined;
    const fail = (reason: unknown) => {
      if (!disposed) {
        setError(String(reason));
        setFailureKind(ready ? 'saveFailed' : 'originalLoadFailed');
        setStatus('error');
      }
    };
    const initializationTimer = setTimeout(() => fail(t('common.knowledgeLibrary.originalLoadFailed')), 60000);
    const flush = (): Promise<boolean> => {
      if (saving) return saving;
      if (!ready || !sessionId) return Promise.resolve(!engineDirty);
      clearTimeout(timer);
      saving = (async () => {
        setStatus('saving');
        // Wait for the editor to send its pending changes to the intranet server
        // before requesting the server-to-One Work force-save callback.
        let storedGeneration: number;
        do {
          for (let attempt = 0; engineDirty && attempt < 60 && !disposed; attempt++)
            await new Promise((resolve) => setTimeout(resolve, 250));
          if (engineDirty || disposed) throw new Error(t('common.knowledgeLibrary.saveFailed'));
          storedGeneration = generation;
          const result = await officeApi.flush(sessionId!);
          if (!result.saved) throw new Error(t('common.knowledgeLibrary.saveFailed'));
          if (result.revision > revision) {
            await latest.current.onSaved?.(result.sourceVersion);
            revision = result.revision;
          }
          // Typing can continue while the previous version is being persisted.
          // A leave guard must also flush that newer version before resolving.
        } while (storedGeneration !== generation || engineDirty);
        clearTimeout(timer);
        if (!disposed) {
          setError('');
          setStatus('saved');
        }
        return true;
      })()
        .catch((reason: unknown) => {
          fail(reason);
          return false;
        })
        .finally(() => {
          saving = undefined;
        });
      return saving;
    };
    retry.current = () => {
      if (ready) return flush();
      setAttempt((value) => value + 1);
      return Promise.resolve(false);
    };
    latest.current.registerBeforeLeave(flush);
    const restores: Array<() => void> = [];
    let navigating = false;
    for (const key of ['push', 'replace', 'go'] as const) {
      const original = navigator[key];
      const deferred = (...args: unknown[]) => {
        if (navigating) return;
        navigating = true;
        void flush()
          .then((saved) => {
            if (saved && !disposed) (original as (...values: unknown[]) => void).apply(navigator, args);
          })
          .finally(() => {
            navigating = false;
          });
      };
      navigator[key] = deferred;
      restores.push(() => {
        if (navigator[key] === deferred) navigator[key] = original as (typeof navigator)[typeof key];
      });
    }
    void (
      sessionRef.current?.documentId === props.documentId
        ? Promise.resolve(sessionRef.current)
        : officeApi.open(props.documentId).then((session) => {
            sessionRef.current = { documentId: props.documentId, ...session };
            return session;
          })
    )
      .then(async (session) => {
        if (disposed) return;
        sessionId = session.sessionId;
        const api = await loadOfficeApi(session.scriptUrl);
        if (disposed) return;
        const config = session.config as { editorConfig?: Record<string, unknown> };
        editor = new api.DocEditor(elementId, {
          ...session.config,
          editorConfig: {
            ...config.editorConfig,
            // Viewer-first: the session opens in view mode; 编辑 re-initializes
            // the same session in edit mode (mode is not part of the JWT).
            mode: props.locked === true ? 'view' : ((config.editorConfig?.mode as string) ?? 'edit'),
            // Follow the app UI language; ONLYOFFICE falls back to English for
            // locales its distribution does not ship.
            lang: /^[a-z]{2}(-[A-Z]{2,3})?$/.test(i18n.language) ? i18n.language : 'en',
          },
          events: {
            onDocumentReady: () => {
              if (!disposed) {
                clearTimeout(initializationTimer);
                ready = true;
                setError('');
                setStatus('ready');
              }
            },
            onDocumentStateChange: (event: { data: boolean }) => {
              engineDirty = event.data;
              if (event.data) generation += 1;
              if (disposed) return;
              setStatus('saving');
              clearTimeout(timer);
              timer = setTimeout(() => void flush(), 1500);
            },
            onError: () => fail(t('common.knowledgeLibrary.saveFailed')),
          },
        });
      })
      .catch(fail);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(initializationTimer);
      restores.forEach((restore) => restore());
      latest.current.registerBeforeLeave(null);
      retry.current = null;
      editor?.destroyEditor();
    };
  }, [props.documentId, props.locked, attempt]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 500 }}>
      <div role='status' style={{ padding: '8px 16px' }}>
        {status === 'loading' ? (
          <Spin />
        ) : props.locked === true && status === 'ready' ? (
          t('common.knowledgeLibrary.read')
        ) : (
          t(
            `common.knowledgeLibrary.${status === 'error' ? failureKind : status === 'saving' ? 'saving' : status === 'saved' ? 'autoSaved' : 'autoSave'}`
          )
        )}
      </div>
      {error && (
        <Alert
          type='error'
          content={error}
          action={
            <Button onClick={() => void retry.current?.()} loading={status === 'saving'}>
              {t('common.retry')}
            </Button>
          }
        />
      )}
      <div style={{ flex: 1, minHeight: 450 }}>
        <div id={elementId} style={{ height: '100%' }} />
      </div>
    </div>
  );
}
