import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

const storageKey = 'knowledge-sidebar-width';
export const clampSidebarWidth = (width: number, container: number) =>
  Math.round(Math.max(200, Math.min(width, 460, Math.max(200, container - 480))));

export function useLibrarySidebar(names: string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState(1200);
  const [preferred, setPreferred] = useState<number | null>(() => {
    try {
      const value = Number(localStorage.getItem(storageKey));
      return value >= 200 && value <= 460 ? value : null;
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState<boolean | null>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const natural = Math.min(
    360,
    Math.max(
      250,
      ...names.map((name) => [...name].reduce((total, ch) => total + ((ch.codePointAt(0) ?? 0) > 127 ? 14 : 7), 64))
    )
  );
  // Reserve room for the document table before the saved sidebar width squeezes it.
  const compact = container < Math.max(760, (preferred ?? natural) + 680);
  useEffect(() => setOpen(null), [compact]);
  const collapsed = open === null ? compact : !open;
  const width = compact
    ? Math.min(preferred ?? natural, container - 48)
    : clampSidebarWidth(preferred ?? natural, container);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setContainer(entries[0].contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const save = (value: number | null) => {
    setPreferred(value);
    try {
      if (value === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(value));
    } catch {
      /* Layout remains usable without storage. */
    }
  };
  const resize = (value: number) => save(clampSidebarWidth(value, container));
  const separator = {
    role: 'separator' as const,
    tabIndex: collapsed || compact ? -1 : 0,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': 200,
    'aria-valuemax': Math.min(460, Math.max(200, container - 480)),
    'aria-valuenow': width,
    onDoubleClick: () => save(null),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        resize(width + (event.key === 'ArrowLeft' ? -20 : 20));
      } else if (event.key === 'Home') {
        event.preventDefault();
        save(null);
      }
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (drag.current) resize(drag.current.width + event.clientX - drag.current.x);
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
  return {
    ref,
    separator,
    collapsed,
    toggle: () => setOpen(collapsed),
    navigate: () => {
      if (compact) setOpen(false);
    },
    layout: {
      style: { '--library-sidebar-width': `${width}px` } as CSSProperties,
      'data-collapsed': collapsed,
      'data-compact': compact,
    },
  };
}
