import { describe, expect, it, vi } from 'vitest';

// 采集层在模块加载时就 import 了 ipcBridge（默认 deps 指向它），node 环境下不要真的把
// HTTP 桥接拉起来；所有测试都注入自己的 deps。
vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessages: { invoke: vi.fn() } },
    fs: { getImageBase64: { invoke: vi.fn() } },
  },
}));

import type { TMessage } from '@/common/chat/chatLib';
import {
  collectImageRefs,
  collectTeamTranscript,
  fetchMemberMessages,
  type TranscriptDeps,
  type TranscriptMemberInput,
} from '@/renderer/pages/team/export/collectTeamTranscript';
import { renderTeamTranscriptHtml } from '@/renderer/pages/team/export/renderTeamTranscriptHtml';
import { diffLines, renderTranscriptMessage } from '@/renderer/pages/team/export/renderTranscriptMessage';
import { buildTranscriptLabels, fillLabel } from '@/renderer/pages/team/export/transcriptLabels';
import { escapeHtml, renderMarkdown } from '@/renderer/pages/team/export/transcriptMarkdown';
import type { TranscriptEntry, TranscriptMember } from '@/renderer/pages/team/export/teamTranscriptTypes';

const labels = buildTranscriptLabels((_key, options) => options.defaultValue);
const markdownCtx = { images: {}, imageMissingLabel: labels.imageMissing };

const textMessage = (id: string, content: string, createdAt?: number, extra?: Partial<TMessage>): TMessage =>
  ({
    id,
    conversation_id: 'c1',
    type: 'text',
    content: { content },
    position: 'left',
    created_at: createdAt,
    ...extra,
  }) as TMessage;

const page = (items: TMessage[], hasMoreBefore: boolean, oldestCursor: string | null) => ({
  items,
  oldest_cursor: oldestCursor,
  newest_cursor: 'newest',
  has_more_before: hasMoreBefore,
  has_more_after: false,
});

const member = (overrides: Partial<TranscriptMember> = {}): TranscriptMember => ({
  slot_id: 'slot-a',
  conversation_id: 'c1',
  name: 'Claude Code',
  backend: 'claude',
  isLeader: true,
  color: '#2f6fed',
  messageCount: 1,
  truncated: false,
  ...overrides,
});

const entry = (message: TMessage, overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  id: message.id,
  slot_id: 'slot-a',
  sortAt: message.created_at ?? 0,
  createdAt: message.created_at,
  message,
  ...overrides,
});

describe('fetchMemberMessages', () => {
  it('walks the cursor backwards and returns oldest-first', async () => {
    const pages = [
      page([textMessage('m3', 'third', 3)], true, 'cursor-2'),
      page([textMessage('m2', 'second', 2)], true, 'cursor-1'),
      page([textMessage('m1', 'first', 1)], false, null),
    ];
    let call = 0;
    const deps: TranscriptDeps = {
      getMessages: vi.fn(async () => pages[call++]),
      getImageDataUrl: vi.fn(async () => null),
    };

    const result = await fetchMemberMessages('c1', deps);

    expect(result.truncated).toBe(false);
    expect(result.messages.map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
    expect(deps.getMessages).toHaveBeenCalledTimes(3);
  });

  it('skips hidden and available_commands messages, and dedupes repeated ids', async () => {
    const hidden = textMessage('h1', 'injected', 1, { hidden: true });
    const commands = {
      id: 'ac1',
      conversation_id: 'c1',
      type: 'available_commands',
      content: { commands: [] },
      created_at: 2,
    } as unknown as TMessage;
    const deps: TranscriptDeps = {
      getMessages: vi.fn(async () =>
        page([hidden, commands, textMessage('m1', 'visible', 3), textMessage('m1', 'duplicate', 3)], false, null)
      ),
      getImageDataUrl: vi.fn(async () => null),
    };

    const result = await fetchMemberMessages('c1', deps);

    expect(result.messages.map((message) => message.id)).toEqual(['m1']);
  });

  it('stops and reports truncation when the cursor stops advancing', async () => {
    const deps: TranscriptDeps = {
      getMessages: vi.fn(async () => page([textMessage('m1', 'stuck', 1)], true, 'same-cursor')),
      getImageDataUrl: vi.fn(async () => null),
    };

    const result = await fetchMemberMessages('c1', deps);

    expect(result.truncated).toBe(true);
    // 第一页把游标设成 same-cursor，第二页发现没推进就停 —— 不能无限翻页。
    expect(deps.getMessages).toHaveBeenCalledTimes(2);
  });
});

describe('collectTeamTranscript', () => {
  const members: TranscriptMemberInput[] = [
    { slot_id: 'leader', conversation_id: 'c-leader', name: 'Leader', backend: 'claude', isLeader: true, color: '#1' },
    { slot_id: 'mate', conversation_id: 'c-mate', name: 'Mate', backend: 'codex', isLeader: false, color: '#2' },
  ];

  const depsFor = (byConversation: Record<string, TMessage[]>): TranscriptDeps => ({
    getMessages: vi.fn(async ({ conversation_id }) => page(byConversation[conversation_id] ?? [], false, null)),
    getImageDataUrl: vi.fn(async () => null),
  });

  it('merges every member into one ascending timeline', async () => {
    const transcript = await collectTeamTranscript({
      team: { id: 't1', name: 'Team' },
      members,
      includeImages: false,
      exportedAt: 1000,
      deps: depsFor({
        'c-leader': [textMessage('l1', 'plan', 10), textMessage('l2', 'dispatch', 30)],
        'c-mate': [textMessage('m1', 'ack', 20)],
      }),
    });

    expect(transcript.entries.map((item) => item.id)).toEqual(['l1', 'm1', 'l2']);
    expect(transcript.members.map((item) => item.messageCount)).toEqual([2, 1]);
    expect(transcript.notes).toEqual([]);
  });

  it('keeps member-internal order when created_at is missing', async () => {
    const transcript = await collectTeamTranscript({
      team: { id: 't1', name: 'Team' },
      members: [members[0]],
      includeImages: false,
      exportedAt: 1000,
      deps: depsFor({
        'c-leader': [
          textMessage('a', 'first', 5),
          textMessage('b', 'no timestamp'),
          textMessage('c', 'still after b'),
          textMessage('d', 'later', 9),
        ],
      }),
    });

    expect(transcript.entries.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(transcript.entries[1].createdAt).toBeUndefined();
    // 缺时间戳的消息沿用上一条，因此不会被排到队首。
    expect(transcript.entries[1].sortAt).toBe(5);
  });

  it('records a note when a member history cannot be loaded', async () => {
    const deps: TranscriptDeps = {
      getMessages: vi.fn(async ({ conversation_id }) => {
        if (conversation_id === 'c-mate') throw new Error('backend down');
        return page([textMessage('l1', 'hi', 1)], false, null);
      }),
      getImageDataUrl: vi.fn(async () => null),
    };

    const transcript = await collectTeamTranscript({
      team: { id: 't1', name: 'Team' },
      members,
      includeImages: false,
      exportedAt: 1000,
      deps,
    });

    expect(transcript.notes).toEqual([
      { kind: 'member_failed', slot_id: 'mate', name: 'Mate', reason: 'backend down' },
    ]);
    expect(transcript.entries).toHaveLength(1);
  });

  it('inlines images and reports the ones it could not read', async () => {
    const deps: TranscriptDeps = {
      getMessages: vi.fn(async ({ conversation_id }) =>
        page(
          conversation_id === 'c-leader' ? [textMessage('l1', '![ok](out/ok.png)\n![bad](out/bad.png)', 1)] : [],
          false,
          null
        )
      ),
      getImageDataUrl: vi.fn(async (path: string) => (path.includes('ok.png') ? 'data:image/png;base64,AAA' : null)),
    };

    const transcript = await collectTeamTranscript({
      team: { id: 't1', name: 'Team', workspace: 'D:/work' },
      members,
      includeImages: true,
      exportedAt: 1000,
      deps,
    });

    expect(transcript.images).toEqual({ 'out/ok.png': 'data:image/png;base64,AAA' });
    expect(transcript.notes).toEqual([{ kind: 'images_failed', count: 1 }]);
    // 相对路径按团队工作区补全后才去读盘。
    expect(deps.getImageDataUrl).toHaveBeenCalledWith('D:/work/out/ok.png', 'D:/work');
  });
});

describe('collectImageRefs', () => {
  it('picks up markdown images but ignores remote and inline sources', () => {
    const message = textMessage(
      'x',
      '![a](out/a.png) ![b](https://example.com/b.png) ![c](data:image/png;base64,AAA)',
      1
    );
    expect(collectImageRefs(message)).toEqual(['out/a.png']);
  });

  it('picks up the generated image of an acp tool call', () => {
    const message = {
      id: 'tc',
      conversation_id: 'c1',
      type: 'acp_tool_call',
      content: {
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'call-1',
          status: 'completed',
          title: 'ImageGeneration',
          kind: 'execute',
          rawOutput: { image: { path: 'D:/work/img.png' } },
        },
      },
    } as unknown as TMessage;
    expect(collectImageRefs(message)).toEqual(['D:/work/img.png']);
  });
});

describe('renderMarkdown', () => {
  it('escapes html so tool output cannot inject markup', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> </script>', markdownCtx);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders fenced code verbatim without markdown interpretation', () => {
    const html = renderMarkdown('```ts\nconst a = **not bold**;\n```', markdownCtx);
    expect(html).toContain('<pre class="tx-code" data-lang="ts"><code>const a = **not bold**;</code></pre>');
  });

  it('protects inline code from inline markers', () => {
    const html = renderMarkdown('use `a * b * c` here', markdownCtx);
    expect(html).toContain('<code class="tx-code-inline">a * b * c</code>');
    expect(html).not.toContain('<em>');
  });

  it('renders lists, tables and quotes', () => {
    expect(renderMarkdown('- one\n- two', markdownCtx)).toContain('<ul class="tx-list"><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |', markdownCtx)).toContain('<th>a</th>');
    expect(renderMarkdown('> quoted', markdownCtx)).toContain('<blockquote class="tx-quote">');
  });

  it('keeps a loose ordered list as one list so numbering does not restart', () => {
    const html = renderMarkdown('1. first\n\n2. second\n\n3. third', markdownCtx);
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('does not let a mid-line code fence swallow the rest of the message', () => {
    // 模型经常把整段内容写成一行，连续反引号不能被当作行内代码的定界符。
    const source = ['see ```js const a = 1 ``` note **key** end'].join('');
    expect(renderMarkdown(source, markdownCtx)).toContain('<strong>key</strong>');
  });

  it('only links safe schemes and shows other targets as plain paths', () => {
    expect(renderMarkdown('[docs](https://example.com)', markdownCtx)).toContain('href="https://example.com"');
    const local = renderMarkdown('[file](javascript:alert(1))', markdownCtx);
    expect(local).not.toContain('href');
    expect(local).toContain('tx-path');
  });

  it('inlines a collected image and falls back to the path otherwise', () => {
    const withImage = renderMarkdown('![shot](out/a.png)', {
      images: { 'out/a.png': 'data:image/png;base64,AAA' },
      imageMissingLabel: labels.imageMissing,
    });
    expect(withImage).toContain('src="data:image/png;base64,AAA"');

    const withoutImage = renderMarkdown('![shot](out/a.png)', markdownCtx);
    expect(withoutImage).toContain(labels.imageMissing);
    expect(withoutImage).toContain('out/a.png');
  });
});

describe('diffLines', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'ctx', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'ctx', text: 'c' },
    ]);
  });

  it('gives up above the line budget instead of hanging the export', () => {
    const huge = Array.from({ length: 1300 }, (_value, index) => `line ${index}`).join('\n');
    expect(diffLines(huge, huge)).toBeNull();
  });
});

describe('renderTranscriptMessage', () => {
  const ctx = { labels, markdown: markdownCtx };

  it('tags the article with member, order and identity color', () => {
    const html = renderTranscriptMessage(entry(textMessage('m1', 'hello', 5)), 7, member(), ctx);
    expect(html).toContain('data-member="slot-a"');
    expect(html).toContain('data-idx="7"');
    expect(html).toContain('style="--c:#2f6fed"');
    expect(html).toContain('Claude Code');
  });

  it('labels user messages as the operator', () => {
    const html = renderTranscriptMessage(entry(textMessage('m1', 'do it', 5, { position: 'right' })), 0, member(), ctx);
    expect(html).toContain(labels.you);
  });

  it('shows who forwarded a teammate message', () => {
    const message = {
      id: 'm2',
      conversation_id: 'c1',
      type: 'text',
      position: 'left',
      created_at: 6,
      content: { content: 'task done', teammateMessage: true, senderName: '1ONE CLI' },
    } as unknown as TMessage;
    const html = renderTranscriptMessage(entry(message), 1, member(), ctx);
    expect(html).toContain(fillLabel(labels.fromTeammate, { name: '1ONE CLI' }));
  });

  it('keeps acp tool call input, output and diff in collapsed details', () => {
    const message = {
      id: 'tc',
      conversation_id: 'c1',
      type: 'acp_tool_call',
      position: 'left',
      created_at: 7,
      content: {
        update: {
          sessionUpdate: 'tool_call',
          tool_call_id: 'call-1',
          status: 'completed',
          title: 'Edit board.js',
          kind: 'edit',
          rawInput: { path: 'board.js' },
          rawOutput: { result: 'ok' },
          content: [{ type: 'diff', path: 'board.js', old_text: 'a\n', new_text: 'b\n' }],
          locations: [{ path: 'board.js' }],
        },
      },
    } as unknown as TMessage;

    const html = renderTranscriptMessage(entry(message), 2, member(), ctx);

    expect(html).toContain('Edit board.js');
    expect(html).toContain(labels.toolInput);
    expect(html).toContain(labels.toolOutput);
    expect(html).toContain(labels.toolLocations);
    expect(html).toContain('tx-diff-add');
    expect(html).toContain('tx-diff-del');
    expect(html).toContain(labels.statusDone);
  });

  it('shortens a giant tool title but keeps the original text in the document', () => {
    // 真机上撞到过：整条 PowerShell here-string 就是 update.title，且该消息没有 rawInput，
    // 完整命令只存在于 title 里 —— 抬头必须收成一行，原文一个字都不能少。
    const command = `powershell -Command @"\n${'X'.repeat(500)}\n"@`;
    const message = {
      id: 'tc-long',
      conversation_id: 'c1',
      type: 'acp_tool_call',
      position: 'left',
      created_at: 9,
      content: {
        update: { sessionUpdate: 'tool_call', tool_call_id: 'c', status: 'completed', title: command, kind: 'execute' },
      },
    } as unknown as TMessage;

    const html = renderTranscriptMessage(entry(message), 5, member(), ctx);
    const head = html.slice(html.indexOf('tx-tool-name'), html.indexOf('</span>', html.indexOf('tx-tool-name')));
    expect(head.length).toBeLessThan(200);
    expect(html).toContain(labels.fullText);
    expect(html).toContain('X'.repeat(500));
  });

  it('renders plan entries with their status', () => {
    const message = {
      id: 'p1',
      conversation_id: 'c1',
      type: 'plan',
      position: 'left',
      created_at: 8,
      content: {
        session_id: 's',
        entries: [
          { content: 'design rules', status: 'completed' },
          { content: 'write code', status: 'in_progress' },
        ],
      },
    } as unknown as TMessage;

    const html = renderTranscriptMessage(entry(message), 3, member(), ctx);
    expect(html).toContain('tx-plan-completed');
    expect(html).toContain('tx-plan-in_progress');
    expect(html).toContain('design rules');
  });

  it('folds a very long body behind a summary that states its size', () => {
    const long = 'A'.repeat(6001);
    const html = renderTranscriptMessage(entry(textMessage('m1', long, 5)), 0, member(), ctx);
    expect(html).toContain('<details');
    expect(html).toContain(fillLabel(labels.longBody, { chars: 6001 }));
    // 折叠不等于丢内容：完整正文仍在文档里。
    expect(html).toContain('A'.repeat(6001));
  });

  it('leaves an ordinary body expanded', () => {
    const html = renderTranscriptMessage(entry(textMessage('m1', 'short answer', 5)), 0, member(), ctx);
    expect(html).not.toContain('<details');
  });

  it('names the type instead of dropping unsupported messages', () => {
    const message = { id: 'u1', conversation_id: 'c1', type: 'brand_new', content: {} } as unknown as TMessage;
    const html = renderTranscriptMessage(entry(message), 4, member(), ctx);
    expect(html).toContain(fillLabel(labels.unknownType, { type: 'brand_new' }));
  });
});

describe('renderTeamTranscriptHtml', () => {
  const buildTranscript = () => ({
    team: { id: 't1', name: 'Team <alpha>', workspace: 'D:/work', session_mode: 'auto' },
    exportedAt: 1_700_000_000_000,
    members: [
      member({ slot_id: 'leader', name: 'Leader', messageCount: 1 }),
      member({ slot_id: 'mate', name: 'Mate', backend: 'codex', isLeader: false, color: '#5c9ea4', messageCount: 1 }),
    ],
    entries: [
      entry(textMessage('l1', 'dispatch', 10), { slot_id: 'leader' }),
      entry(textMessage('m1', 'ack', 20), { slot_id: 'mate' }),
    ],
    images: {},
    notes: [{ kind: 'images_failed' as const, count: 2 }],
  });

  it('emits one self-contained document with both views over a single copy of each message', () => {
    const html = renderTeamTranscriptHtml(buildTranscript(), labels);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('id="lanes"');
    expect(html).toContain('id="timeline"');
    expect(html).toContain('data-view-btn="timeline"');
    // 两种视图共用同一批节点，所以每条消息在文档里只出现一次。
    expect(html.match(/id="m-l1"/g)).toHaveLength(1);
    expect(html.match(/id="m-m1"/g)).toHaveLength(1);
    // 没有任何外链资源，离线可看。
    expect(html).not.toMatch(/<(script|link)[^>]+src=|href="http/);
  });

  it('escapes the team name and renders member filters plus notes', () => {
    const html = renderTeamTranscriptHtml(buildTranscript(), labels);

    expect(html).toContain('Team &lt;alpha&gt;');
    expect(html).toContain('data-member-toggle="leader"');
    expect(html).toContain('data-member-toggle="mate"');
    expect(html).toContain(fillLabel(labels.noteImagesFailed, { count: 2 }));
    expect(html).toContain(labels.leader);
  });

  it('tells the reader when a member has no messages', () => {
    const transcript = { ...buildTranscript(), entries: [] };
    const html = renderTeamTranscriptHtml(transcript, labels);
    expect(html).toContain(labels.emptyMember);
  });
});

describe('fillLabel', () => {
  it('replaces single-brace placeholders and leaves unknown ones alone', () => {
    expect(fillLabel('{name} did {count} things', { name: 'Mate', count: 3 })).toBe('Mate did 3 things');
    expect(fillLabel('{missing}', {})).toBe('{missing}');
  });
});

describe('escapeHtml', () => {
  it('covers every character that could break out of text or an attribute', () => {
    expect(escapeHtml(`<a href="x" data-y='z'>&`)).toBe('&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;');
  });
});
