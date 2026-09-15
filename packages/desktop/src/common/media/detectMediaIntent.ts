/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 从输入里认出「我要生成图片/视频」的意图。
 *
 * 为什么需要它：媒体模式是发送栏上的一个开关，默认关着。用户配好了图片模型，
 * 直接说「画一只猫」，消息却交给文本模型 —— 文本模型只会描述或者画 ASCII，
 * 用户看到的是「这产品不会画图」，而不是「我忘了打开开关」。
 *
 * Recognizes "I want a picture / a video" in the composer input.
 *
 * Media mode is a switch on the send box and it defaults to off. Someone who
 * has configured an image model, typed "draw me a cat" and pressed enter hands
 * the request to a text model, which describes one or draws ASCII. What that
 * looks like from outside is a product that cannot draw — not a switch left off.
 *
 * # 只在高置信度时返回结果 / Deliberately conservative
 *
 * 误判是有代价的：生成一张图要花钱。所以命中需要「通用动词 + 图像名词」，或者
 * 一个本身就指向图像的强动词（画/draw）。两条规则之前，先把「分析这张图」这类
 * **看图**的说法整体排掉 —— 那是给视觉模型的活，不是生成。
 *
 * A false positive costs real money, so a match needs either a generic verb
 * AND an image noun, or a verb that already means "make a picture" (画 / draw).
 * Both rules run only after phrasings about reading an existing picture are
 * excluded: those belong to a vision model, not to a generator.
 */

export type MediaIntent = 'image' | 'video' | null;

/**
 * 看图、而不是画图。命中就整体放弃 —— 这类句子里也有「图片」，只看名词会全中。
 *
 * Reading a picture rather than making one. Matching here abandons detection
 * entirely: these sentences contain the same nouns, so a noun-only rule would
 * fire on every one of them.
 */
const ANALYSIS_PATTERNS: RegExp[] = [
  /(分析|识别|看看|看下|看一下|描述|解释|读取|提取|翻译|总结)[^。！？]{0,6}(图|照片|截图|视频)/,
  /(这|那|此)(张|个|幅|段|条)?(图|图片|照片|截图|视频)/,
  /图(片)?(里|中|上)/,
  /视频(里|中)/,
  /\b(analy[sz]e|describe|explain|read|extract|transcribe|summari[sz]e|what'?s?\s+in)\b[^.!?]{0,20}\b(image|picture|photo|screenshot|video)\b/i,
  /\b(this|that|the)\s+(image|picture|photo|screenshot|video)\b/i,
];

/**
 * 「画」「绘制」本身就指向图像，后面不需要再跟「图」——最常见的说法恰恰是
 * 「画一只猫」，要求名词会把它整个漏掉。
 *
 * 但「画」也出现在动画/漫画/画面/画布里，所以用前后文把那些排掉。
 *
 * "Draw" already names the act of making an image, and the most ordinary
 * phrasing — "draw a cat" — carries no image noun at all, so requiring one
 * misses the common case. The lookarounds keep it off words that merely
 * contain the character (动画 animation, 画面 a shot, 画布 a canvas).
 */
const ZH_STRONG_DRAW = /(?<![动漫计图书刻])(画|绘制)(?![面布廊质风家笔展])/;
/**
 * `draw` is the same, minus its idioms — "draw a conclusion" is not a picture.
 */
const EN_STRONG_DRAW =
  /\b(draw|sketch|paint)\b(?!\s+(a\s+)?(conclusion|attention|comparison|parallel|distinction|line\b))/i;

/** 生成动词 / Verbs that mean "produce one". */
const ZH_VERB = '(画|绘|绘制|生成|制作|做|建|创建|设计|来|搞|整|输出|渲染)';
/** 图像名词 / Nouns that name a still image. */
const ZH_IMAGE_NOUN = '(图|图片|图像|照片|插画|插图|海报|封面|头像|logo|壁纸|表情包|贴纸|banner)';
const ZH_VIDEO_NOUN = '(视频|短片|动画|影片|片子|动图)';

const ZH_IMAGE = new RegExp(`${ZH_VERB}[^。！？]{0,8}?${ZH_IMAGE_NOUN}`);
const ZH_VIDEO = new RegExp(`${ZH_VERB}[^。！？]{0,8}?${ZH_VIDEO_NOUN}`);

const EN_VERB = '(draw|generate|create|make|render|paint|design|illustrate|produce)';
const EN_IMAGE_NOUN =
  '(image|images|picture|pictures|photo|photos|illustration|poster|artwork|logo|avatar|wallpaper|icon)';
const EN_VIDEO_NOUN = '(video|videos|clip|clips|animation|movie|footage)';

const EN_IMAGE = new RegExp(`\\b${EN_VERB}\\b[^.!?]{0,24}?\\b${EN_IMAGE_NOUN}\\b`, 'i');
const EN_VIDEO = new RegExp(`\\b${EN_VERB}\\b[^.!?]{0,24}?\\b${EN_VIDEO_NOUN}\\b`, 'i');

/**
 * 代码语境里的「画图」不是要图片文件，是要一段绘图代码。
 *
 * "Draw a chart" inside a coding request wants plotting code, not a rendered
 * picture, and switching modes there would replace a working answer with one.
 */
const CODE_CONTEXT =
  /(代码|函数|脚本|组件|程序|画布|\bcode\b|\bfunction\b|\bscript\b|\bcomponent\b|canvas|matplotlib|echarts|d3|svg|css|html|react|vue|python|写个|写一个)/i;

/**
 * 判断一句话是不是在要图片或视频。
 *
 * 视频优先：「生成一段视频」同时含通用动词和视频名词，若先判图片会误落到图片。
 *
 * Video is tested first: "generate a video" satisfies the shared verb and would
 * otherwise fall through to the image rule.
 */
export const detectMediaIntent = (input: string): MediaIntent => {
  const text = input.trim();
  if (!text || text.length > 2000) return null;

  if (ANALYSIS_PATTERNS.some((pattern) => pattern.test(text))) return null;
  if (CODE_CONTEXT.test(text)) return null;

  if (ZH_VIDEO.test(text) || EN_VIDEO.test(text)) return 'video';
  if (ZH_IMAGE.test(text) || EN_IMAGE.test(text)) return 'image';
  if (ZH_STRONG_DRAW.test(text) || EN_STRONG_DRAW.test(text)) return 'image';
  return null;
};
