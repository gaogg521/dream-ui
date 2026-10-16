/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync('packages/desktop/src/process/office/runtime/office-input.js', 'utf8');
let canvas: HTMLCanvasElement;
let keys: string[];
let dispose: () => void;
beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.replaceChildren(canvas);
  keys = [];
  runInNewContext(source, { window, KeyboardEvent, performance, queueMicrotask });
  dispose = (
    window as unknown as { __installOfficeInput: (element: HTMLCanvasElement) => () => void }
  ).__installOfficeInput(canvas);
  canvas.addEventListener('keydown', (event) => keys.push(event.key));
});
afterEach(() => dispose());
describe('Office browser input bridge', () => {
  it('blocks file replacement shortcuts while preserving save and formatting shortcuts', () => {
    const proxy = document.querySelector('textarea')!;
    for (const key of ['o', 'n', 'w', 'q']) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      proxy.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    proxy.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(keys).toEqual([]);
    for (const key of ['s', 'b'])
      proxy.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(keys).toEqual(['s', 'b']);
  });
  it('forwards ordinary keyboard shortcuts from the DOM proxy to Qt', () => {
    const proxy = document.querySelector('textarea')!;
    proxy.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', code: 'End', ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(keys).toEqual(['End']);
  });
  it('commits Chinese composition once and does not insert intermediate text', () => {
    canvas.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    canvas.dispatchEvent(
      new InputEvent('beforeinput', {
        data: 'ni',
        inputType: 'insertCompositionText',
        isComposing: true,
        bubbles: true,
      })
    );
    expect(keys).toEqual([]);
    canvas.dispatchEvent(new CompositionEvent('compositionend', { data: '你好', bubbles: true }));
    canvas.dispatchEvent(
      new InputEvent('beforeinput', { data: '你好', inputType: 'insertText', bubbles: true, cancelable: true })
    );
    expect(keys).toEqual(['你', '好']);
  });
  it('supports accessibility text insertion and normalizes pasted line endings', () => {
    canvas.dispatchEvent(
      new InputEvent('beforeinput', { data: 'QA', inputType: 'insertText', bubbles: true, cancelable: true })
    );
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '甲\r\n乙' } });
    canvas.dispatchEvent(paste);
    expect(keys).toEqual(['Q', 'A', '甲', 'Enter', '乙']);
    expect(paste.defaultPrevented).toBe(true);
  });
  it('lets browser IME and paste defaults run without forwarding preedit or Ctrl+V into Qt', () => {
    const qt = vi.fn();
    canvas.addEventListener('keydown', qt, true);
    const composing = new KeyboardEvent('keydown', {
      key: 'Process',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(composing);
    const paste = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(paste);
    expect(qt).not.toHaveBeenCalled();
    expect(composing.defaultPrevented).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
  });
});
