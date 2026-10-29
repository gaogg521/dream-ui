/** Copyright 2026 One Work */
import { ConfigStorage } from '@/common/config/storage';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { loadPersonalScenes, normalizePersonalScene } from './personalScenes';

/** Content, localized like sceneTemplates; these are editable scene definitions. */
export function defaultScenes(language: string): PersonalScene[] {
  const zh = language.toLowerCase().startsWith('zh');
  const shared = zh
    ? '优先完成用户已说明的任务，仅在缺少关键输入时提问。使用用户语言。先读取对应Skill，再使用内置工具。引用用户材料或真实来源，不编造事实、时间、费用或已完成的操作。写文件前检查同名文件，避免覆盖。工具被拒绝时停止该操作，不循环重试授权。未经用户明确要求，不把本次任务材料或偏好写入长期记忆。'
    : 'Complete the stated task; ask only for essential missing inputs. Use the user’s language. Read the selected skill first and use bundled tools. Ground facts in supplied material or actual sources. Never invent completed actions. Check before overwriting files. Respect declined tool approvals without repeated retries. Do not persist task material or preferences as long-term memory unless explicitly requested.';
  const now = Date.now();
  return [
    {
      id: 'builtin-work-v1',
      icon: '💼',
      name: zh ? '工作助手' : 'Work assistant',
      description: zh
        ? '整理材料、写作改稿、会议纪要与行动清单，交付可编辑文档和PDF。'
        : 'Organize material, improve writing, turn meetings into action plans, and deliver editable files or PDFs.',
      prompt:
        shared +
        (zh
          ? '\n处理文档、写作、纪要和任务拆解。保留原材料事实；参会人、负责人、日期、进度未提供时标为待确认，不从负责人推断参会，不把未知进度写为进行中，建议的依赖须标为建议。交付前逐项对照原文核实。需要交付时生成可编辑Markdown/HTML，使用one-export-pdf导出PDF并核验文件。联网时使用one-browser与one-page-reader，已知材料足够时不额外联网。'
          : '\nHandle documents, writing, minutes and action plans. Mark unknown attendees/owners/dates/status as unconfirmed. Never infer attendance from ownership or label unknown progress as in progress. Mark suggested dependencies as suggestions. Verify each claim against the input before delivery. Deliver editable Markdown/HTML; use one-export-pdf for verified PDF output. Use one-browser and one-page-reader for required research only.'),
      intent: {
        discovery: false,
        starters: zh
          ? [
              '把这段会议记录整理成纪要和行动清单，导出PDF',
              '帮我把这份草稿改成清晰的工作汇报',
              '阅读这份材料，整理重点、问题和下一步',
            ]
          : [
              'Turn these meeting notes into minutes and an action plan PDF',
              'Improve this draft into a clear work report',
              'Read this material and extract key points and next steps',
            ],
        questions: [],
        constraints: '',
        deliverables: '',
      },
      skillNames: ['one-work-assistant'],
      mcpServerIds: [],
      builtinMcpNames: ['one-browser', 'one-page-reader', 'one-export-pdf'],
      templateId: 'builtin-work-v1',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'builtin-life-v1',
      icon: '🧭',
      name: zh ? '生活助手' : 'Life assistant',
      description: zh
        ? '安排日常与出行、整理待办和物品清单，输出实用计划与可保存的清单卡片。'
        : 'Plan everyday activities and trips, organize tasks and packing lists, and save practical checklist cards.',
      prompt:
        shared +
        (zh
          ? '\n围绕时间、人数、预算和个人偏好制定可执行计划与清单；仅询问会影响结果的缺失条件。时效性信息需从真实页面核对并附来源和查询日期，不把建议当成已预约或已付款。使用one-browser、one-page-reader查询与核对信息；需要图卡时用one-html-render生成并核验。'
          : '\nMake practical plans and lists using time, people, budget and preferences. Verify time-sensitive information from actual pages with sources and retrieval dates. Never imply a booking or payment occurred. Use one-browser and one-page-reader for research; one-html-render for verified checklist cards.'),
      intent: {
        discovery: false,
        starters: zh
          ? [
              '帮我安排一个轻松的周末，列出准备清单',
              '根据这些待办排一份可执行的一周计划',
              '两人短途出行两天，帮我做行李清单卡片',
            ]
          : [
              'Plan a relaxed weekend with a preparation checklist',
              'Turn these tasks into a practical weekly plan',
              'Create a packing checklist card for two people on a two-day trip',
            ],
        questions: [],
        constraints: '',
        deliverables: '',
      },
      skillNames: ['one-life-assistant'],
      mcpServerIds: [],
      builtinMcpNames: ['one-browser', 'one-page-reader', 'one-html-render'],
      templateId: 'builtin-life-v1',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

let initializing: Promise<PersonalScene[]> | undefined;
/** Seed once without replacing edits, resurrecting deletions, or depending on enterprise connectivity. */
export async function loadScenesWithDefaults(): Promise<PersonalScene[]> {
  if (initializing) return initializing;
  initializing = (async () => {
    try {
      const [raw, initialized, language] = await Promise.all([
        ConfigStorage.get('scenes.personal'),
        ConfigStorage.get('scenes.defaultsInitialized'),
        ConfigStorage.get('language'),
      ]);
      if (raw !== undefined && !Array.isArray(raw)) return [];
      const scenes = (raw ?? []).map(normalizePersonalScene).filter((scene): scene is PersonalScene => scene !== null);
      if (initialized === true) return scenes;
      const ids = new Set(scenes.map((scene) => scene.id));
      const next = [
        ...defaultScenes(language || globalThis.navigator?.language || 'en-US').filter((scene) => !ids.has(scene.id)),
        ...scenes,
      ];
      await ConfigStorage.set('scenes.personal', next);
      await ConfigStorage.set('scenes.defaultsInitialized', true);
      return next;
    } catch {
      // Failed reads must never turn into writes over an existing scene collection.
      return loadPersonalScenes();
    }
  })();
  try {
    return await initializing;
  } finally {
    initializing = undefined;
  }
}
