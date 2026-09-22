#!/usr/bin/env node
/**
 * Copyright 2026 One Work
 */

/**
 * `one-page-reader` — 应用内浏览器的「读网页」MCP。
 *
 * 为什么要有这个服务：应用内浏览器的自动化走 chrome-devtools-mcp，它给模型的
 * 阅读手段是 take_screenshot（截图后视觉读图）和 take_snapshot（无障碍树）。
 * 前者慢、贵、且 OCR/视觉识别对长文不可靠；后者只有「有语义的元素」，读不了
 * 排版出来的正文。结果是 Agent 浏览网页时最常见的动作变成「滚动 + 截图」，
 * 一篇两千字的文章要翻好几屏。
 *
 * 本服务补上缺的那一格：一个名字就叫「读网页」的工具，经同一条 CDP 单目标
 * 通道（见 cdpBridge.ts）对页面执行 Runtime.evaluate，把可见文本直接取回来。
 * 模型对「有个工具叫读网页」的调用率远高于对 take_snapshot 的自发使用——
 * 工具名即使用说明。
 *
 * 两个取舍：
 *  - 只有一个工具，不做 find_in_page / list_links 等细分：长文用 start 偏移
 *    续读即可覆盖，工具越少，模型选错的概率越低。
 *  - 不返回 Markdown/HTML：innerText 已按渲染结果排好换行，正文抽取加上
 *    布局还原会把返回值撑大一倍，对阅读没有增益。
 *
 * `one-page-reader` — the "read the page" MCP for the in-app browser.
 *
 * Why this exists: browser automation goes through chrome-devtools-mcp, whose
 * reading tools are take_screenshot (vision on an image) and take_snapshot (the
 * a11y tree). Screenshots are slow, expensive and unreliable for long text; the
 * a11y tree only carries elements with semantics and misses rendered prose. The
 * result was agents paging through articles with scroll + screenshot. This
 * server fills the gap: a tool literally named "read the page", running
 * Runtime.evaluate over the same single-target CDP bridge (see cdpBridge.ts).
 * A tool whose name says what it does gets used far more reliably than
 * take_snapshot ever was.
 *
 * Two deliberate choices:
 *  - Exactly one tool, no find_in_page / list_links variants: long pages are
 *    covered by the start offset, and every extra tool is another way for the
 *    model to pick wrong.
 *  - Plain text, not Markdown/HTML: innerText is already laid out. Recovering
 *    structure doubles the payload for no reading gain.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { resolveBrowserUrl } from './browserServerPort';

const DEFAULT_SLICE = 12_000;
const MAX_SLICE = 50_000;
const CONNECT_TIMEOUT_MS = 4_000;
const EVALUATE_TIMEOUT_MS = 20_000;

/**
 * 正文抽取脚本，在页面里执行。
 *
 * 不克隆 DOM：innerText 按「渲染结果」取文本，script/style 本来就是隐藏的，
 * 不会被算进来；克隆后再取反而丢失布局换行。候选容器按可见文本量挑最大的，
 * 达不到阈值就退回整个 body——阈值是为了不在侧栏/推荐位比正文还长的页面上选错。
 *
 * The extraction script, evaluated inside the page. No DOM cloning: innerText
 * is render-aware, so script/style contribute nothing anyway, while a clone
 * would lose layout line breaks. The main-content candidate is whichever
 * container holds the most visible text; below the threshold we fall back to
 * the body — the threshold exists so a long sidebar never beats the article.
 */
const EXTRACT_SCRIPT = `(() => {
  const SELECTORS = ['article', 'main', '[role="main"]', '#content', '.content', '.article', '#main', '.post-content', '.markdown-body'];
  const title = document.title || '';
  const url = location.href;
  const body = document.body;
  if (!body) return { title, url, text: '', length: 0 };
  let best = null;
  for (const sel of SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      const len = (el.innerText || '').length;
      if (!best || len > best.len) best = { len, text: el.innerText || '' };
    }
  }
  const bodyText = body.innerText || '';
  const text = best && best.len >= 200 && best.len <= bodyText.length ? best.text : bodyText;
  const cleaned = text.replace(/\\n{3,}/g, '\\n\\n').trim();
  return { title, url, text: cleaned, length: cleaned.length };
})()`;

type PageContent = { title: string; url: string; text: string; length: number };

/** stderr 是 stdio MCP 唯一不破坏协议的输出通道。/ stderr is the only protocol-safe channel. */
const logDiagnostic = (message: string): void => {
  process.stderr.write(`[page-reader-mcp] ${message}\n`);
};

const env = (): Record<string, string> => process.env as Record<string, string>;

/** HTTP 发现段：拿带口令的 ws 地址（口令由桥回填，客户端无需知道）。/ Discovery: fetch the tokened ws URL. */
const discoverPage = (port: number): Promise<{ wsUrl: string; targetId: string }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/json/list', timeout: CONNECT_TIMEOUT_MS },
      (res: IncomingMessage) => {
        let body = '';
        res.on('data', (chunk: string | Buffer) => (body += chunk));
        res.on('end', () => {
          try {
            const targets = JSON.parse(body) as Array<{ id?: string; type?: string; webSocketDebuggerUrl?: string }>;
            const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page?.webSocketDebuggerUrl && page.id) resolve({ wsUrl: page.webSocketDebuggerUrl, targetId: page.id });
            else reject(new Error('no page target'));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('discovery timeout')));
    req.on('error', reject);
    // 没有 end() 的请求不会发出：漏掉它不是「连接失败」而是「连接从未建立」，
    // 直到套接字空闲超时才炸——一个把人指向网络状况的假线索。
    // A request without end() is never sent: nothing fails at call time, and the
    // mistake only surfaces when the idle timer fires, pointing at the network.
    req.end();
  });

type CdpConnection = {
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<Record<string, unknown>>;
  close: () => void;
};

/**
 * 最小 CDP 客户端。
 *
 * 走 flatten 模式：先 Target.attachToTarget 拿 sessionId，再带 sessionId 发命令。
 * 这对两种对端都成立——本应用的桥（cdpTargetProtocol 本地应答 attach，返回固定
 * sessionId）和真实 Chrome（原生支持 flatten）。桥对页面级命令只看 method/params，
 * sessionId 原样回显，Runtime.evaluate 直达页面 debugger。
 *
 * A minimal CDP client. Flatten mode: attach to the single target first, then send
 * commands with the returned sessionId. This works against both peers — the app's
 * bridge (attach answered locally by cdpTargetProtocol with a fixed sessionId) and
 * a real Chrome (native flatten). The bridge routes page-level commands by
 * method/params alone and echoes the sessionId back.
 */
const connectCdp = (wsUrl: string): Promise<CdpConnection> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('connect timeout'));
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timer);
      const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
        new Promise<Record<string, unknown>>((res, rej) => {
          const id = ++nextId;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      resolve({ send, close: () => ws.close() });
    });

    ws.on('message', (data) => {
      let msg: { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof msg.id !== 'number') return; // 事件（attachedToTarget 等）只管忽略 / events are ignored
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error?.message) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result ?? {});
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ]);

/** 抽正文：attach → evaluate → 取 value。/ Attach, evaluate, take the value. */
const readPage = async (mode: 'article' | 'full'): Promise<PageContent> => {
  const browserUrl = resolveBrowserUrl({ env: env() });
  if (!browserUrl) {
    throw new Error(
      '应用内浏览器 CDP 通道不可用（DREAM_CDP_ACTIVE_PORT 未设置）。请从 One Work 应用内发起本调用，并确认浏览器面板已打开。'
    );
  }
  const port = Number(new URL(browserUrl).port);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`CDP 地址异常: ${browserUrl}`);
  const { wsUrl, targetId } = await withTimeout(discoverPage(port), CONNECT_TIMEOUT_MS, 'discovery');
  const conn = await withTimeout(connectCdp(wsUrl), CONNECT_TIMEOUT_MS, 'connect');
  try {
    const attached = (await withTimeout(
      conn.send('Target.attachToTarget', { targetId, flatten: true }),
      CONNECT_TIMEOUT_MS,
      'attach'
    )) as {
      sessionId?: string;
    };
    const sessionId = attached.sessionId;
    const expression =
      mode === 'full'
        ? `(() => { const b = document.body; return { title: document.title || '', url: location.href, text: (b ? b.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim(), length: (b ? b.innerText : '').length } })()`
        : EXTRACT_SCRIPT;
    const result = (await withTimeout(
      conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, sessionId),
      EVALUATE_TIMEOUT_MS,
      'evaluate'
    )) as {
      result?: { value?: PageContent };
      exceptionDetails?: { exception?: { description?: string } };
    };
    if (result.exceptionDetails?.exception?.description) {
      throw new Error(`页面脚本执行失败: ${result.exceptionDetails.exception.description}`);
    }
    const value = result.result?.value;
    if (!value || typeof value.text !== 'string') throw new Error('页面返回了无法解析的内容');
    return value;
  } finally {
    conn.close();
  }
};

const main = async (): Promise<void> => {
  const server = new McpServer({ name: 'one-page-reader', version: '1.0.0' });

  server.tool(
    'read_page',
    'Read the page currently open in the One Work built-in browser (the side preview panel). ' +
      'The response ALWAYS begins with the page title and URL, so this one call also answers ' +
      '"what page/site am I on" — there is no need to call list_pages first, and no need to call ' +
      'take_snapshot or take_screenshot afterwards just to see the content. ' +
      'Use this whenever the task is to READ what the page says — articles, documentation, search results, ' +
      'prices, reviews, tables: it returns the actual text, reliably and cheaply, while a snapshot returns an ' +
      'accessibility tree built for clicking and a screenshot makes the model guess from pixels. ' +
      'Reach for take_snapshot only when you actually need element handles to interact with the page. ' +
      'Long pages come back in slices; if the response says there is more, call again with start=nextStart.',
    {
      start: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Character offset to start reading from (0-based). Omit on the first call; use nextStart from the previous response to continue.'
        ),
      length: z
        .number()
        .int()
        .min(200)
        .max(MAX_SLICE)
        .optional()
        .describe(`How many characters to return per call (default ${DEFAULT_SLICE}, max ${MAX_SLICE}).`),
      mode: z
        .enum(['article', 'full'])
        .optional()
        .describe(
          'article (default) extracts the main content and skips sidebars/headers; full returns everything visible on the page.'
        ),
    },
    async ({ start, length, mode }) => {
      const sliceStart = start ?? 0;
      const sliceLength = Math.min(length ?? DEFAULT_SLICE, MAX_SLICE);
      try {
        const page = await readPage(mode ?? 'article');
        if (page.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `页面没有可见文本（title: ${page.title || '无'}，url: ${page.url}）。可能是空白页、纯图片页或内容尚未加载完成。`,
              },
            ],
            isError: true,
          };
        }
        if (sliceStart >= page.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `start=${sliceStart} 已超出本文长度（共 ${page.length} 字）。全文已读完；需要重读请从 start=0 开始。`,
              },
            ],
            isError: true,
          };
        }
        const slice = page.text.slice(sliceStart, sliceStart + sliceLength);
        const nextStart = sliceStart + slice.length;
        const hasMore = nextStart < page.length;
        const parts = [
          page.title ? `标题: ${page.title}` : '',
          `URL: ${page.url}`,
          `第 ${sliceStart + 1}-${nextStart} 字，共 ${page.length} 字`,
          '',
          slice,
        ];
        if (hasMore) parts.push('', `—— 文本未读完，续读请传 start=${nextStart}`);
        // index 3 的空行是刻意的排版分隔，其余空串（如缺标题）才过滤
        return { content: [{ type: 'text' as const, text: parts.filter((p, i) => p !== '' || i === 3).join('\n') }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 配置类失败不值得重试：明确说出来，免得模型原地反复撞墙。
        // Configuration failures are not retryable; say so plainly.
        const advice = message.includes('DREAM_CDP_ACTIVE_PORT')
          ? '此错误无法通过重试解决。'
          : '若持续失败，请让用户在 One Work 中打开浏览器面板（加载任意网页）后重试。';
        return { content: [{ type: 'text' as const, text: `读取网页失败：${message}\n${advice}` }], isError: true };
      }
    }
  );

  await server.connect(new StdioServerTransport());
  logDiagnostic('ready');
};

main().catch((err) => {
  process.stderr.write(`[page-reader-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
