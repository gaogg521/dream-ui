const MAX_TEXT = 16 * 1024 * 1024;
const bounded = (text: string) => {
  if (new TextEncoder().encode(JSON.stringify(text)).length > MAX_TEXT - 1024)
    throw new Error('Extracted text exceeds limit');
  return text;
};
const builder = () => {
  const parts: string[] = [];
  let size = 0;
  const encoder = new TextEncoder();
  return {
    add(value: string) {
      size += encoder.encode(value).length;
      if (size > MAX_TEXT) throw new Error('Extracted text exceeds limit');
      parts.push(value);
    },
    text: () => bounded(parts.join('')),
  };
};

/** Extract locally; the original and retrieval text remain separate. */
export async function extractLibraryText(file: File): Promise<string | null> {
  if (/\.(md|markdown|txt|csv|tsv|json|html?)$/i.test(file.name)) {
    if (file.size > MAX_TEXT) throw new Error('Text exceeds limit');
    let text = await file.text();
    if (/\.html?$/i.test(file.name)) {
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      parsed.querySelectorAll('script,style').forEach((node) => node.remove());
      text = parsed.body.textContent ?? '';
    }
    return bounded(text);
  }
  if (/\.(docx|pptx)$/i.test(file.name)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(zip.files)
      .filter((name) =>
        /\.docx$/i.test(file.name)
          ? /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name)
          : /^ppt\/slides\/slide\d+\.xml$/.test(name)
      )
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const text = builder();
    for (const name of names) {
      const xml = await zip.file(name)!.async('string');
      if (xml.length > MAX_TEXT) throw new Error('XML exceeds limit');
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      if (parsed.querySelector('parsererror')) throw new Error('Invalid Office XML');
      const lines = Array.from(parsed.getElementsByTagNameNS('*', 'p')).map((paragraph) =>
        Array.from(paragraph.getElementsByTagNameNS('*', 't'))
          .map((node) => node.textContent ?? '')
          .join('')
      );
      text.add(lines.join('\n') + '\n');
    }
    return text.text();
  }
  if (/\.(xlsx?|xlsm)$/i.test(file.name)) {
    const { read, utils } = await import('xlsx-republish');
    const book = read(await file.arrayBuffer(), { cellHTML: false });
    const text = builder();
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      const cells = Object.keys(sheet)
        .filter((key) => /^[A-Z]+\d+$/.test(key))
        .map((key) => ({ key, ...utils.decode_cell(key) }))
        .sort((a, b) => a.r - b.r || a.c - b.c);
      text.add(name + '\n');
      let row = -1;
      for (const cell of cells) {
        text.add((cell.r === row ? '\t' : '\n') + utils.format_cell(sheet[cell.key]));
        row = cell.r;
      }
    }
    return text.text();
  }
  if (/\.pdf$/i.test(file.name)) {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
    const { PdfBinaryData } = await import('./pdfResources');
    const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    GlobalWorkerOptions.workerSrc = worker;
    const task = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
      BinaryDataFactory: PdfBinaryData,
    });
    try {
      const document = await task.promise;
      const text = builder();
      for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex++) {
        const page = await document.getPage(pageIndex);
        const content = await page.getTextContent();
        text.add(
          content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('') + '\n'
        );
        page.cleanup();
      }
      return text.text();
    } finally {
      await task.destroy();
    }
  }
  return null;
}
