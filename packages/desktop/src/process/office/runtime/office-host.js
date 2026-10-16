'use strict';
const canvas = document.getElementById('qtcanvas');
const host = window.__officeEngine;
let port,
  fileName,
  sequence = 0,
  modified = 0,
  saved = 0,
  timer,
  saving;
const pending = new Map();
window.addEventListener('error', (event) => host.error(event.message));
window.addEventListener('unhandledrejection', (event) => host.error(String(event.reason)));
var Module = {
  canvas,
  onAbort: (reason) => host.error(String(reason)),
  uno_scripts: ['./zeta.js', './office-thread.js'],
  locateFile: (path, prefix) => (prefix || '') + path,
  preRun: [
    () => {
      addRunDependency('onework-cjk-font');
      fetch('NotoSansCJKsc-Regular.otf')
        .then((response) => {
          if (!response.ok) throw new Error('CJK font unavailable');
          return response.arrayBuffer();
        })
        .then((bytes) => {
          FS.mkdirTree('/usr/share/fonts');
          FS.writeFile('/usr/share/fonts/NotoSansCJKsc-Regular.otf', new Uint8Array(bytes));
          removeRunDependency('onework-cjk-font');
        })
        .catch((error) => host.error(String(error)));
    },
  ],
};

function toBase64(bytes) {
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  }
  return btoa(chunks.join(''));
}

async function store() {
  const version = modified;
  const id = ++sequence;
  const stored = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  port.postMessage({ cmd: 'store', id });
  await stored;
  const bytes = FS.readFile(`/tmp/office/${fileName}`);
  // A previous store may have succeeded locally while persistence failed.
  // Always retry the retained bytes until the host acknowledges the save.
  await host.save(toBase64(bytes));
  saved = version;
}

async function flush() {
  clearTimeout(timer);
  while (modified > saved) {
    if (!saving)
      saving = store().finally(() => {
        saving = undefined;
      });
    await saving;
  }
}

host.onFlush((id) => {
  void flush()
    .then(() => host.flushed(id, true))
    .catch((error) => {
      host.error(String(error));
      host.flushed(id, false);
    });
});
host.onUnlock(() => port?.postMessage({ cmd: 'unlock', fileName }));
const inputBridge = window.__installOfficeInput(canvas);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });

const script = document.createElement('script');
script.src = 'soffice.js';
script.onerror = () => host.error('Office runtime could not be loaded');
script.onload = () => {
  Module.uno_main
    .then((workerPort) => {
      port = workerPort;
      port.onmessage = async (event) => {
        const data = event.data;
        try {
          if (data.cmd === 'running') {
            const document = await host.document();
            window.__officeDebug = document.debug === true;
            fileName = document.fileName;
            const bytes = Uint8Array.from(atob(document.base64), (character) => character.charCodeAt(0));
            FS.mkdirTree('/tmp/office');
            FS.writeFile(`/tmp/office/${fileName}`, bytes);
            port.postMessage({ cmd: 'load', fileName, readOnly: document.readOnly === true });
          } else if (data.cmd === 'ready') {
            window.dispatchEvent(new Event('resize'));
            canvas.style.visibility = 'visible';
            inputBridge.focus();
            host.ready();
          } else if (data.cmd === 'dirty') {
            modified += 1;
            host.dirty();
            clearTimeout(timer);
            timer = setTimeout(() => void flush().catch((error) => host.error(String(error))), 1200);
          } else if (data.cmd === 'stored') {
            pending.get(data.id)?.resolve(data);
            pending.delete(data.id);
          } else if (data.cmd === 'error') {
            pending.get(data.id)?.reject(new Error(data.message));
            pending.delete(data.id);
            host.error(data.message);
          }
        } catch (error) {
          host.error(String(error));
        }
      };
    })
    .catch((error) => host.error(String(error)));
};
document.body.appendChild(script);
