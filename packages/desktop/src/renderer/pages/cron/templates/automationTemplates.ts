/**
 * Copyright 2026 One Work
 */

/**
 * Ready-made automations a person can start from.
 *
 * Most people do not begin with a blank form: they begin with "something like a
 * daily news brief". Each template is a worked example — a name, a prompt that
 * says what to produce and in what shape, and a sensible schedule — that opens
 * the create form already filled in, every part still editable. They are the
 * kinds of thing people actually schedule (a morning briefing, a weekly report,
 * a reminder), not a catalogue of everything possible.
 *
 * Text is content, not interface chrome, so it is kept here per language
 * (Chinese and English; other languages read the English), the way the scene
 * and digital employee templates are.
 */

/** How a template is scheduled; `monthly` is a day of the month. */
export type AutomationSchedule =
  | { frequency: 'daily' | 'weekdays'; time: string }
  | { frequency: 'weekly'; time: string; weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' }
  | { frequency: 'monthly'; time: string; monthDay: number }
  | { frequency: 'manual' };

type TemplateText = { name: string; description: string; prompt: string };

export type AutomationTemplate = {
  id: string;
  /** One emoji standing in for an icon. */
  icon: string;
  category: 'work' | 'learning' | 'life';
  schedule: AutomationSchedule;
  text: { 'zh-CN': TemplateText; 'en-US': TemplateText };
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'daily-ai-brief',
    icon: '📰',
    category: 'work',
    schedule: { frequency: 'daily', time: '09:00' },
    text: {
      'zh-CN': {
        name: '每日行业资讯简报',
        description: '每天早上汇总一个领域当天的重要动态，附来源和值得关注的原因。',
        prompt:
          '请搜索并整理今天 AI 领域最重要的 3-5 条动态（可以改成你关注的行业）。每条写清楚：发生了什么、为什么值得关注、原文链接。最后用一句话给出今天的整体判断。',
      },
      'en-US': {
        name: 'Daily industry news brief',
        description:
          "Every morning, gather the day's important developments in a field, with sources and why they matter.",
        prompt:
          'Search for and summarise the 3-5 most important developments in AI today (change the field to the one you follow). For each: what happened, why it matters, and the source link. Finish with a one-sentence overall take on the day.',
      },
    },
  },
  {
    id: 'weekly-report',
    icon: '🗒️',
    category: 'work',
    schedule: { frequency: 'weekly', time: '17:00', weekday: 'FRI' },
    text: {
      'zh-CN': {
        name: '每周工作周报',
        description: '每周五下班前，整理本周完成的事、遇到的问题和下周计划。',
        prompt:
          '请根据我这一周在工作区里的文件改动和对话记录，写一份周报草稿：本周完成、进行中、遇到的问题与风险、下周计划。没有依据的内容不要编，写「待补充」。',
      },
      'en-US': {
        name: 'Weekly work report',
        description: "Before the end of Friday, gather what was done, what went wrong and next week's plan.",
        prompt:
          'From my file changes and conversations in the workspace this week, draft a weekly report: done, in progress, problems and risks, next week\'s plan. Do not invent anything you have no basis for; write "to be added" instead.',
      },
    },
  },
  {
    id: 'daily-plan',
    icon: '✅',
    category: 'work',
    schedule: { frequency: 'weekdays', time: '09:30' },
    text: {
      'zh-CN': {
        name: '每日工作计划',
        description: '工作日早上梳理今天要做的事，排出优先级。',
        prompt:
          '请根据我工作区里最近的文件和未完成的事项，帮我列出今天最该做的 3-5 件事，按优先级排序，并给出每件事的下一步动作。如果发现昨天遗留的事，放在最前面。',
      },
      'en-US': {
        name: 'Daily work plan',
        description: 'On workday mornings, sort out what to do today and in what order.',
        prompt:
          'From the recent files and unfinished items in my workspace, list the 3-5 things I should do today, in priority order, with the next action for each. Put anything left over from yesterday first.',
      },
    },
  },
  {
    id: 'meeting-prep',
    icon: '🧭',
    category: 'work',
    schedule: { frequency: 'weekdays', time: '09:00' },
    text: {
      'zh-CN': {
        name: '会议前准备',
        description: '工作日早上提醒你梳理今天会议的议题、目标和待确认问题。',
        prompt:
          '请提醒我为今天的会议做准备：逐个会议列出议题、期望达成的结论、需要提前确认的问题，以及我需要带上的材料。如果我没有告诉你今天有哪些会议，先问我。',
      },
      'en-US': {
        name: 'Meeting preparation',
        description: "On workday mornings, prompt you to sort out today's meetings: agenda, goals, open questions.",
        prompt:
          "Remind me to prepare for today's meetings: for each, the agenda, the outcome I want, the questions to settle beforehand and the materials to bring. If I have not told you what meetings I have today, ask me first.",
      },
    },
  },
  {
    id: 'competitor-watch',
    icon: '🔎',
    category: 'work',
    schedule: { frequency: 'weekly', time: '10:00', weekday: 'MON' },
    text: {
      'zh-CN': {
        name: '竞品动态周报',
        description: '每周一汇总竞品上周的产品、价格和市场动作。',
        prompt:
          '请搜索我关注的竞品（请先在这里写上它们的名字）上周的产品更新、价格调整、融资和重要的市场动作，整理成一张对比表，并指出对我们最值得关注的三点。每条都要附来源。',
      },
      'en-US': {
        name: 'Competitor watch',
        description: "Every Monday, gather last week's product, pricing and market moves of your competitors.",
        prompt:
          "Search for last week's product updates, pricing changes, funding and notable market moves of the competitors I follow (write their names here first). Put them in a comparison table and point out the three things that matter most to us. Give a source for each.",
      },
    },
  },
  {
    id: 'monthly-expense',
    icon: '🧾',
    category: 'work',
    schedule: { frequency: 'monthly', time: '10:00', monthDay: 25 },
    text: {
      'zh-CN': {
        name: '月度报销提醒',
        description: '每月 25 号提醒你整理本月票据、提交报销。',
        prompt:
          '请提醒我整理本月的发票和票据并提交报销：列出常见的遗漏项（出差、打车、餐费、订阅），并问我是否还有没处理的。',
      },
      'en-US': {
        name: 'Monthly expense reminder',
        description: "On the 25th each month, remind you to gather this month's receipts and file expenses.",
        prompt:
          "Remind me to gather this month's invoices and receipts and file my expenses: list the items people usually miss (travel, taxis, meals, subscriptions) and ask whether there is anything left to handle.",
      },
    },
  },
  {
    id: 'daily-english',
    icon: '🔤',
    category: 'learning',
    schedule: { frequency: 'daily', time: '08:30' },
    text: {
      'zh-CN': {
        name: '每日 5 个英语单词',
        description: '每天推荐 5 个高频实用单词，含释义、音标和例句。',
        prompt:
          '请每天推荐 5 个高频实用的英语单词（不要重复前几天的）。每个给出：音标、中文释义、一个简短例句和一句中文翻译。最后出一道小测验题。',
      },
      'en-US': {
        name: 'Five English words a day',
        description: 'Each day, five useful high-frequency words with meaning, pronunciation and an example.',
        prompt:
          'Each day suggest 5 useful, high-frequency English words (not ones from previous days). For each give the pronunciation, a short definition, an example sentence and its translation. Finish with one quick quiz question.',
      },
    },
  },
  {
    id: 'daily-why',
    icon: '💡',
    category: 'learning',
    schedule: { frequency: 'daily', time: '12:00' },
    text: {
      'zh-CN': {
        name: '每日一个为什么',
        description: '每天抛出一个有趣的问题，先让你想，再给出通俗易懂的解答。',
        prompt:
          '请每天抛出一个有趣的「为什么」（科学、历史或生活常识，别重复），先给我一句提示让我想一想，再用通俗易懂的话给出答案和一个延伸知识点。',
      },
      'en-US': {
        name: 'One "why" a day',
        description: 'Each day, an interesting question: a hint to think first, then a clear answer.',
        prompt:
          'Each day pose one interesting "why" (science, history or everyday knowledge, no repeats). Give me a one-line hint to think about first, then a clear plain-language answer and one related fact.',
      },
    },
  },
  {
    id: 'weekly-reading',
    icon: '📚',
    category: 'learning',
    schedule: { frequency: 'weekly', time: '20:00', weekday: 'SUN' },
    text: {
      'zh-CN': {
        name: '每周学习复盘',
        description: '每周日晚上回顾这一周学到了什么，规划下周要学的。',
        prompt:
          '请陪我做每周学习复盘：问我这周学了什么、哪里没学明白，帮我整理成三五条要点，并据此建议下周值得学的一件事。',
      },
      'en-US': {
        name: 'Weekly learning review',
        description: 'Sunday evening: look back on what you learned this week and plan the next.',
        prompt:
          'Run my weekly learning review: ask what I learned this week and what is still unclear, help me boil it down to three to five points, and suggest the one thing most worth learning next week.',
      },
    },
  },
  {
    id: 'evening-review',
    icon: '🌙',
    category: 'life',
    schedule: { frequency: 'daily', time: '21:30' },
    text: {
      'zh-CN': {
        name: '晚间复盘',
        description: '每天晚上用三个问题帮你回顾今天、放下没做完的事。',
        prompt:
          '请在晚上陪我复盘今天：问我今天最有成就感的一件事、最耗精力的一件事，以及明天最想先做的一件事，然后用两句话总结。语气轻松一点。',
      },
      'en-US': {
        name: 'Evening review',
        description: 'Each evening, three questions to look back on the day and let go of the rest.',
        prompt:
          'Walk me through a review of my day in the evening: ask for the one thing I am proudest of, the one that cost me most energy and the one I most want to do first tomorrow, then sum up in two sentences. Keep the tone light.',
      },
    },
  },
  {
    id: 'weather-commute',
    icon: '⛅',
    category: 'life',
    schedule: { frequency: 'weekdays', time: '07:30' },
    text: {
      'zh-CN': {
        name: '天气与出行提醒',
        description: '工作日早上告诉你今天的天气、穿衣建议和出行要注意的事。',
        prompt:
          '请查询我所在城市（请先在这里写上城市名）今天的天气，给出穿衣建议，并提醒是否需要带伞、是否有明显影响出行的天气。控制在五行以内。',
      },
      'en-US': {
        name: 'Weather and commute',
        description: "On workday mornings, today's weather, what to wear and anything that affects getting around.",
        prompt:
          "Check today's weather for my city (write the city name here first), suggest what to wear, and warn me about an umbrella or anything that will clearly affect getting around. Keep it within five lines.",
      },
    },
  },
  {
    id: 'history-today',
    icon: '📅',
    category: 'life',
    schedule: { frequency: 'daily', time: '10:00' },
    text: {
      'zh-CN': {
        name: '历史上的今天',
        description: '每天从科技、电影、音乐等领域挑一件「今天发生过」的有趣事。',
        prompt:
          '请从科技、电影、音乐、体育中挑一件「历史上的今天」发生过的有趣的事，讲清楚来龙去脉，再给出一个让人想继续了解的点。',
      },
      'en-US': {
        name: 'On this day',
        description: 'Each day, one interesting thing that happened on this date, from tech, film, music or sport.',
        prompt:
          'Pick one interesting thing that happened on this date in history from technology, film, music or sport, tell the story clearly, and leave me with one point worth reading more about.',
      },
    },
  },
];

export const getAutomationTemplate = (id: string): AutomationTemplate | undefined =>
  AUTOMATION_TEMPLATES.find((template) => template.id === id);

/**
 * Templates shown on the automations panel itself, two per category — the
 * ones that give the best first impression of what an automation is. Change
 * this array (nothing else) to curate the panel.
 */
const FEATURED_TEMPLATE_IDS = [
  'daily-ai-brief',
  'daily-plan',
  'daily-english',
  'weekly-reading',
  'evening-review',
  'weather-commute',
] as const;

export function getFeaturedAutomationTemplates(): AutomationTemplate[] {
  return FEATURED_TEMPLATE_IDS.map(getAutomationTemplate).filter((t): t is AutomationTemplate => t !== undefined);
}

/** The template's text for a UI language; anything but Chinese reads the English. */
export function getAutomationTemplateText(template: AutomationTemplate, language: string): TemplateText {
  return language.toLowerCase().startsWith('zh') ? template.text['zh-CN'] : template.text['en-US'];
}
