/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the app knows about the skill corpus it ships: which category each skill
 * belongs to, which pill it lands under, and how its name and blurb read in the
 * active language.
 *
 * It lives in its own module because three screens need the same answers -- the
 * Skills Hub list, the pill row above it, and the skill detail page -- and the
 * last time this rule was written in two places the copies disagreed: the pill
 * key checked `source` before the category map, so 114 classified skills showed
 * up uncategorized and untranslated. One module, one answer.
 */

import { useTranslation } from 'react-i18next';

/**
 * The fields these helpers actually read. Deliberately structural rather than
 * the full `SkillInfo`: the list and the detail page each declare their own
 * shape of a skill, and neither needs to know about the other's.
 */
export type SkillCorpusEntry = {
  name: string;
  description: string;
  display_name?: string;
  source?: 'builtin' | 'custom' | 'cron' | 'extension' | 'team';
};

/**
 * Category for each built-in skill.
 *
 * The backend's `category` field is enterprise metadata (C2-2) and is empty
 * for everything in the personal build, so there is no category data to read
 * — these are ours to assign, and only for the corpus we ship. A user's own
 * imports have no basis for a category and stay under "custom".
 */
export const BUILTIN_SKILL_CATEGORY: Record<string, string> = {
  '12306': 'life',
  '12306-train-assistant': 'life',
  'a-stock-data': 'data',
  'ai-comic-drama-shot-maker': 'media',
  'ai-short-drama-script': 'content',
  'ai-song-cover-studio': 'media',
  'ai-storyboard-generator': 'media',
  'ai-video-image-music-studio': 'media',
  'analyze-recruitment-trends': 'recruit',
  'android-apk-builder': 'dev',
  'android-native-dev': 'dev',
  'apple-design': 'dev',
  'ardot-skillhub': 'dev',
  'assist-payroll-approval': 'recruit',
  'autocad-drawing': 'diagram',
  'bid-pipeline': 'product',
  'bilibili-script': 'content',
  btpanel: 'dev',
  'build-job-profile': 'recruit',
  'chinese-poetry': 'creative',
  'ci-cd-and-automation': 'dev',
  'cn-ecommerce-search': 'data',
  'comfyui-ops': 'dev',
  'content-factory': 'content',
  'creative-brainstorming-board': 'product',
  cron: 'system',
  'delivery-no-pseudoblock': 'dev',
  'design-first': 'dev',
  'dingtalk-unified': 'workplace',
  'douyin-video-fetch': 'media',
  drawio: 'diagram',
  'element-ui-guide': 'dev',
  'expense-merger': 'office',
  'flight-trip-advisor': 'life',
  'fore-vip-geo-optimizer': 'content',
  'fore-vip-oss': 'workplace',
  'fortune-master': 'life',
  'frontend-design': 'dev',
  'frontend-dev': 'dev',
  'fund-analysis': 'data',
  github: 'dev',
  gog: 'workplace',
  'gongwen-format': 'office',
  'govproc-method-selector': 'product',
  grilling: 'dev',
  'h3-prompt-writing': 'media',
  'hot-search-cn': 'research',
  'identify-key-talent': 'recruit',
  'imap-smtp-email': 'workplace',
  'invoice-verify': 'data',
  'ios-application-dev': 'dev',
  'ixhlink-skills-id-photo-standard': 'media',
  'karpathy-guidelines': 'dev',
  kdocs: 'office',
  'lark-unified': 'workplace',
  'lexiang-knowledge-base': 'workplace',
  'local-ocr-linux': 'media',
  'local-ocr-macos': 'media',
  'local-ocr-windows': 'media',
  'markitdown-skill': 'office',
  mcporter: 'dev',
  'meeting-minutes-assistant': 'office',
  mermaid: 'diagram',
  'morph-ppt': 'diagram',
  'morph-ppt-3d': 'diagram',
  officecli: 'office',
  'officecli-academic-paper': 'office',
  'officecli-data-dashboard': 'office',
  'officecli-docx': 'office',
  'officecli-financial-model': 'office',
  'officecli-pitch-deck': 'office',
  'officecli-pptx': 'office',
  'officecli-word-form': 'office',
  'officecli-xlsx': 'office',
  'old-photo-restorer': 'media',
  'one-config': 'system',
  'one-troubleshooting': 'system',
  'one-webui-public': 'system',
  'one-webui-setup': 'system',
  'openclaw-setup': 'system',
  'patent-disclosure-writer': 'office',
  pdf: 'media',
  peekaboo: 'system',
  'pm-toolkit-zxh': 'data',
  'poster-design-studio': 'media',
  'price-compare': 'data',
  'proboost-tiktok-shop-analysis': 'data',
  'proboost-tiktok-video-analysis': 'data',
  'product-discovery-zxh': 'product',
  'product-manager': 'product',
  'product-strategy-zxh': 'product',
  'product-trend-researcher': 'product',
  'pubmed-literature-search': 'research',
  'qq-email': 'workplace',
  qqmusic: 'media',
  'remove-watermark': 'media',
  'resume-design': 'media',
  'screen-automation': 'system',
  'security-and-hardening': 'dev',
  'self-media-distribution': 'content',
  'seo-content-optimizer': 'content',
  'skill-creator': 'dev',
  'skill-scanner': 'dev',
  'smart-product-selector': 'data',
  'social-media-content': 'content',
  'software-copyright-cn': 'office',
  'solo-company': 'product',
  'story-roleplay': 'creative',
  superpowers: 'dev',
  'supertonic-tts': 'media',
  'talking-avatar-video': 'media',
  taobao: 'data',
  'tax-policy-knowledge': 'data',
  'tencent-meeting-skill': 'workplace',
  'the-entrepreneurship-handbook': 'product',
  'tiktok-script': 'content',
  'totorosir-work-report': 'office',
  'toutiao-search': 'content',
  'travel-guide-assistant': 'life',
  'user-persona-builder': 'product',
  'video-to-ppt': 'office',
  wacli: 'workplace',
  'weather-now': 'life',
  'weaver-e10-jucailin': 'recruit',
  'weaver-e10-plan': 'workplace',
  'web-access': 'research',
  'wechat-miniprogram': 'dev',
  'wechat-official-account': 'content',
  'wechat-viral-video-writer': 'content',
  'wechat-wenyan-publish': 'content',
  'wechatpay-basic-payment': 'data',
  'wecom-unified': 'workplace',
  'weekly-literature-briefing': 'research',
  'weekly-report-generator': 'office',
  'weixin-file-send': 'media',
  weiyun: 'workplace',
  'x-recruiter': 'recruit',
  'xiaohongshu-recruiter': 'recruit',
  'xiaoliebian-scrm': 'content',
  'youtube-video-research': 'research',
  'zxh-api-connector-builder': 'dev',
};

export const BUILTIN_CATEGORY_ORDER = [
  'office',
  'content',
  'media',
  'diagram',
  'dev',
  'data',
  'workplace',
  'recruit',
  'product',
  'research',
  'life',
  'system',
  'creative',
];

/**
 * One pill row over two different axes, the way a reader actually looks for a
 * skill: a category, or "the ones I brought myself". A skill outside the
 * shipped corpus falls under its source, so anything new is still reachable
 * before anyone classifies it.
 *
 * The category map is consulted BEFORE `source`, and that ordering is the whole
 * point. Only 27 of the 141 shipped skills land in `builtin_skills_dir`; the
 * rest are materialized into the user skills directory and therefore come back
 * from the backend as `source: 'custom'` — the backend's word for "not in the
 * built-in directory", not for "the user wrote this". Checking `source` first
 * sent 115 of the 141 classified skills to one undifferentiated "Custom" pill
 * and left their category chips blank: a rule written in two places where the
 * copies disagreed. Team skills keep their own pill regardless — an enterprise
 * admin distributes those, and which pill they sit under is a permissions fact.
 */
export const skillPillKey = (skill: SkillCorpusEntry): string => {
  if (skill.source === 'team') return 'source:team';
  const category = BUILTIN_SKILL_CATEGORY[skill.name];
  if (category) return `cat:${category}`;
  return skill.source === 'custom' ? 'source:custom' : 'source:builtin';
};

/**
 * Localized display text for the built-in skills.
 *
 * NOT a translation of `description`: that field is model-facing --
 * `build_skills_index_text` renders it into the system prompt as
 * "- **name**: description", trigger wording included -- so translating it
 * per UI language would change what the model matches on. This overlays the
 * display layer only, the way `display_name` already overlays `name`.
 *
 * Scoped to the shipped corpus by the same category map the pills use, not by
 * `source`: 114 of those 141 skills are materialized into the user skills
 * directory and come back as `source: 'custom'`, so keying on source covered
 * 27 of them and left the rest Chinese in an English UI. A skill outside the
 * map -- one the user really did write or import -- keeps its authored text,
 * which is the boundary that actually matters. Team skills are excluded
 * outright: an enterprise admin authored those.
 */
export const useBuiltinSkillDisplay = () => {
  const { t } = useTranslation();
  return (skill: SkillCorpusEntry) => {
    const fallbackTitle = skill.display_name || skill.name;
    const shipped = skill.source !== 'team' && Boolean(BUILTIN_SKILL_CATEGORY[skill.name]);
    if (!shipped) return { title: fallbackTitle, description: skill.description };
    const base = `settings.skillsHub.builtinSkill.${skill.name}`;
    return {
      title: t(`${base}.title`, { defaultValue: fallbackTitle }),
      description: t(`${base}.desc`, { defaultValue: skill.description }),
    };
  };
};
