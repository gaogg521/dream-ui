// Bundle CJK character maps and standard fonts locally; never fetch PDF assets from a third party.
const resources = import.meta.glob<string>('../../../../../../../node_modules/pdfjs-dist/{cmaps,standard_fonts}/*', {
  eager: true,
  exhaustive: true,
  query: '?url',
  import: 'default',
});
const byName = new Map(Object.entries(resources).map(([path, url]) => [path.split('/').at(-1)!, url]));
export class PdfBinaryData {
  async fetch({ filename }: { filename: string }) {
    const url = byName.get(filename) ?? byName.get(`${filename}.bcmap`);
    if (!url) throw new Error('PDF resource unavailable');
    const response = await fetch(url);
    if (!response.ok) throw new Error('PDF resource unavailable');
    return new Uint8Array(await response.arrayBuffer());
  }
}
