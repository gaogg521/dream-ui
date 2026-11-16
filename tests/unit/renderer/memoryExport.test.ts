import { describe, expect, it } from 'vitest';
import {
  buildMemoryExportMarkdown,
  memoryExportFileName,
  type MemoryExportLabels,
} from '@/renderer/utils/memory/memoryExport';
import { translatePasswordRejection } from '@/renderer/utils/webui/passwordRejection';

const labels: MemoryExportLabels = {
  title: 'One Work memory export',
  exportedAt: 'Exported at',
  updatedAt: 'Updated',
  empty: 'There is no memory to export.',
};
// 2026-11-16 20:00 local time, whatever the machine's zone.
const NOW = new Date(2026, 10, 16, 20, 0).getTime();

describe('buildMemoryExportMarkdown', () => {
  it('writes every section and file, with where it lives and when it changed', () => {
    const md = buildMemoryExportMarkdown(
      [
        {
          title: 'Built-in assistant memory · Shared',
          location: 'C:\\data\\memory\\_shared',
          files: [
            { name: 'Prefers Chinese', filename: 'pref.md', content: 'Reply in Chinese.\n\n', updatedAt: NOW },
            { name: 'notes.md', filename: 'notes.md', content: 'plain' },
          ],
        },
        { title: 'Claude', files: [{ name: 'CLAUDE.md', filename: 'CLAUDE.md', content: 'be brief' }] },
      ],
      labels,
      NOW
    );
    expect(md).toContain('# One Work memory export');
    expect(md).toContain('Exported at: 2026-11-16 20:00');
    expect(md).toContain('## Built-in assistant memory · Shared');
    expect(md).toContain('`C:\\data\\memory\\_shared`');
    expect(md).toContain('### Prefers Chinese');
    expect(md).toContain('_pref.md · Updated: 2026-11-16 20:00_');
    expect(md).toContain('```markdown\nReply in Chinese.\n```');
    expect(md).toContain('## Claude');
    // A file whose name is its filename does not repeat itself in the meta line.
    expect(md).not.toContain('_notes.md');
  });

  it('skips sections with nothing in them, and says so when everything is empty', () => {
    const md = buildMemoryExportMarkdown(
      [
        { title: 'Empty one', files: [] },
        { title: 'Also empty', files: [] },
      ],
      labels,
      NOW
    );
    expect(md).not.toContain('## ');
    expect(md).toContain('There is no memory to export.');
  });

  it('keeps a memory that itself contains a code block inside its own section', () => {
    const inner = 'before\n```ts\nconst a = 1;\n```\nafter';
    const md = buildMemoryExportMarkdown(
      [{ title: 'S', files: [{ name: 'n', filename: 'n.md', content: inner }] }],
      labels,
      NOW
    );
    // The outer fence is longer than any fence in the content, so the inner one cannot close it.
    expect(md).toContain('````markdown\nbefore\n```ts\nconst a = 1;\n```\nafter\n````');
  });

  it('names the file by date', () => {
    expect(memoryExportFileName(NOW)).toBe('one-work-memory-20261116.md');
  });
});

describe('translatePasswordRejection', () => {
  const t = (key: string): string => `<${key.split('.').pop()}>`;

  it.each([
    ['Password is too common', '<passwordTooCommon>'],
    ['Password must not be the same character repeated', '<passwordTooCommon>'],
    ['Password must be at least 8 characters', '<passwordTooShort>'],
    ['Password must not exceed 128 characters', '<passwordTooLong>'],
    ['PASSWORD_TOO_COMMON', '<passwordTooCommon>'],
  ])('maps the backend sentence %j', (raw, expected) => {
    expect(translatePasswordRejection(raw, t)).toBe(expected);
  });

  it('joins several rules once each', () => {
    expect(translatePasswordRejection('Password is too common; Password must be at least 8 characters', t)).toBe(
      '<passwordTooCommon>; <passwordTooShort>'
    );
    expect(translatePasswordRejection('Password is too common; Password is too common', t)).toBe('<passwordTooCommon>');
  });

  it('returns nothing for an unrelated error so the caller can show the raw text', () => {
    expect(translatePasswordRejection('Network down', t)).toBe('');
    expect(translatePasswordRejection('', t)).toBe('');
  });
});
