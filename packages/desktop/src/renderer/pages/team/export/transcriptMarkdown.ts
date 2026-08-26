/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 导出产物用的受限 Markdown → HTML 转换。
 *
 * 为什么不复用界面里的 `MarkdownView`：那是 react-markdown 组件树，依赖 Preview context、
 * unocss 运行时和懒加载，脱离应用环境渲染不出来。所以这里手写一个**受限子集**：
 * 标题 / 段落 / 换行 / 列表 / 引用 / 分割线 / 表格 / 围栏代码 / 行内代码 / 粗斜体 / 删除线 /
 * 链接 / 图片。其余一律按纯文本处理 —— 宁可少画，不能画错。
 *
 * 安全前提：**先抽出代码片段，再整体转义，最后只注入我们自己生成的标签**。
 * 消息内容是模型和工具的输出，必须当不可信数据对待，不能让它注入 HTML/脚本。
 */

export type MarkdownContext = {
  /** 消息里出现的 src 原文 -> data URI。查不到的本机图片退化成只显示路径。 */
  images: Record<string, string>;
  /** 本机图片取不到时的提示前缀。 */
  imageMissingLabel: string;
};

/** 占位符用 NUL 包裹：正常消息内容里不会出现，也不受 HTML 转义影响。 */
const NUL_MARK = String.fromCharCode(0);
const CODE_PLACEHOLDER_PREFIX = `${NUL_MARK}c`;
const CODE_PLACEHOLDER_SUFFIX = NUL_MARK;

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 属性值转义：与文本同一套，额外保证反引号不落进属性里。 */
export const escapeAttr = (value: string): string => escapeHtml(value).replace(/`/g, '&#96;');

const SAFE_LINK_SCHEME_RE = /^(https?:|mailto:)/i;

const isRemoteOrInlineSrc = (src: string): boolean => /^(https?:|data:)/i.test(src);

const decodeSrc = (src: string): string => {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
};

const renderImage = (alt: string, rawSrc: string, ctx: MarkdownContext): string => {
  const src = decodeSrc(rawSrc.trim());
  const altAttr = escapeAttr(alt);
  if (isRemoteOrInlineSrc(src)) {
    return `<img class="tx-img" loading="lazy" src="${escapeAttr(src)}" alt="${altAttr}">`;
  }
  const inlined = ctx.images[src];
  if (inlined) {
    return `<img class="tx-img" loading="lazy" src="${escapeAttr(inlined)}" alt="${altAttr}" title="${escapeAttr(src)}">`;
  }
  return `<span class="tx-path" title="${escapeAttr(src)}">${escapeHtml(ctx.imageMissingLabel)} ${escapeHtml(src)}</span>`;
};

const renderLink = (text: string, rawHref: string): string => {
  const href = rawHref.trim();
  const label = text || href;
  if (SAFE_LINK_SCHEME_RE.test(href)) {
    return `<a class="tx-link" href="${escapeAttr(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  }
  // 本机路径 / 未知协议：只展示不可点，避免产物变成任意 URL 跳板。
  return `<span class="tx-path" title="${escapeAttr(decodeSrc(href))}">${label}</span>`;
};

/**
 * 行内标记。传入的是**已转义**的文本，因此这里只可能匹配到 markdown 结构字符。
 */
const renderInline = (escaped: string, ctx: MarkdownContext): string =>
  escaped
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_all, alt: string, src: string) =>
      renderImage(alt, src, ctx)
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_all, text: string, href: string) =>
      renderLink(text, href)
    )
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

type CodeSpanExtraction = {
  masked: string;
  spans: string[];
};

/**
 * 抽出行内代码，避免其中的 markdown 结构字符被二次解释。
 *
 * 前后的 `(?<!\`)` / `(?!\`)` 是必须的：模型经常把整段内容写成**一行**，里面的 ``` 围栏
 * 因此不在行首、走不到围栏分支；若不排除连续反引号，一个 ``` 会和下一个 ``` 配成一个巨大的
 * 行内代码片段，把中间所有 **加粗**、列表都吞掉（真机数据上实际发生过）。
 */
const extractCodeSpans = (source: string): CodeSpanExtraction => {
  const spans: string[] = [];
  const masked = source.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (_all, code: string) => {
    spans.push(code);
    return `${CODE_PLACEHOLDER_PREFIX}${spans.length - 1}${CODE_PLACEHOLDER_SUFFIX}`;
  });
  return { masked, spans };
};

const restoreCodeSpans = (html: string, spans: string[]): string =>
  html.replace(new RegExp(`${CODE_PLACEHOLDER_PREFIX}(\\d+)${CODE_PLACEHOLDER_SUFFIX}`, 'g'), (_all, index: string) => {
    const code = spans[Number(index)];
    return code === undefined ? '' : `<code class="tx-code-inline">${escapeHtml(code)}</code>`;
  });

/** 行内片段（标题、列表项、单元格、段落行都走这里）。 */
const inlineToHtml = (source: string, ctx: MarkdownContext): string => {
  const { masked, spans } = extractCodeSpans(source);
  return restoreCodeSpans(renderInline(escapeHtml(masked), ctx), spans);
};

const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UNORDERED_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

const splitTableRow = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());

type ListKind = 'ul' | 'ol';

/** 列表项：同层收集，缩进 >= 2 空格的行递归成子列表。 */
const renderList = (lines: string[], kind: ListKind, ctx: MarkdownContext): string => {
  const items: string[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    const [head, ...rest] = current;
    const nested =
      rest.length > 0
        ? renderBlocks(
            rest.map((line) => line.replace(/^ {1,4}/, '')),
            ctx
          )
        : '';
    items.push(`<li>${inlineToHtml(head, ctx)}${nested}</li>`);
    current = null;
  };

  for (const line of lines) {
    const unordered = UNORDERED_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    const indent = (unordered?.[1] ?? ordered?.[1] ?? '').length;
    if ((unordered || ordered) && indent < 2) {
      flush();
      current = [unordered ? unordered[2] : (ordered as RegExpExecArray)[3]];
      continue;
    }
    if (current) current.push(line);
  }
  flush();

  return `<${kind} class="tx-list">${items.join('')}</${kind}>`;
};

const isListStart = (line: string): boolean => {
  const unordered = UNORDERED_RE.exec(line);
  const ordered = ORDERED_RE.exec(line);
  const indent = (unordered?.[1] ?? ordered?.[1] ?? '').length;
  return Boolean(unordered || ordered) && indent < 2;
};

const listKindOf = (line: string): ListKind => (UNORDERED_RE.test(line) ? 'ul' : 'ol');

/**
 * 收集一个列表块，允许「松散列表」（项与项之间有空行）。
 *
 * 不容忍空行会把 `1. …\n\n2. …` 切成两个 `<ol>`，于是每一项都从 1 重新编号 ——
 * 真机数据里这种写法非常普遍，跟界面里的渲染结果对不上。
 */
const collectListBlock = (lines: string[], start: number, kind: ListKind): { body: string[]; next: number } => {
  const body: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      let lookahead = index + 1;
      while (lookahead < lines.length && !lines[lookahead].trim()) lookahead++;
      const next = lines[lookahead];
      const stillInList =
        next !== undefined && ((isListStart(next) && listKindOf(next) === kind) || /^\s{2,}\S/.test(next));
      if (!stillInList) break;
      index = lookahead;
      continue;
    }
    if (FENCE_RE.test(line)) break;
    if (isListStart(line) && listKindOf(line) !== kind) break;
    body.push(line);
    index++;
  }
  return { body, next: index };
};

const renderBlocks = (lines: string[], ctx: MarkdownContext): string => {
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const lang = fence[2];
      const body: string[] = [];
      index++;
      while (index < lines.length) {
        const closing = FENCE_RE.exec(lines[index]);
        if (closing && closing[1][0] === marker) {
          index++;
          break;
        }
        body.push(lines[index]);
        index++;
      }
      const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';
      out.push(`<pre class="tx-code"${langAttr}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<div class="tx-h tx-h${level}">${inlineToHtml(heading[2], ctx)}</div>`);
      index++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push('<hr class="tx-hr">');
      index++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE_RE.test(lines[index])) {
        body.push((QUOTE_RE.exec(lines[index]) as RegExpExecArray)[1]);
        index++;
      }
      out.push(`<blockquote class="tx-quote">${renderBlocks(body, ctx)}</blockquote>`);
      continue;
    }

    // GFM 表格：表头 + 分隔行 + 若干数据行
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index++;
      }
      const head = header.map((cell) => `<th>${inlineToHtml(cell, ctx)}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineToHtml(cell, ctx)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table class="tx-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    if (isListStart(line)) {
      const kind = listKindOf(line);
      const { body, next } = collectListBlock(lines, index, kind);
      index = next;
      out.push(renderList(body, kind, ctx));
      continue;
    }

    // 普通段落：连续非空行合并，单换行按界面惯例（remark-breaks）折成 <br>
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockBoundary(lines, index)) {
      paragraph.push(lines[index]);
      index++;
    }
    out.push(`<p class="tx-p">${paragraph.map((row) => inlineToHtml(row, ctx)).join('<br>')}</p>`);
  }

  return out.join('');
};

/** 段落在遇到其它块级结构时必须收尾。 */
const isBlockBoundary = (lines: string[], index: number): boolean => {
  const line = lines[index];
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)) return true;
  if (isListStart(line)) return true;
  return line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[index + 1]);
};

/** Markdown → HTML（受限子集）。输入按不可信数据处理。 */
export const renderMarkdown = (source: string, ctx: MarkdownContext): string => {
  if (!source) return '';
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines, ctx);
};

/** 纯文本 → HTML（保留换行，不做任何 markdown 解释）。 */
export const renderPlainText = (source: string): string =>
  escapeHtml(source.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
