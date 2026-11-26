import { expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { deliveryPaths, deliveryParent, folderContains } from '@/renderer/pages/conversation/explorer/deliveryFolders';

it('collects assistant delivery references and successful writes, excluding user requests and reads', () => {
  const messages = [
    { type: 'text', position: 'right', content: { content: '`C:\\private\\source.txt`' } },
    {
      type: 'text',
      position: 'left',
      content: { content: '交付目录 `C:\\My Reports\\复核版\\`，文件 [报告](/tmp/output/report.md)。' },
    },
    { type: 'tool_call', content: { name: 'Write', status: 'completed', args: { file_path: 'C:\\out\\report.md' } } },
    { type: 'tool_call', content: { name: 'Read', status: 'completed', args: { file_path: 'C:\\private\\read.md' } } },
    { type: 'tool_call', content: { name: 'Write', status: 'error', args: { file_path: 'C:\\out\\failed.md' } } },
  ] as TMessage[];
  expect(deliveryPaths(messages)).toEqual(['C:\\My Reports\\复核版\\', '/tmp/output/report.md', 'C:\\out\\report.md']);
});

it('respects directory boundaries and Windows case while preserving POSIX case', () => {
  expect(folderContains('C:\\Out', 'c:/out/a.md')).toBe(true);
  expect(folderContains('C:\\Out', 'C:/outside/a.md')).toBe(false);
  expect(folderContains('/tmp/Out', '/tmp/out/a.md')).toBe(false);
  expect(deliveryParent('C:\\My Reports\\report.md')).toBe('C:/My Reports');
});

it('does not associate internal memory or agent configuration directories', () => {
  expect(
    deliveryPaths([
      {
        type: 'text',
        position: 'left',
        content: {
          content: '`C:/Users/test/.dream/memory/project.md` and `/home/test/.claude/settings.json`',
        },
      } as TMessage,
    ])
  ).toEqual([]);
});
