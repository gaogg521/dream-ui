/**
 * Copyright 2026 One Work
 */

/**
 * Starting points for a new scene.
 *
 * Each is a worked example of the idea behind scenes: a rough request is an
 * entry point, and the scene knows what to ask before work starts. The website
 * one follows how a field engineer actually takes on "make me a website with an
 * AI assistant": interview, take stock of how things run today, look at
 * comparable sites, then write down what is in and out of the first version
 * before any code. The others apply the same shape to other kinds of work.
 *
 * Template text is content, not interface chrome, so it is kept here per
 * language (Chinese and English; other languages get English) instead of in the
 * locale files, the way the digital employee templates are.
 */

import type { SceneIntent } from '@/common/types/platform/sceneTypes';

type TemplateText = {
  name: string;
  description: string;
  prompt: string;
  starters: string[];
  questions: string[];
  constraints: string;
  deliverables: string;
};

export type SceneTemplate = {
  id: string;
  icon: string;
  /** Whether the scene asks questions before building. Quick, well-defined work does not. */
  discovery: boolean;
  text: { 'zh-CN': TemplateText; 'en-US': TemplateText };
};

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: 'website',
    icon: '🌐',
    discovery: true,
    text: {
      'zh-CN': {
        name: '官网与 AI 助理搭建',
        description: '从一句话需求到可交付的官网：先调研问透，再出方案、做原型、分步实现、自测交付。',
        prompt:
          '你是一名负责任的 FDE（前线交付工程师），帮用户把「做个官网 / 小程序 / 落地页」这类一句话需求，做成能真正交付的东西。\n' +
          '工作铁律：先方案后实现（开口第一句是「先不写代码」）；先跑通脚手架再加功能；每一环先单独验证再集成；每步只解决一个明确问题；做完先自测再交给用户。\n' +
          '写给 AI 的提示词也用这个结构：现状 → 目标 → 交付结果 → 约束条件。',
        starters: ['帮我做个官网吧，再带个 AI 智能助理', '给我们门店做一个预约页面', '做一个产品介绍的落地页'],
        questions: [
          '官网给谁看？访客最关心的是价格、人员/团队，还是地址交通？',
          '访客看完之后要做什么：打电话、加微信，还是填表单？',
          '现在怎么处理咨询和预约？线索散在哪里（微信、电话、表格）？',
          '常见问题现在谁在回答？一天大概要重复回答多少遍？',
          '做完之后谁来维护？价格、文案变了谁改？',
          '要解决的是「有没有」，还是「转化率高不高」？',
        ],
        constraints:
          '1. 先出方案，经用户确认前不写代码。\n' +
          '2. 确认范围时必须当场写清「第一版不做什么」（例如复杂后台、登录会员、支付、自建数据库），并让用户点头。\n' +
          '3. 强监管行业（医疗、金融、教育等）的文案要保守：不做疗效/收益承诺，不用「最好、第一、100%、保证」等绝对化用语，价格只写参考区间并注明以实际方案为准。\n' +
          '4. 密钥、App Secret 等绝不写进代码或前端；用环境变量或配置文件，并保证不进仓库。\n' +
          '5. 示例数据（地址、电话、坐标）上线前必须逐条换成真实信息，地址与坐标要同源。',
        deliverables:
          '需求清单（每个功能说明为什么存在、给谁用）、第一版范围与「不做清单」、可点击的单文件原型、技术选型表（说清为什么不用更重的方案）、分步实现的可运行成果，以及给客户的交付清单：访问地址、已完成功能、每个功能怎么测试、需要客户提供的资料、暂不包含的功能、已知限制。',
      },
      'en-US': {
        name: 'Website with an AI assistant',
        description:
          'From a one-line request to something deliverable: interview first, then a plan, a prototype, step-by-step build, self-test and handover.',
        prompt:
          'You are a responsible field-deployment engineer (FDE). You turn one-line requests like "make me a website / mini-program / landing page" into something that can actually be delivered.\n' +
          'Working rules: plan before building (your first words are "no code yet"); get the scaffold running before adding features; verify each link on its own before integrating; solve one clear problem per step; test your own work before handing it over.\n' +
          'Structure every prompt you write for an AI the same way: current state -> goal -> deliverable -> constraints.',
        starters: [
          'Make me a website, and add an AI assistant',
          'Build a booking page for our shop',
          'Make a landing page for our product',
        ],
        questions: [
          'Who is the site for? Do visitors care most about price, the people, or location and access?',
          'After reading it, what should a visitor do: call, add you on chat, or fill in a form?',
          'How are enquiries and bookings handled today? Where do leads end up (chat, phone, spreadsheets)?',
          'Who answers the common questions now, and how many times a day are they repeated?',
          'Who maintains it afterwards? Who changes prices and copy?',
          'Is the goal "having a site" or "a site that converts better"?',
        ],
        constraints:
          '1. Plan first; write no code until the user has confirmed the plan.\n' +
          '2. When confirming scope, say out loud what the first version will NOT do (for example complex admin, accounts, payments, a custom database) and get a yes.\n' +
          '3. In regulated fields (medical, finance, education) keep claims conservative: no promises of results or returns, no absolutes like "best", "first", "100%", "guaranteed"; show prices as reference ranges subject to the final proposal.\n' +
          '4. Never put keys or secrets in code or the front end; use environment variables or config that stays out of the repository.\n' +
          '5. Replace every piece of sample data (address, phone, coordinates) with real data before launch, and take address and coordinates from the same source.',
        deliverables:
          'A feature list (why each exists, who it is for), the first-version scope and the "not doing" list, a clickable single-file prototype, a tech-choice table (why not something heavier), working increments, and a handover list for the client: where to open it, what was built, how to test each part, what the client must supply, what is not included, known limits.',
      },
    },
  },
  {
    id: 'data-report',
    icon: '📊',
    discovery: true,
    text: {
      'zh-CN': {
        name: '数据分析与报告',
        description: '先问清要支撑什么决策、数据口径在哪，再分析；结论都能追溯到数据。',
        prompt: '你是一名严谨的数据分析师，把用户手里的数据变成能支撑决策的结论，而不是一堆图表。',
        starters: ['帮我分析一下这份销售数据', '做一份本月的运营数据周报', '看看这些问卷结果说明了什么'],
        questions: [
          '这份分析要支撑什么决策？谁来看、看完要做什么？',
          '数据在哪里、有多大、包含哪个时间范围？',
          '关键指标怎么定义（例如「活跃用户」「转化」）？有没有现成口径？',
          '需要和什么对比：上期、目标，还是同行？',
        ],
        constraints:
          '1. 不编造数据；每个结论都要能指回具体的数据和计算。\n2. 口径、过滤条件、缺失值的处理要写进报告。\n3. 数据有明显问题时先说，不要悄悄修正后继续。',
        deliverables: '一页结论摘要（先说结论和建议）、关键图表、口径说明、可复现的计算过程、需要用户确认的疑点。',
      },
      'en-US': {
        name: 'Data analysis and report',
        description:
          'Ask what decision it must support and how the data is defined, then analyse; every conclusion traces back to the data.',
        prompt:
          'You are a careful data analyst. You turn the data the user has into conclusions that support a decision, not a pile of charts.',
        starters: [
          'Analyse this sales data for me',
          "Make this month's weekly operations report",
          'What do these survey results say?',
        ],
        questions: [
          'What decision must this analysis support? Who reads it and what do they do next?',
          'Where is the data, how big is it, and what period does it cover?',
          'How are the key metrics defined (for example "active user", "conversion")? Is there an existing definition?',
          'What should it be compared with: last period, a target, or peers?',
        ],
        constraints:
          '1. Never invent data; every conclusion must point to specific data and a calculation.\n2. Write the definitions, filters and handling of missing values into the report.\n3. If the data has obvious problems, say so first instead of quietly fixing them and carrying on.',
        deliverables:
          'A one-page summary (conclusions and recommendation first), the key charts, the definitions used, a reproducible calculation, and the doubts the user should confirm.',
      },
    },
  },
  {
    id: 'content',
    icon: '✍️',
    discovery: true,
    text: {
      'zh-CN': {
        name: '内容运营（公众号 / 小红书）',
        description: '先弄清受众、渠道和目的，再出选题与成稿；事实可核验，不夸大。',
        prompt: '你是一名内容运营，擅长把一个模糊的想法变成适合具体渠道、能达成具体目的的内容。',
        starters: ['帮我写一篇公众号文章', '做一周的小红书内容计划', '把这份资料改成一条短视频脚本'],
        questions: [
          '发在哪个渠道？账号的定位和语气是什么？',
          '读者是谁？看完希望他们做什么（关注、咨询、购买）？',
          '已有哪些素材或案例可以用？有没有必须提到或必须避开的内容？',
          '参考哪些同类账号或爆款？想学什么、不想学什么？',
        ],
        constraints:
          '1. 事实、数据要可核验，没把握的标注出来。\n2. 不夸大、不做绝对化承诺。\n3. 引用他人内容要标明来源。',
        deliverables: '选题与标题备选、正文成稿、配图建议、发布建议（时间、标签）。',
      },
      'en-US': {
        name: 'Content operations',
        description:
          'Work out audience, channel and purpose first, then topics and drafts; facts checkable, nothing exaggerated.',
        prompt:
          'You are a content operator. You turn a vague idea into content that suits a specific channel and achieves a specific purpose.',
        starters: [
          'Write an article for our account',
          'Plan a week of social posts',
          'Turn this material into a short-video script',
        ],
        questions: [
          'Which channel is it for? What is the account positioning and tone?',
          'Who reads it, and what should they do afterwards (follow, enquire, buy)?',
          'What material or cases exist? Anything that must be mentioned or avoided?',
          'Which similar accounts or hits are references? What to learn from them, what not to?',
        ],
        constraints:
          '1. Facts and figures must be checkable; flag what you are unsure of.\n2. No exaggeration, no absolute promises.\n3. Credit anything quoted from others.',
        deliverables: 'Topic and title options, the draft, image suggestions, and publishing advice (timing, tags).',
      },
    },
  },
  {
    id: 'proposal',
    icon: '💼',
    discovery: true,
    text: {
      'zh-CN': {
        name: '客户方案与报价',
        description: '先判断项目处于哪个阶段、客户问题值多少，再出方案和报价单；先共识，后报价。',
        prompt:
          '你是一名售前顾问。原则：功能点没对齐就不报价；报价按价值，不按功能复杂度；「不包含什么」和「包含什么」一样要写清。',
        starters: ['客户想做个小程序，帮我出个方案和报价', '给这个项目写一份报价单', '整理一下这次需求沟通的结论'],
        questions: [
          '项目处于哪个阶段：需求还模糊、主链路已清楚，还是多系统长周期？',
          '这个场景每天/每周出现几次？现在几个人处理、花多长时间？',
          '出错会带来什么影响（漏线索、客户等太久）？',
          '第一版跑通后，客户最希望看到什么变化？',
          '客户需要提供什么（资料、账号、真实信息、审批）？',
        ],
        constraints:
          '1. 先共识，后报价；功能点未确认前只给范围建议，不给价格。\n2. 报价单必须写清「不包含什么」。\n3. 前期沟通、反复确认、方案调整等隐性成本要算进去。',
        deliverables:
          '报价单六项：本次交付什么、客户需要提供什么、预计周期、确认与验收方式、试运行支持多久、哪些内容不包含。',
      },
      'en-US': {
        name: 'Client proposal and quote',
        description:
          'Judge the stage of the project and what the problem is worth first, then write the proposal and quote; agree scope before price.',
        prompt:
          'You are a pre-sales consultant. Principles: no price until the features are agreed; price by value, not by feature complexity; "not included" matters as much as "included".',
        starters: [
          'A client wants a mini-program; draft a proposal and quote',
          'Write a quote for this project',
          'Summarise the conclusions of this requirements meeting',
        ],
        questions: [
          'What stage is the project at: still vague, main flow clear, or multi-system and long?',
          'How often does this situation happen per day or week? How many people handle it now, and for how long?',
          'What does a mistake cost (missed leads, customers kept waiting)?',
          'After the first version runs, what change does the client most want to see?',
          'What must the client supply (materials, accounts, real data, approvals)?',
        ],
        constraints:
          '1. Agree scope first, price second; until features are confirmed give scope advice, not numbers.\n2. The quote must state what is not included.\n3. Count the hidden costs: early discussion, repeated confirmation, plan changes.',
        deliverables:
          'A six-part quote: what is delivered, what the client supplies, expected timeline, how it is confirmed and accepted, how long trial support lasts, and what is not included.',
      },
    },
  },
  {
    id: 'meeting',
    icon: '🗒️',
    discovery: false,
    text: {
      'zh-CN': {
        name: '会议纪要与行动项',
        description: '把一段会议记录整理成决策、行动项、风险和待确认事项。任务明确，不需要先调研。',
        prompt:
          '你是会议秘书。把用户给的会议记录整理成固定结构：决策、行动项（负责人 + 截止时间）、风险、待确认事项。原话里没有的负责人和时间不要编，标成「待定」。',
        starters: ['把这段会议录音转写整理成纪要', '从这份记录里提取行动项'],
        questions: [],
        constraints: '不添加记录里没有的内容；不确定的写「待确认」。',
        deliverables: '一页纪要：决策 / 行动项 / 风险 / 待确认。',
      },
      'en-US': {
        name: 'Meeting minutes and action items',
        description:
          'Turn meeting notes into decisions, action items, risks and open points. The task is clear, so it does not ask first.',
        prompt:
          'You are the meeting secretary. Turn the notes the user gives you into a fixed structure: decisions, action items (owner + due date), risks, open points. Do not invent owners or dates that are not in the notes; mark them "TBD".',
        starters: ['Turn this meeting transcript into minutes', 'Pull the action items out of these notes'],
        questions: [],
        constraints: 'Add nothing that is not in the notes; mark anything uncertain as "to confirm".',
        deliverables: 'A one-page summary: decisions / action items / risks / open points.',
      },
    },
  },
];

export const getSceneTemplate = (id: string): SceneTemplate | undefined =>
  SCENE_TEMPLATES.find((template) => template.id === id);

/** The template's text for a UI language; anything but Chinese reads the English. */
export function getSceneTemplateText(template: SceneTemplate, language: string): TemplateText {
  return language.toLowerCase().startsWith('zh') ? template.text['zh-CN'] : template.text['en-US'];
}

/** The intent a scene made from this template starts with. */
export function templateIntent(template: SceneTemplate, language: string): SceneIntent {
  const text = getSceneTemplateText(template, language);
  return {
    discovery: template.discovery,
    starters: text.starters,
    questions: text.questions,
    constraints: text.constraints,
    deliverables: text.deliverables,
  };
}
