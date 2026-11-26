import type { TMessage } from '@/common/chat/chatLib';
import { resolveLocalFileLinkPath } from '@/renderer/components/Markdown/markdownUtils';

/** Only assistant references and successful file writes can identify deliveries. */
export function deliveryPaths(messages: TMessage[]): string[] {
  const paths = new Set<string>();
  for (const message of messages) {
    if (
      message.type === 'tool_call' &&
      message.content.status === 'completed' &&
      /^(write|edit|write_file|edit_file)$/i.test(message.content.name)
    ) {
      const args = message.content.input ?? message.content.args;
      const path = args?.file_path ?? args?.path;
      if (typeof path === 'string') {
        const resolved = resolveLocalFileLinkPath(path);
        if (resolved) paths.add(resolved);
      }
    }
    if (message.type !== 'text' || message.position !== 'left') continue;
    const text = message.content.content;
    if (typeof text !== 'string') continue;
    // Quoted paths preserve spaces. Bare paths stop at prose/Markdown boundaries.
    const candidates = text.matchAll(
      /`([^`\r\n]+)`|\]\(([^\r\n]+?)\)|((?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|private|var|mnt|Volumes)\/)[^\s`<>"'，。；）)]+)/gu
    );
    for (const match of candidates) {
      const path = resolveLocalFileLinkPath((match[1] ?? match[2] ?? match[3]).trim());
      if (path) paths.add(path);
    }
  }
  return [...paths].filter((path) => !/(?:^|[\\/])(?:memory|memories|\.dream|\.claude|\.codex)(?:[\\/]|$)/i.test(path));
}

export const deliveryParent = (path: string): string =>
  path
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/[^/]+$/, '');

export function folderContains(folder: string, path: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const root = normalize(folder);
  const candidate = normalize(path);
  return candidate === root || candidate.startsWith(root + '/');
}
