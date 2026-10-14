import React from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampSidebarWidth,
  useLibrarySidebar,
} from '../../../packages/desktop/src/renderer/pages/knowledge/useLibrarySidebar';

let observe: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
function Sample() {
  const sidebar = useLibrarySidebar(['团队知识库']);
  return (
    <div ref={sidebar.ref} {...sidebar.layout} data-testid='layout'>
      <div {...sidebar.separator} aria-label='resize' />
      <button onClick={sidebar.toggle}>toggle</button>
    </div>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: typeof observe) {
        observe = cb;
      }
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('knowledge directory layout', () => {
  it('reserves reading space and bounds the directory width', () => {
    expect(clampSidebarWidth(600, 1200)).toBe(460);
    expect(clampSidebarWidth(400, 800)).toBe(320);
    expect(clampSidebarWidth(50, 1200)).toBe(200);
  });
  it('supports keyboard resizing, persistence and reset', () => {
    render(<Sample />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(localStorage.getItem('knowledge-sidebar-width')).toBe('270');
    cleanup();
    render(<Sample />);
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('270');
    fireEvent.doubleClick(screen.getByRole('separator'));
    expect(localStorage.getItem('knowledge-sidebar-width')).toBeNull();
  });
  it('automatically hides in narrow containers and lets users reopen it', () => {
    render(<Sample />);
    act(() => observe?.([{ contentRect: { width: 600 } }]));
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('false');
  });
});
