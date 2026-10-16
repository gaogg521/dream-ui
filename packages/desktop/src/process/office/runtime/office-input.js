/** Bridge browser IME commits and paste to Qt 5's key-only WASM input path. */
'use strict';
window.__installOfficeInput = function (canvas) {
  // A canvas is a replaced element: Chrome cannot reliably host an IME
  // composition inside it. Keep a real DOM input focused and forward its
  // non-composing keys to Qt's canvas, while committing IME text only once.
  const proxy = canvas.ownerDocument.createElement('textarea');
  proxy.setAttribute('aria-label', 'Office document input');
  proxy.autocomplete = 'off';
  proxy.spellcheck = false;
  Object.assign(proxy.style, {
    position: 'fixed',
    opacity: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    resize: 'none',
    pointerEvents: 'none',
    left: '4px',
    top: '4px',
  });
  canvas.ownerDocument.body.appendChild(proxy);
  const focus = () => proxy.focus({ preventScroll: true });
  const mouse = (event) => {
    event.preventDefault();
    proxy.style.left = `${Math.min(window.innerWidth - 2, event.clientX)}px`;
    proxy.style.top = `${Math.min(window.innerHeight - 2, event.clientY)}px`;
    queueMicrotask(focus);
  };
  canvas.addEventListener('mousedown', mouse, true);

  let composing = false,
    lastCommit = '',
    lastCommitAt = 0;
  const deliver = (text) => {
    for (const character of text) {
      const key = character === '\n' ? 'Enter' : character === '\t' ? 'Tab' : character;
      // Qt 5 resolves its Qt::Key from DOM code, then uses key for Unicode text.
      const code =
        key === 'Enter' || key === 'Tab'
          ? key
          : /^[a-z]$/i.test(character)
            ? `Key${character.toUpperCase()}`
            : /^[0-9]$/.test(character)
              ? `Digit${character}`
              : character === ' '
                ? 'Space'
                : 'KeyA';
      for (const type of ['keydown', 'keyup'])
        canvas.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
    }
    proxy.value = '';
    canvas.textContent = '';
  };
  const keyboard = (event) => {
    if (
      ((event.ctrlKey || event.metaKey) &&
        (['o', 'n', 'w', 'q'].includes(event.key.toLowerCase()) ||
          (event.shiftKey && event.key.toLowerCase() === 's'))) ||
      (event.altKey && event.key === 'F4')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (
      event.key === 'Process' ||
      event.key === 'Unidentified' ||
      event.isComposing ||
      event.keyCode === 229 ||
      composing
    ) {
      event.stopImmediatePropagation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && event.type === 'keydown') {
      event.stopImmediatePropagation();
      return;
    }
    if (event.target !== proxy) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.dispatchEvent(
      new KeyboardEvent(event.type, {
        key: event.key,
        code:
          event.code ||
          (/^[a-z]$/i.test(event.key)
            ? `Key${event.key.toUpperCase()}`
            : /^[0-9]$/.test(event.key)
              ? `Digit${event.key}`
              : event.key.length === 1
                ? 'KeyA'
                : event.key),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        bubbles: true,
        cancelable: true,
      })
    );
  };
  const start = () => {
    composing = true;
  };
  const commit = (event) => {
    composing = false;
    lastCommit = event.data || '';
    lastCommitAt = performance.now();
    if (window.__officeDebug) console.debug(`[office-input] composition commit ${lastCommit.length}`);
    if (lastCommit) deliver(lastCommit);
  };
  const input = (event) => {
    if (event.isComposing || composing || event.inputType === 'insertCompositionText') return;
    const text = event.data || (['insertParagraph', 'insertLineBreak'].includes(event.inputType) ? '\n' : '');
    if (!text || !event.inputType.startsWith('insert')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (text !== lastCommit || performance.now() - lastCommitAt > 50) deliver(text);
  };
  const paste = (event) => {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (window.__officeDebug) console.debug(`[office-input] paste ${text.length}`);
    deliver(text.replace(/\r\n?/g, '\n'));
  };
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener('keyup', keyboard, true);
  window.addEventListener('compositionstart', start, true);
  window.addEventListener('compositionend', commit, true);
  window.addEventListener('beforeinput', input, true);
  window.addEventListener('paste', paste, true);
  const dispose = () => {
    window.removeEventListener('keydown', keyboard, true);
    window.removeEventListener('keyup', keyboard, true);
    window.removeEventListener('compositionstart', start, true);
    window.removeEventListener('compositionend', commit, true);
    window.removeEventListener('beforeinput', input, true);
    window.removeEventListener('paste', paste, true);
    canvas.removeEventListener('mousedown', mouse, true);
    proxy.remove();
  };
  dispose.focus = focus;
  return dispose;
};
