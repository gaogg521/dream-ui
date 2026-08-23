/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamTranscript, TranscriptNote } from './teamTranscriptTypes';
import { fillLabel, type TranscriptLabels } from './transcriptLabels';
import { formatDisplayTime, renderTranscriptMessage, type MessageRenderContext } from './renderTranscriptMessage';
import { escapeAttr, escapeHtml } from './transcriptMarkdown';

const STYLE = `
:root {
  --tx-bg: #f6f7f9; --tx-panel: #ffffff; --tx-border: #e4e6eb;
  --tx-text: #1d2129; --tx-text-2: #4e5969; --tx-text-3: #86909c;
  --tx-code-bg: #f2f3f5; --tx-add: #1f7a3d; --tx-add-bg: #e8f7ed;
  --tx-del: #b42318; --tx-del-bg: #fdecea; --tx-user-bg: #eef2ff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --tx-bg: #17171a; --tx-panel: #1f1f23; --tx-border: #2f2f35;
    --tx-text: #e8e8ea; --tx-text-2: #b4b4bb; --tx-text-3: #85858e;
    --tx-code-bg: #26262b; --tx-add: #6ee7a0; --tx-add-bg: #12301f;
    --tx-del: #ff9a92; --tx-del-bg: #331716; --tx-user-bg: #22252e;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--tx-bg); color: var(--tx-text);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
a { color: #2f6fed; }
.tx-top { padding: 20px 24px 12px; border-bottom: 1px solid var(--tx-border); background: var(--tx-panel); position: sticky; top: 0; z-index: 5; }
.tx-title { margin: 0 0 8px; font-size: 20px; font-weight: 650; }
.tx-meta { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 0 0 12px; color: var(--tx-text-2); font-size: 12px; }
.tx-meta b { font-weight: 550; color: var(--tx-text-3); margin-right: 6px; }
.tx-notes { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--tx-border); border-left: 3px solid #e6a23c; border-radius: 6px; background: var(--tx-code-bg); font-size: 12px; }
.tx-notes-title { font-weight: 600; margin-bottom: 4px; }
.tx-notes ul { margin: 0; padding-left: 18px; }
.tx-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.tx-seg { display: inline-flex; border: 1px solid var(--tx-border); border-radius: 8px; overflow: hidden; }
.tx-seg button { border: 0; padding: 5px 12px; background: transparent; color: var(--tx-text-2); font: inherit; font-size: 12px; cursor: pointer; }
.tx-seg button[aria-pressed="true"] { background: #2f6fed; color: #fff; }
.tx-members { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
.tx-members label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.tx-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.tx-search { flex: 1 1 200px; min-width: 160px; padding: 5px 10px; border: 1px solid var(--tx-border); border-radius: 8px; background: var(--tx-panel); color: inherit; font: inherit; font-size: 12px; }
.tx-flat { border: 1px solid var(--tx-border); border-radius: 8px; padding: 5px 12px; background: transparent; color: var(--tx-text-2); font: inherit; font-size: 12px; cursor: pointer; }
main { padding: 16px 24px 40px; }
.tx-lanes { display: flex; gap: 14px; align-items: flex-start; overflow-x: auto; }
.tx-lane { flex: 1 1 0; min-width: 340px; background: var(--tx-panel); border: 1px solid var(--tx-border); border-radius: 10px; overflow: hidden; }
.tx-lane-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; padding: 9px 12px; border-bottom: 1px solid var(--tx-border); background: linear-gradient(0deg, var(--tx-panel), var(--tx-panel)); }
.tx-lane-name { font-weight: 650; color: var(--c); }
.tx-lane-tag { font-size: 11px; color: var(--tx-text-3); }
.tx-lane-body { padding: 10px 12px; }
.tx-timeline { display: none; max-width: 900px; margin: 0 auto; }
body[data-view="timeline"] .tx-lanes { display: none; }
body[data-view="timeline"] .tx-timeline { display: block; }
body[data-view="timeline"] .tx-msg { border-left: 3px solid var(--c); padding-left: 10px; background: var(--tx-panel); border-radius: 0 8px 8px 0; margin-bottom: 8px; padding-top: 8px; padding-bottom: 8px; padding-right: 10px; }
.tx-msg { margin: 0 0 12px; }
.tx-msg[hidden] { display: none; }
.tx-msg-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; font-size: 12px; }
.tx-who { font-weight: 600; }
.tx-who-user { color: var(--tx-text-2); }
.tx-from { color: var(--tx-text-3); font-size: 11px; }
.tx-time { color: var(--tx-text-3); font-size: 11px; margin-left: auto; font-variant-numeric: tabular-nums; }
.tx-msg-body { font-size: 13px; }
.tx-msg[data-pos="right"] .tx-msg-body { background: var(--tx-user-bg); border-radius: 8px; padding: 8px 10px; }
.tx-p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.tx-msg-body > *:last-child { margin-bottom: 0; }
.tx-h { font-weight: 650; margin: 10px 0 6px; }
.tx-h1, .tx-h2 { font-size: 15px; } .tx-h3 { font-size: 14px; } .tx-h4, .tx-h5, .tx-h6 { font-size: 13px; }
.tx-hr { border: 0; border-top: 1px solid var(--tx-border); margin: 10px 0; }
.tx-list { margin: 0 0 8px; padding-left: 20px; }
.tx-quote { margin: 0 0 8px; padding: 2px 0 2px 10px; border-left: 3px solid var(--tx-border); color: var(--tx-text-2); }
.tx-table { border-collapse: collapse; margin: 0 0 8px; display: block; overflow-x: auto; max-width: 100%; }
.tx-table th, .tx-table td { border: 1px solid var(--tx-border); padding: 5px 8px; text-align: left; }
.tx-code { margin: 0 0 8px; padding: 9px 11px; background: var(--tx-code-bg); border-radius: 7px; overflow-x: auto; font-size: 12px; }
.tx-code code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; }
.tx-code-inline { padding: 1px 5px; background: var(--tx-code-bg); border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.tx-img { max-width: 100%; border-radius: 7px; display: block; margin: 4px 0 8px; }
.tx-path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--tx-text-2); overflow-wrap: anywhere; }
.tx-path-list { display: flex; flex-direction: column; gap: 2px; }
.tx-details { margin: 0 0 6px; border: 1px solid var(--tx-border); border-radius: 7px; background: var(--tx-panel); }
.tx-details > summary { padding: 5px 9px; cursor: pointer; font-size: 12px; color: var(--tx-text-2); list-style: none; }
.tx-details > summary::-webkit-details-marker { display: none; }
.tx-details > summary::before { content: "▸"; display: inline-block; width: 12px; color: var(--tx-text-3); }
.tx-details[open] > summary::before { content: "▾"; }
.tx-details-body { padding: 0 9px 8px; }
.tx-summary-icon { margin-right: 4px; }
.tx-tool-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 3px; }
.tx-tool-name { font-weight: 600; font-size: 12px; }
.tx-tool-kind, .tx-lane-tag { font-size: 11px; color: var(--tx-text-3); }
.tx-tool-desc { font-size: 12px; color: var(--tx-text-2); margin-bottom: 5px; overflow-wrap: anywhere; }
.tx-tool-item { padding: 7px 0; border-top: 1px solid var(--tx-border); }
.tx-tool-item:first-child { border-top: 0; padding-top: 0; }
.tx-badge { font-size: 10px; padding: 1px 6px; border-radius: 20px; border: 1px solid var(--tx-border); color: var(--tx-text-2); }
.tx-badge-done { color: var(--tx-add); border-color: var(--tx-add); }
.tx-badge-failed { color: var(--tx-del); border-color: var(--tx-del); }
.tx-badge-running { color: #2f6fed; border-color: #2f6fed; }
.tx-diff { margin: 0 0 8px; border: 1px solid var(--tx-border); border-radius: 7px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.tx-diff-row { padding: 0 8px; white-space: pre; }
.tx-diff-add { background: var(--tx-add-bg); color: var(--tx-add); }
.tx-diff-del { background: var(--tx-del-bg); color: var(--tx-del); }
.tx-plan { border: 1px solid var(--tx-border); border-radius: 7px; padding: 8px 10px; margin-bottom: 8px; }
.tx-plan-title { font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--tx-text-2); }
.tx-plan-row { display: flex; gap: 7px; font-size: 12px; }
.tx-plan-completed { color: var(--tx-text-3); text-decoration: line-through; }
.tx-plan-mark { width: 14px; }
.tx-tip { padding: 7px 10px; border-radius: 7px; background: var(--tx-code-bg); font-size: 12px; overflow-wrap: anywhere; }
.tx-tip-error { background: var(--tx-del-bg); color: var(--tx-del); }
.tx-tip-warning { border-left: 3px solid #e6a23c; }
.tx-error { color: var(--tx-del); font-size: 12px; overflow-wrap: anywhere; }
.tx-system { color: var(--tx-text-3); font-size: 11px; }
.tx-chip { display: inline-block; padding: 1px 7px; border: 1px solid var(--tx-border); border-radius: 20px; font-size: 11px; color: var(--tx-text-2); }
.tx-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; color: var(--tx-text-3); }
.tx-empty { color: var(--tx-text-3); font-size: 12px; }
.tx-nomatch { display: none; padding: 24px; text-align: center; color: var(--tx-text-3); }
body[data-empty="true"] .tx-nomatch { display: block; }
.tx-foot { padding: 0 24px 28px; color: var(--tx-text-3); font-size: 11px; }
@media print {
  .tx-toolbar, .tx-search, .tx-seg, .tx-flat { display: none !important; }
  .tx-top { position: static; }
  body { background: #fff; }
  .tx-msg { break-inside: avoid; }
  .tx-details { break-inside: avoid; }
}
`;

// 产物内的交互脚本。刻意不插值任何数据 —— 全部状态从 DOM 属性读，杜绝注入。
const SCRIPT = `
(function () {
  var body = document.body;
  var lanesHost = document.getElementById('lanes');
  var timelineHost = document.getElementById('timeline');
  var msgs = Array.prototype.slice.call(document.querySelectorAll('.tx-msg'));
  msgs.sort(function (a, b) { return (+a.dataset.idx) - (+b.dataset.idx); });
  var haystack = msgs.map(function (el) { return (el.textContent || '').toLowerCase(); });
  var lanes = {};
  Array.prototype.forEach.call(document.querySelectorAll('.tx-lane'), function (lane) {
    lanes[lane.dataset.member] = lane;
  });
  var hidden = {};
  var keyword = '';

  function place(view) {
    if (view === 'timeline') {
      msgs.forEach(function (el) { timelineHost.appendChild(el); });
    } else {
      msgs.forEach(function (el) {
        var lane = lanes[el.dataset.member];
        if (lane) lane.querySelector('.tx-lane-body').appendChild(el);
      });
    }
    body.dataset.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('[data-view-btn]'), function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.viewBtn === view ? 'true' : 'false');
    });
  }

  function apply() {
    var visible = 0;
    msgs.forEach(function (el, i) {
      var show = !hidden[el.dataset.member] && (!keyword || haystack[i].indexOf(keyword) !== -1);
      el.hidden = !show;
      if (show) visible++;
    });
    Object.keys(lanes).forEach(function (slot) { lanes[slot].hidden = !!hidden[slot]; });
    body.dataset.empty = visible === 0 ? 'true' : 'false';
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-view-btn]'), function (btn) {
    btn.addEventListener('click', function () { place(btn.dataset.viewBtn); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-member-toggle]'), function (input) {
    input.addEventListener('change', function () {
      hidden[input.dataset.memberToggle] = !input.checked;
      apply();
    });
  });
  var search = document.getElementById('tx-search');
  if (search) {
    search.addEventListener('input', function () {
      keyword = search.value.trim().toLowerCase();
      apply();
    });
  }
  function setAll(open) {
    Array.prototype.forEach.call(document.querySelectorAll('.tx-details'), function (d) { d.open = open; });
  }
  var expand = document.getElementById('tx-expand');
  var collapse = document.getElementById('tx-collapse');
  if (expand) expand.addEventListener('click', function () { setAll(true); });
  if (collapse) collapse.addEventListener('click', function () { setAll(false); });

  place('lanes');
  apply();
})();
`;

const renderNote = (note: TranscriptNote, labels: TranscriptLabels): string => {
  switch (note.kind) {
    case 'member_truncated':
      return escapeHtml(fillLabel(labels.noteTruncated, { name: note.name, kept: note.kept }));
    case 'member_failed':
      return escapeHtml(fillLabel(labels.noteMemberFailed, { name: note.name, reason: note.reason }));
    case 'images_failed':
      return escapeHtml(fillLabel(labels.noteImagesFailed, { count: note.count }));
    case 'images_skipped':
      return escapeHtml(fillLabel(labels.noteImagesSkipped, { count: note.count }));
    default:
      return '';
  }
};

const metaRow = (label: string, value: string): string =>
  `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`;

/**
 * 归一化的作战记录 → 单文件离线 HTML。
 *
 * 纯函数：不碰 DOM、不发请求，所以能在 node 环境里直接断言产物内容。
 */
export const renderTeamTranscriptHtml = (transcript: TeamTranscript, labels: TranscriptLabels): string => {
  const ctx: MessageRenderContext = {
    labels,
    markdown: { images: transcript.images, imageMissingLabel: labels.imageMissing },
  };
  const totalMessages = transcript.members.reduce((sum, member) => sum + member.messageCount, 0);

  const laneHtml = transcript.members
    .map((member) => {
      const entries = transcript.entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.slot_id === member.slot_id);
      const bodyHtml = entries.length
        ? entries.map(({ entry, index }) => renderTranscriptMessage(entry, index, member, ctx)).join('')
        : `<div class="tx-empty">${escapeHtml(labels.emptyMember)}</div>`;
      const tags = [member.isLeader ? labels.leader : '', member.backend, member.model]
        .filter(Boolean)
        .map((tag) => `<span class="tx-lane-tag">${escapeHtml(String(tag))}</span>`)
        .join('');
      return [
        `<section class="tx-lane" data-member="${escapeAttr(member.slot_id)}" style="--c:${escapeAttr(member.color)}">`,
        `<div class="tx-lane-head"><span class="tx-lane-name">${escapeHtml(member.name)}</span>${tags}`,
        `<span class="tx-lane-tag" title="${escapeAttr(labels.messageCount)}">${member.messageCount}</span></div>`,
        `<div class="tx-lane-body">${bodyHtml}</div>`,
        '</section>',
      ].join('');
    })
    .join('');

  const memberToggles = transcript.members
    .map(
      (member) =>
        `<label><input type="checkbox" checked data-member-toggle="${escapeAttr(member.slot_id)}">` +
        `<span class="tx-dot" style="background:${escapeAttr(member.color)}"></span>${escapeHtml(member.name)}</label>`
    )
    .join('');

  const notesHtml = transcript.notes.length
    ? [
        '<div class="tx-notes">',
        `<div class="tx-notes-title">${escapeHtml(labels.notesTitle)}</div><ul>`,
        transcript.notes.map((note) => `<li>${renderNote(note, labels)}</li>`).join(''),
        '</ul></div>',
      ].join('')
    : '';

  const meta = [
    transcript.team.workspace ? metaRow(labels.workspace, transcript.team.workspace) : '',
    transcript.team.session_mode ? metaRow(labels.sessionMode, transcript.team.session_mode) : '',
    metaRow(labels.exportedAt, formatDisplayTime(transcript.exportedAt)),
    metaRow(labels.memberCount, String(transcript.members.length)),
    metaRow(labels.messageCount, String(totalMessages)),
  ]
    .filter(Boolean)
    .join('');

  const title = `${transcript.team.name} · ${labels.documentTitle}`;

  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style></head>`,
    '<body data-view="lanes">',
    '<header class="tx-top">',
    `<h1 class="tx-title">${escapeHtml(title)}</h1>`,
    `<div class="tx-meta">${meta}</div>`,
    notesHtml,
    '<div class="tx-toolbar">',
    '<span class="tx-seg">',
    `<button type="button" data-view-btn="lanes" aria-pressed="true">${escapeHtml(labels.viewLanes)}</button>`,
    `<button type="button" data-view-btn="timeline" aria-pressed="false">${escapeHtml(labels.viewTimeline)}</button>`,
    '</span>',
    `<span class="tx-members"><span class="tx-lane-tag">${escapeHtml(labels.filterMembers)}</span>${memberToggles}</span>`,
    `<input id="tx-search" class="tx-search" type="search" placeholder="${escapeAttr(labels.searchPlaceholder)}">`,
    `<button id="tx-expand" class="tx-flat" type="button">${escapeHtml(labels.expandAll)}</button>`,
    `<button id="tx-collapse" class="tx-flat" type="button">${escapeHtml(labels.collapseAll)}</button>`,
    '</div></header>',
    '<main>',
    `<div id="lanes" class="tx-lanes">${laneHtml}</div>`,
    '<div id="timeline" class="tx-timeline"></div>',
    `<div class="tx-nomatch">${escapeHtml(labels.noMatch)}</div>`,
    '</main>',
    `<footer class="tx-foot">${escapeHtml(labels.disclaimer)}</footer>`,
    `<script>${SCRIPT}</script>`,
    '</body></html>',
  ].join('');
};
