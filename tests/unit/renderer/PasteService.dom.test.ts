import { describe, expect, it, vi } from 'vitest';
import { FileService } from '@/renderer/services/FileService';
import { PasteService } from '@/renderer/services/PasteService';

function pasteEvent(files: File[]) {
  return {
    stopPropagation: vi.fn(),
    clipboardData: { files, getData: () => 'file name' },
  } as unknown as ClipboardEvent;
}

describe('file clipboard uploads', () => {
  it('passes original files to the attachment uploader without reading them in the paste handler', async () => {
    const pdf = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });
    const sheet = new File(['rows'], 'table.csv', { type: 'text/csv' });
    const read = vi.spyOn(pdf, 'arrayBuffer').mockRejectedValue(new Error('eager clipboard read failed'));
    const attachments = [
      { name: pdf.name, path: '/managed/report.pdf', size: pdf.size, type: pdf.type, lastModified: 0 },
    ];
    const upload = vi.spyOn(FileService, 'processDroppedFiles').mockResolvedValue(attachments);
    const onFiles = vi.fn();
    const onText = vi.fn();
    try {
      expect(await PasteService.handlePaste(pasteEvent([pdf, sheet]), [], onFiles, onText, 'c1')).toBe(true);
      expect(upload).toHaveBeenCalledWith([pdf, sheet], 'c1', 'sendbox');
      expect(upload.mock.calls[0][0][0]).toBe(pdf);
      expect(read).not.toHaveBeenCalled();
      expect(onFiles).toHaveBeenCalledWith(attachments);
      expect(onText).not.toHaveBeenCalled();
    } finally {
      upload.mockRestore();
      read.mockRestore();
    }
  });

  it('keeps generated clipboard image names and filters unsupported files', async () => {
    const image = new File(['png'], 'image.png', { type: 'image/png' });
    const document = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });
    const upload = vi.spyOn(FileService, 'processDroppedFiles').mockResolvedValue([]);
    try {
      await PasteService.handlePaste(
        pasteEvent([image, document]),
        ['.png'],
        vi.fn(),
        undefined,
        undefined,
        'sendbox',
        {
          next: () => 2,
        }
      );
      const [files] = upload.mock.calls[0];
      expect(Array.from(files, (file) => file.name)).toEqual(['image-2.png']);
      expect(files[0].type).toBe('image/png');
    } finally {
      upload.mockRestore();
    }
  });
});
