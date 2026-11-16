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
      {sidebar.drawerOpen ? <div data-testid='scrim' onClick={sidebar.close} /> : null}
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
  it('uses an overlay before the directory squeezes the document columns', () => {
    render(<Sample />);
    act(() => observe?.([{ contentRect: { width: 900 } }]));
    expect(screen.getByTestId('layout').getAttribute('data-compact')).toBe('true');
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('true');
    act(() => observe?.([{ contentRect: { width: 1200 } }]));
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('false');
  });
  it('dims the documents while the directory floats over them, and closes on a click or Esc', () => {
    render(<Sample />);
    act(() => observe?.([{ contentRect: { width: 900 } }]));
    expect(screen.queryByTestId('scrim')).toBeNull();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(screen.getByTestId('scrim'));
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('true');
    expect(screen.queryByTestId('scrim')).toBeNull();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('scrim')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('true');
    expect(screen.queryByTestId('scrim')).toBeNull();
  });
  it('shows no scrim and ignores Esc when the directory sits beside the documents', () => {
    render(<Sample />);
    act(() => observe?.([{ contentRect: { width: 1400 } }]));
    expect(screen.getByTestId('layout').getAttribute('data-compact')).toBe('false');
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('false');
    expect(screen.queryByTestId('scrim')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('layout').getAttribute('data-collapsed')).toBe('false');
  });
  it('stops listening for Esc once the drawer is closed', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<Sample />);
    act(() => observe?.([{ contentRect: { width: 900 } }]));
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('scrim'));
    expect(remove.mock.calls.some(([type]) => type === 'keydown')).toBe(true);
    remove.mockRestore();
  });
});
