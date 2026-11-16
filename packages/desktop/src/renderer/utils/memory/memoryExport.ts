/**
 * Copyright 2026 One Work
 */

/**
 * Everything the Memory page shows, as one Markdown document a person can keep or move.
 *
 * Memory is a pile of small files spread over several places (the built-in engine's per-project
 * folders, Claude's own memory, other coding agents' instruction files). Exporting means reading
 * them all and writing one readable file; nothing here touches the originals.
 */

export type MemoryExportFile = { name: string; filename: string; content: string; updatedAt?: number };

export type MemoryExportSection = {
  title: string;
  /** Where the files live, for the reader's orientation. */
  location?: string;
  files: MemoryExportFile[];
};

export type MemoryExportLabels = {
  title: string;
  exportedAt: string;
  updatedAt: string;
  empty: string;
};

const pad = (value: number): string => String(value).padStart(2, '0');

const formatDateTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * A fence long enough that the memory's own backtick fences cannot close it early, so a note that
 * itself contains a code block stays inside its section.
 */
const fenceFor = (content: string): string => {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
};

export function buildMemoryExportMarkdown(
  sections: MemoryExportSection[],
  labels: MemoryExportLabels,
  now: number = Date.now()
): string {
  const lines: string[] = [`# ${labels.title}`, '', `${labels.exportedAt}: ${formatDateTime(now)}`, ''];
  const filled = sections.filter((section) => section.files.length > 0);
  if (filled.length === 0) {
    lines.push(labels.empty, '');
    return lines.join('\n');
  }
  for (const section of filled) {
    lines.push(`## ${section.title}`, '');
    if (section.location) lines.push(`\`${section.location}\``, '');
    for (const file of section.files) {
      lines.push(`### ${file.name || file.filename}`, '');
      const meta = [
        file.filename !== file.name ? file.filename : '',
        file.updatedAt ? `${labels.updatedAt}: ${formatDateTime(file.updatedAt)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (meta) lines.push(`_${meta}_`, '');
      const fence = fenceFor(file.content);
      lines.push(`${fence}markdown`, file.content.replace(/\s+$/, ''), fence, '');
    }
  }
  return lines.join('\n');
}

export const memoryExportFileName = (now: number = Date.now()): string => {
  const d = new Date(now);
  return `one-work-memory-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.md`;
};
