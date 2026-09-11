import { ipcBridge } from '@/common';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Button, Checkbox, Message, Modal } from '@arco-design/web-react';
import { Delete, Lightning, Puzzle, Search, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import { buildSkillImportNotice, getSkillImportErrorMessage } from './skillImportMessages';
import SkillUsedByStack, { getAssistantsUsingSkill } from './skillsHub/SkillUsedByStack';
import { SKILLS_ROUTES } from './skillsHub/skillsRoutes';

// Skill 信息类型 / Skill info type
interface SkillInfo {
  name: string;
  description: string;
  location: string;
  /**
   * Relative location under the builtin-skills corpus (e.g.
   * `auto-inject/cron/SKILL.md`). Present only for built-in sources; the
   * export-to-external-source flow still uses absolute `location` paths.
   */
  relative_location?: string;
  is_auto_inject: boolean;
  is_custom: boolean;
  source?: 'builtin' | 'custom' | 'cron' | 'extension' | 'team';
  /** Enterprise category (C2-2), read from the SKILL.md frontmatter of team skills. */
  category?: string;
  tags?: string[];
  /** Human-facing display name from SKILL.md frontmatter (often CJK). Display-only. */
  display_name?: string;
  /** Icon file beside SKILL.md, served at `GET /api/skills/{name}/icon`. Display-only. */
  icon_file?: string;
}

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
export const skillPillKey = (skill: SkillInfo): string => {
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
const useBuiltinSkillDisplay = () => {
  const { t } = useTranslation();
  return (skill: SkillInfo) => {
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

/** Same pill styling as the expert marketplace, so the two tabs read alike. */
const skillSourcePillClass = (active: boolean) =>
  `inline-flex cursor-pointer select-none items-center rounded-999px border border-solid px-12px py-6px text-13px leading-none transition-colors ${
    active
      ? 'border-transparent bg-primary-light-1 font-600 text-primary'
      : 'border-border-2 bg-fill-1 text-t-secondary hover:bg-fill-2 hover:text-t-primary'
  }`;

const isAutoInjectedBuiltinSkill = (skill: SkillInfo) => skill.source === 'builtin' && skill.is_auto_inject;

interface SkillImportRecord {
  id: string;
  operation_id: string;
  source_label: string;
  source_path?: string;
  source_name: string;
  skill_name?: string;
  status: 'imported' | 'failed' | 'overwritten' | string;
  error_code?: string;
  error_path?: string;
  actual_bytes?: number;
  limit_bytes?: number;
  line?: number;
  column?: number;
  created_at: number;
}

interface SkillImportLimits {
  max_file_bytes: number;
  max_total_bytes: number;
}

interface SkillImportHistoryGroup {
  operationId: string;
  sourceLabel: string;
  createdAt: number;
  importedCount: number;
  failedCount: number;
  records: SkillImportRecord[];
}

// Normalize skill name for data-testid usage
const normalizeTestId = (name: string): string => {
  return name.replace(/[:/\s<>"'|?*]/g, '-');
};

const getAvatarColorClass = (name: string) => {
  if (!name) return 'bg-[#165DFF] text-white';
  const colors = [
    'bg-[#165DFF] text-white', // Blue
    'bg-[#00B42A] text-white', // Green
    'bg-[#722ED1] text-white', // Purple
    'bg-[#F5319D] text-white', // Pink
    'bg-[#F77234] text-white', // Orange
    'bg-[#14C9C9] text-white', // Cyan
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const formatBytes = (bytes?: number): string | null => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
};

const buildImportHistoryGroups = (records: SkillImportRecord[]): SkillImportHistoryGroup[] => {
  const byOperation = new Map<string, SkillImportHistoryGroup>();
  for (const record of records) {
    const existing = byOperation.get(record.operation_id);
    const group =
      existing ??
      ({
        operationId: record.operation_id,
        sourceLabel: record.source_label,
        createdAt: record.created_at,
        importedCount: 0,
        failedCount: 0,
        records: [],
      } satisfies SkillImportHistoryGroup);
    group.records.push(record);
    group.createdAt = Math.max(group.createdAt, record.created_at);
    if (record.status === 'failed') {
      group.failedCount += 1;
    } else {
      group.importedCount += 1;
    }
    byOperation.set(record.operation_id, group);
  }
  return Array.from(byOperation.values()).toSorted((a, b) => b.createdAt - a.createdAt);
};

const hasImportedRecords = (group: SkillImportHistoryGroup): boolean =>
  group.records.some((r) => r.status !== 'failed');

interface SkillsHubSettingsProps {
  /** When false, renders without SettingsPageWrapper — useful for embedding in a tab */
  withWrapper?: boolean;
}

const SkillsHubSettings: React.FC<SkillsHubSettingsProps> = ({ withWrapper = true }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const skillsRoutes = SKILLS_ROUTES;
  const highlightName = searchParams.get('highlight');
  const isImportHistoryView =
    location.pathname === skillsRoutes.importHistoryPath || searchParams.get('view') === 'import-history';
  const [highlightedSkill, setHighlightedSkill] = useState<string | null>(null);
  const skillRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [loading, setLoading] = useState(false);
  const builtinSkillDisplay = useBuiltinSkillDisplay();
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  /** Source pill filter, mirroring the expert marketplace's category pills. */
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [search_query, setSearchQuery] = useState('');
  const [importHistory, setImportHistory] = useState<SkillImportRecord[]>([]);
  const [importLimits, setImportLimits] = useState<SkillImportLimits | null>(null);
  // Batch management: multi-select custom skills for bulk deletion.
  const [batchMode, setBatchMode] = useState(false);
  const [selectedSkillNames, setSelectedSkillNames] = useState<Set<string>>(new Set());
  const { data: assistantCatalog } = useSWR<Assistant[]>('assistants.list', () => ipcBridge.assistants.list.invoke());

  const openSkillDetail = useCallback(
    (skillName: string) => {
      void navigate(skillsRoutes.detailPath(skillName));
    },
    [navigate, skillsRoutes]
  );

  const mySkills = useMemo(
    () =>
      availableSkills.filter((s) => s.source !== 'extension' && s.source !== 'cron' && !isAutoInjectedBuiltinSkill(s)),
    [availableSkills]
  );
  const customSkills = useMemo(() => mySkills.filter((s) => s.source === 'custom'), [mySkills]);
  const builtinAutoSkills = useMemo(() => availableSkills.filter(isAutoInjectedBuiltinSkill), [availableSkills]);
  const extensionSkills = useMemo(() => availableSkills.filter((s) => s.source === 'extension'), [availableSkills]);
  const importHistoryGroups = useMemo(() => buildImportHistoryGroups(importHistory), [importHistory]);

  const filteredSkills = useMemo(() => {
    const lowerQuery = search_query.trim().toLowerCase();
    const matched = mySkills.filter((s) => {
      // Pill and search narrow independently, same as the expert marketplace.
      if (sourceFilter && skillPillKey(s) !== sourceFilter) return false;
      if (!lowerQuery) return true;
      return s.name.toLowerCase().includes(lowerQuery) || Boolean(s.description?.toLowerCase().includes(lowerQuery));
    });
    // Skills shipping a real icon lead; the rest fall back to a generated
    // letter tile, and a grid that mixes the two at random reads as unfinished.
    // `toSorted` is stable, so within each half the backend's order survives.
    return matched.toSorted((a, b) => Number(Boolean(b.icon_file)) - Number(Boolean(a.icon_file)));
  }, [mySkills, search_query, sourceFilter]);

  /** Counts per source, so a pill can show how many it will leave behind. */
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of mySkills) {
      const key = skillPillKey(skill);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [mySkills]);
  // C2-2: group the visible list by enterprise category. Skills without a
  // category keep their original flat rendering (personal mode looks exactly
  // as before); category sections render first, in first-appearance order.
  const groupedSkills = useMemo(() => {
    const groups: Array<{ category?: string; skills: SkillInfo[] }> = [];
    const byCategory = new Map<string, { category: string; skills: SkillInfo[] }>();
    const uncategorized: { skills: SkillInfo[] } = { skills: [] };
    for (const skill of filteredSkills) {
      const category = skill.category?.trim();
      if (!category) {
        uncategorized.skills.push(skill);
        continue;
      }
      let group = byCategory.get(category);
      if (!group) {
        group = { category, skills: [] };
        byCategory.set(category, group);
        groups.push(group);
      }
      group.skills.push(skill);
    }
    if (uncategorized.skills.length > 0) groups.push(uncategorized);
    return groups;
  }, [filteredSkills]);
  // Batch select-all / checkboxes only apply to custom skills in the visible list.
  const filteredCustomSkills = useMemo(() => filteredSkills.filter((s) => s.source === 'custom'), [filteredSkills]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [skills, history, limits] = await Promise.all([
        ipcBridge.fs.listAvailableSkills.invoke(),
        ipcBridge.fs.listSkillImportHistory.invoke(),
        ipcBridge.fs.getSkillImportLimits.invoke(),
      ]);
      setAvailableSkills(skills);
      setImportHistory(history as SkillImportRecord[]);
      setImportLimits(limits);
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      Message.error(t('settings.skillsHub.fetchError', { defaultValue: 'Failed to fetch skills' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Scroll to and highlight a skill when navigated with ?highlight=skillName
  useEffect(() => {
    if (!highlightName || loading) return;
    const el = skillRefs.current[highlightName];
    if (el) {
      // Small delay to ensure layout is settled
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedSkill(highlightName);
        // Clear highlight after animation
        const timer = setTimeout(() => setHighlightedSkill(null), 2000);
        // Clean up the search param so refreshing won't re-highlight
        setSearchParams({}, { replace: true });
        return () => clearTimeout(timer);
      });
    }
  }, [highlightName, loading, availableSkills, setSearchParams]);

  const showImportHistory = useCallback(() => {
    void navigate(skillsRoutes.importHistoryPath);
  }, [navigate, skillsRoutes.importHistoryPath]);

  const showSkillList = useCallback(() => {
    void navigate(skillsRoutes.listPath);
  }, [navigate, skillsRoutes.listPath]);

  const handleImport = async (skillPath: string) => {
    try {
      const result = await ipcBridge.fs.importSkills.invoke({ skill_path: skillPath });
      const notice = buildSkillImportNotice(result, t);
      if (notice.type === 'error') {
        Message.error(notice.message);
      } else if (notice.type === 'warning') {
        Message.warning(notice.message);
      } else {
        Message.success(notice.message);
      }
      if (notice.importedNames.length > 0) {
        setSearchQuery('');
        void fetchData();
      } else if (notice.type !== 'success') {
        void fetchData();
      }
    } catch (error) {
      console.error('Failed to import skill:', error);
      Message.error(getSkillImportErrorMessage(error, t));
    }
  };

  const handleDelete = async (skillName: string) => {
    try {
      await ipcBridge.fs.deleteSkill.invoke({ skill_name: skillName });
      Message.success(t('settings.skillsHub.deleteSuccess', { defaultValue: 'Skill deleted' }));
      void fetchData();
    } catch (error) {
      console.error('Failed to delete skill:', error);
      Message.error(t('settings.skillsHub.deleteError', { defaultValue: 'Error deleting skill' }));
    }
  };

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedSkillNames(new Set());
  }, []);

  const toggleSkillSelected = useCallback((skillName: string) => {
    setSelectedSkillNames((prev) => {
      const next = new Set(prev);
      if (next.has(skillName)) {
        next.delete(skillName);
      } else {
        next.add(skillName);
      }
      return next;
    });
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (selectedSkillNames.size === 0) return;
    Modal.confirm({
      title: t('settings.skillsHub.batchDeleteConfirmTitle', { defaultValue: 'Delete Skills' }),
      content: t('settings.skillsHub.batchDeleteConfirmContent', {
        count: selectedSkillNames.size,
        defaultValue: `Are you sure you want to delete the ${selectedSkillNames.size} selected skill(s)?`,
      }),
      okButtonProps: { status: 'warning' },
      okText: t('common.delete', { defaultValue: 'Delete' }),
      wrapClassName: 'modal-delete-skill',
      onOk: async () => {
        const names = Array.from(selectedSkillNames);
        const results = await Promise.allSettled(
          names.map((name) => ipcBridge.fs.deleteSkill.invoke({ skill_name: name }))
        );
        const successCount = results.filter((r) => r.status === 'fulfilled').length;
        const failedCount = results.length - successCount;
        if (failedCount === 0) {
          Message.success(
            t('settings.skillsHub.batchDeleteSuccess', {
              count: successCount,
              defaultValue: `Deleted ${successCount} skill(s)`,
            })
          );
        } else if (successCount > 0) {
          Message.warning(
            t('settings.skillsHub.batchDeletePartial', {
              successCount,
              failedCount,
              defaultValue: `Deleted ${successCount} skill(s), ${failedCount} failed`,
            })
          );
        } else {
          Message.error(t('settings.skillsHub.deleteError', { defaultValue: 'Error deleting skill' }));
        }
        exitBatchMode();
        void fetchData();
      },
    });
  }, [selectedSkillNames, exitBatchMode, fetchData, t]);

  const allVisibleSelected =
    filteredCustomSkills.length > 0 && filteredCustomSkills.every((s) => selectedSkillNames.has(s.name));
  const toggleSelectAllVisible = () => {
    setSelectedSkillNames((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredCustomSkills.forEach((s) => next.delete(s.name));
      } else {
        filteredCustomSkills.forEach((s) => next.add(s.name));
      }
      return next;
    });
  };

  const handleManualImport = async () => {
    try {
      const result = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Skill folders or zip archives', extensions: ['zip'] }],
      });
      if (result && result.length > 0) {
        await handleImport(result[0]);
      }
    } catch (error) {
      console.error('Failed to open directory dialog:', error);
    }
  };

  const getImportHistoryStatusLabel = (group: SkillImportHistoryGroup) => {
    if (group.failedCount > 0 && hasImportedRecords(group)) {
      return t('settings.skillsHub.importHistoryStatusPartial', { defaultValue: 'Partial' });
    }
    if (group.failedCount > 0) {
      return t('settings.skillsHub.importHistoryStatusFailed', { defaultValue: 'Failed' });
    }
    if (group.records.some((record) => record.status === 'overwritten')) {
      return t('settings.skillsHub.importHistoryStatusOverwritten', { defaultValue: 'Overwritten' });
    }
    return t('settings.skillsHub.importHistoryStatusSuccess', { defaultValue: 'Success' });
  };

  const getImportHistoryStatusClass = (group: SkillImportHistoryGroup) => {
    if (group.failedCount > 0) {
      return 'bg-[rgba(var(--warning-6),0.10)] text-warning-6 border-[rgba(var(--warning-6),0.20)]';
    }
    if (group.records.some((record) => record.status === 'overwritten')) {
      return 'bg-[rgba(var(--warning-6),0.10)] text-warning-6 border-[rgba(var(--warning-6),0.20)]';
    }
    return 'bg-[rgba(var(--success-6),0.10)] text-[rgb(var(--success-6))] border-[rgba(var(--success-6),0.20)]';
  };

  const getFailedImportRepairTitle = (record: SkillImportRecord) => {
    switch (record.error_code) {
      case 'SKILL_IMPORT_FILE_TOO_LARGE':
        return t('settings.skillsHub.importHistoryRepairFileTooLarge', {
          defaultValue: 'Repair: remove the oversized file and import again',
        });
      case 'SKILL_IMPORT_TOTAL_TOO_LARGE':
        return t('settings.skillsHub.importHistoryRepairTotalTooLarge', {
          defaultValue: 'Repair: remove unrelated large files and import again',
        });
      case 'SKILL_INVALID_FRONTMATTER':
        return t('settings.skillsHub.importHistoryRepairFrontmatter', {
          defaultValue: 'Repair: update the SKILL.md header and import again',
        });
      case 'SKILL_IMPORT_NO_SKILL_FOUND':
        return t('settings.skillsHub.importHistoryRepairNoSkillFound', {
          defaultValue: 'Repair: choose a folder or zip that contains SKILL.md',
        });
      case 'SKILL_IMPORT_INVALID_SOURCE':
        return t('settings.skillsHub.importHistoryRepairInvalidSource', {
          defaultValue: 'Repair: choose a skill folder, parent folder, or zip file',
        });
      case 'SKILL_IMPORT_INVALID_ZIP':
        return t('settings.skillsHub.importHistoryRepairInvalidZip', {
          defaultValue: 'Repair: create the zip again and import it',
        });
      case 'SKILL_IMPORT_SYMLINK_ENTRY':
        return t('settings.skillsHub.importHistoryRepairSymlinkEntry', {
          defaultValue: 'Repair: replace linked files with real files and import again',
        });
      case 'SKILL_IMPORT_INVALID_NAME':
        return t('settings.skillsHub.importHistoryRepairInvalidName', {
          defaultValue: 'Repair: rename the skill using lowercase letters, numbers, and hyphens',
        });
      default:
        return t('settings.skillsHub.importHistoryRepairFailed', {
          defaultValue: 'Repair: check this skill package and import again',
        });
    }
  };

  const getFailedImportDescription = (record: SkillImportRecord) => {
    const actual = formatBytes(record.actual_bytes);
    const limit = formatBytes(record.limit_bytes);
    switch (record.error_code) {
      case 'SKILL_IMPORT_FILE_TOO_LARGE':
        if (record.error_path && actual && limit) {
          return t('settings.skillsHub.importHistoryFileTooLargeDescription', {
            path: record.error_path,
            actual,
            limit,
            defaultValue: `${record.error_path} is ${actual}, over the ${limit} per-file limit. This file will not be copied into the skill directory.`,
          });
        }
        break;
      case 'SKILL_IMPORT_TOTAL_TOO_LARGE':
        if (actual && limit) {
          return t('settings.skillsHub.importHistoryTotalTooLargeDescription', {
            actual,
            limit,
            defaultValue: `This skill is ${actual}, over the ${limit} total size limit.`,
          });
        }
        break;
      case 'SKILL_INVALID_FRONTMATTER':
        return t('settings.skillsHub.importHistoryFrontmatterDescription', {
          defaultValue: 'The SKILL.md header could not be parsed, so the skill description could not be read.',
        });
      case 'SKILL_IMPORT_NO_SKILL_FOUND':
        return t('settings.skillsHub.importHistoryNoSkillFoundDescription', {
          defaultValue: 'The selected location does not contain a valid SKILL.md file.',
        });
      case 'SKILL_IMPORT_INVALID_SOURCE':
        return t('settings.skillsHub.importHistoryInvalidSourceDescription', {
          defaultValue: 'The selected item is not a folder or zip file that can be imported as a skill.',
        });
      case 'SKILL_IMPORT_INVALID_ZIP':
        return t('settings.skillsHub.importHistoryInvalidZipDescription', {
          defaultValue: 'The zip file could not be opened or extracted.',
        });
      case 'SKILL_IMPORT_SYMLINK_ENTRY':
        return t('settings.skillsHub.importHistorySymlinkEntryDescription', {
          defaultValue: 'This package contains linked files, which are not copied during import.',
        });
      case 'SKILL_IMPORT_INVALID_NAME':
        return t('settings.skillsHub.importHistoryInvalidNameDescription', {
          defaultValue: 'The skill name cannot be used as a folder name.',
        });
      default:
        break;
    }
    return t('settings.skillsHub.importHistoryFailedDescription', {
      defaultValue: 'This skill package could not be imported.',
    });
  };

  const renderFailedImportDetails = (record: SkillImportRecord) => {
    const actual = formatBytes(record.actual_bytes);
    const limit = formatBytes(record.limit_bytes);
    const detailLines: string[] = [];
    if (record.error_path) {
      detailLines.push(
        t('settings.skillsHub.importHistoryFileLine', {
          path: record.error_path,
          defaultValue: `File: ${record.error_path}`,
        })
      );
    }
    if (actual && limit) {
      detailLines.push(
        t('settings.skillsHub.importHistorySizeLine', {
          actual,
          limit,
          defaultValue: `Size: ${actual}, limit: ${limit}`,
        })
      );
    }
    if (typeof record.line === 'number' && typeof record.column === 'number') {
      detailLines.push(
        t('settings.skillsHub.importHistoryLocationLine', {
          line: record.line,
          column: record.column,
          defaultValue: `Location: line ${record.line}, column ${record.column}`,
        })
      );
    }
    const source = record.source_path || record.source_name;
    if (source) {
      detailLines.push(
        t('settings.skillsHub.importHistorySourceLine', {
          source,
          defaultValue: `Source: ${source}`,
        })
      );
    }

    return (
      <div className='mt-10px border border-[rgba(var(--warning-6),0.24)] bg-[rgba(var(--warning-6),0.08)] rd-10px px-12px py-10px'>
        <div className='flex items-start gap-8px'>
          <span className='shrink-0 mt-1px text-warning-6 text-13px'>!</span>
          <div className='min-w-0 text-12px leading-relaxed text-warning-6'>
            <div className='font-semibold text-warning-6'>{getFailedImportRepairTitle(record)}</div>
            <div className='mt-2px'>{getFailedImportDescription(record)}</div>
            {detailLines.length > 0 && (
              <ul className='mt-6px m-0 p-0 list-none flex flex-col gap-2px'>
                {detailLines.map((line) => (
                  <li key={line} className='truncate' title={line}>
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  };

  const importHistoryContent = (
    <div data-testid='skill-import-history-page' className='flex flex-col h-full w-full'>
      <div className='space-y-16px pb-24px'>
        <div className='px-[16px] md:px-[32px] py-20px bg-base rd-16px md:rd-24px shadow-sm border border-b-base'>
          <div className='flex flex-col sm:flex-row sm:items-start justify-between gap-12px'>
            <div>
              <div className='flex items-center gap-10px'>
                <span className='text-16px md:text-18px text-t-primary font-bold tracking-tight'>
                  {t('settings.skillsHub.importHistoryTitle', { defaultValue: 'Import history' })}
                </span>
              </div>
              <p className='mt-6px text-12px text-t-tertiary leading-relaxed'>
                {t('settings.skillsHub.importHistoryDescription', {
                  defaultValue: 'If an import fails, follow the note in the record and import again.',
                })}
              </p>
            </div>
            <button
              data-testid='btn-back-to-skills'
              className='flex items-center justify-center px-14px py-7px bg-base border border-border-1 hover:border-border-2 hover:bg-fill-1 text-t-primary rd-8px shadow-sm transition-all focus:outline-none shrink-0 cursor-pointer whitespace-nowrap text-13px font-medium'
              onClick={showSkillList}
            >
              {t('settings.skillsHub.backToSkills', { defaultValue: 'Back to skills' })}
            </button>
          </div>
        </div>

        <div className='px-[16px] md:px-[32px] py-16px bg-base rd-16px md:rd-24px shadow-sm border border-b-base'>
          {importHistoryGroups.length === 0 ? (
            <div className='border border-dashed border-border-1 bg-fill-1 rd-10px px-12px py-14px text-12px text-t-tertiary'>
              {t('settings.skillsHub.importHistoryEmpty', { defaultValue: 'No import records yet.' })}
            </div>
          ) : (
            <div className='flex flex-col gap-8px'>
              {importHistoryGroups.map((group) => {
                const failedRecords = group.records.filter((record) => record.status === 'failed');
                const importedNames = group.records
                  .filter((record) => record.status !== 'failed')
                  .map((record) => record.skill_name || record.source_name)
                  .filter(Boolean)
                  .join(', ');

                return (
                  <div
                    key={group.operationId}
                    data-testid={`skill-import-history-record-${normalizeTestId(group.sourceLabel)}`}
                    className={`border rd-12px px-12px py-10px ${
                      failedRecords.length > 0
                        ? 'border-[rgba(var(--warning-6),0.28)] bg-[rgba(var(--warning-6),0.03)]'
                        : 'border-border-1 bg-fill-1'
                    }`}
                  >
                    <div className='flex flex-col sm:flex-row sm:items-start justify-between gap-8px'>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-8px min-w-0'>
                          <span className='text-13px font-semibold text-t-primary truncate' title={group.sourceLabel}>
                            {group.sourceLabel}
                          </span>
                          <span
                            className={`shrink-0 border text-11px px-6px py-1px rd-4px font-medium ${getImportHistoryStatusClass(group)}`}
                          >
                            {getImportHistoryStatusLabel(group)}
                          </span>
                        </div>
                        <div className='mt-5px flex flex-wrap gap-x-8px gap-y-2px text-12px text-t-tertiary'>
                          <span>{new Date(group.createdAt).toLocaleString()}</span>
                          {importedNames && <span>{importedNames}</span>}
                        </div>
                      </div>
                    </div>

                    {failedRecords.map((record) => (
                      <div key={record.id}>{renderFailedImportDetails(record)}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const mainContent = isImportHistoryView ? (
    importHistoryContent
  ) : (
    <div className='flex flex-col h-full w-full'>
      <div className='space-y-16px pb-24px'>
        {/* ======== 我的技能 / My Skills ======== */}
        <div
          data-testid='my-skills-section'
          className='px-[16px] md:px-[32px] py-32px bg-base rd-16px md:rd-24px shadow-sm border border-b-base relative overflow-hidden transition-all'
        >
          {/* Toolbar for My Skills */}
          <div className='flex flex-col lg:flex-row lg:items-center justify-between gap-16px mb-24px relative z-10'>
            <div className='flex items-center gap-10px shrink-0'>
              <span className='text-16px md:text-18px text-t-primary font-bold tracking-tight'>
                {t('settings.skillsHub.mySkillsTitle', { defaultValue: 'My Skills' })}
              </span>
              <span className='bg-[rgba(var(--primary-6),0.08)] text-primary-6 text-12px px-10px py-2px rd-[100px] font-medium ml-4px'>
                {mySkills.length}
              </span>
              <button
                data-testid='btn-refresh-my-skills'
                className='outline-none border-none bg-transparent cursor-pointer p-6px text-t-tertiary hover:text-primary-6 transition-colors rd-full hover:bg-fill-2 ml-4px'
                onClick={async () => {
                  await fetchData();
                  Message.success(t('common.refreshSuccess', { defaultValue: 'Refreshed' }));
                }}
                title={t('common.refresh', { defaultValue: 'Refresh' })}
              >
                <Refresh theme='outline' size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className='flex flex-col sm:flex-row items-stretch sm:items-center gap-12px w-full lg:w-auto shrink-0'>
              <button
                data-testid='btn-open-import-history'
                className='flex items-center justify-center gap-6px px-8px py-6px bg-transparent border-none text-t-secondary hover:text-t-primary transition-colors focus:outline-none shrink-0 cursor-pointer whitespace-nowrap'
                onClick={showImportHistory}
              >
                <span className='text-13px font-medium'>
                  {t('settings.skillsHub.importHistoryTitle', { defaultValue: 'Import history' })}
                </span>
              </button>

              {customSkills.length > 0 &&
                (batchMode ? (
                  <div className='flex shrink-0 items-center gap-8px'>
                    <Button
                      size='mini'
                      type='text'
                      className='!h-24px !px-8px !text-12px'
                      data-testid='btn-batch-cancel'
                      onClick={exitBatchMode}
                    >
                      {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                      size='mini'
                      status='warning'
                      className='!h-24px !px-8px !text-12px'
                      data-testid='btn-batch-delete'
                      disabled={selectedSkillNames.size === 0}
                      onClick={handleBatchDelete}
                    >
                      {t('settings.skillsHub.batchDeleteAction', {
                        count: selectedSkillNames.size,
                        defaultValue: `Delete (${selectedSkillNames.size})`,
                      })}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size='mini'
                    type='text'
                    className='!h-24px !px-8px !text-12px !text-t-secondary hover:!text-t-primary'
                    data-testid='btn-batch-manage'
                    onClick={() => setBatchMode(true)}
                  >
                    {t('settings.skillsHub.batchManage', { defaultValue: 'Batch manage' })}
                  </Button>
                ))}

              <div className='relative group shrink-0 w-full sm:w-[200px] lg:w-[240px]'>
                <div className='absolute left-12px top-0 bottom-0 text-t-tertiary group-focus-within:text-primary-6 flex items-center pointer-events-none transition-colors'>
                  <Search size={15} />
                </div>
                <input
                  data-testid='input-search-my-skills'
                  type='text'
                  className='w-full h-36px bg-fill-1 hover:bg-fill-2 border border-border-1 focus:border-primary-5 focus:bg-base outline-none rd-8px py-0 pl-36px pr-12px text-13px leading-36px text-t-primary placeholder:text-t-tertiary transition-all shadow-sm box-border m-0'
                  placeholder={t('settings.skillsHub.searchPlaceholder', { defaultValue: 'Search skills...' })}
                  value={search_query}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <TalkToButlerButton
                label={t('settings.skillsHub.addSkill', { defaultValue: 'Add Skill' })}
                chatLabel={t('settings.talkToButler.addViaChat', { defaultValue: 'Add via chat' })}
                onManual={handleManualImport}
                manualLabel={t('settings.skillsHub.manualImport', { defaultValue: 'Import Skills' })}
                prompt={t('settings.talkToButler.prompt.addSkill', {
                  defaultValue: 'Help me import a skill and attach it to an assistant.',
                })}
                data-testid='btn-add-skill'
              />
            </div>
          </div>

          <div className='flex items-center gap-8px min-h-36px mb-12px px-10px py-8px border border-border-1 bg-fill-1 rd-10px text-12px text-t-tertiary leading-relaxed relative z-10'>
            <span className='font-medium text-t-secondary shrink-0'>
              {t('settings.skillsHub.importHelpCompactLabel', { defaultValue: 'Import rules' })}:
            </span>
            <span>
              {t('settings.skillsHub.importHelpCompactText', {
                maxFileSize:
                  formatBytes(importLimits?.max_file_bytes) ??
                  t('settings.skillsHub.importHelpConfiguredLimit', { defaultValue: 'configured limit' }),
                maxTotalSize:
                  formatBytes(importLimits?.max_total_bytes) ??
                  t('settings.skillsHub.importHelpConfiguredLimit', { defaultValue: 'configured limit' }),
                defaultValue:
                  'Skill folder, parent folder, or zip; {{maxFileSize}} per file, {{maxTotalSize}} per skill; same-name imports replace existing skills.',
              })}
            </span>
          </div>

          {batchMode && customSkills.length > 0 && (
            <div className='flex items-center justify-between gap-12px mb-12px text-12px text-t-secondary relative z-10'>
              <Checkbox
                data-testid='checkbox-select-all-skills'
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
              >
                <span className='text-12px text-t-secondary'>
                  {t('conversation.history.selectAll', { defaultValue: 'Select All' })}
                </span>
              </Checkbox>
              <span>
                {t('settings.skillsHub.batchSelectedCount', {
                  count: selectedSkillNames.size,
                  defaultValue: `${selectedSkillNames.size} selected`,
                })}
              </span>
            </div>
          )}

          {mySkills.length > 0 && sourceCounts.size > 1 ? (
            <div className='mb-14px flex flex-wrap gap-8px relative z-10' data-testid='skill-source-pills'>
              {[
                null,
                ...BUILTIN_CATEGORY_ORDER.map((slug) => `cat:${slug}`),
                'source:builtin',
                'source:custom',
                'source:team',
              ]
                .filter((key) => key === null || sourceCounts.has(key))
                .map((key) => {
                  const active = sourceFilter === key;
                  const count = key === null ? mySkills.length : (sourceCounts.get(key) ?? 0);
                  const label =
                    key === null
                      ? t('settings.marketplaceAllCategories')
                      : key.startsWith('cat:')
                        ? t(`settings.skillsHub.builtinCategory.${key.slice(4)}`, { defaultValue: key.slice(4) })
                        : key === 'source:custom'
                          ? t('settings.skillsHub.custom', { defaultValue: 'Custom' })
                          : key === 'source:team'
                            ? t('settings.skillsHub.team', { defaultValue: 'Team' })
                            : t('settings.skillsHub.builtin', { defaultValue: 'Built-in' });
                  return (
                    <div
                      key={key ?? '__all'}
                      role='button'
                      tabIndex={0}
                      data-testid={`pill-skill-source-${key ? key.replace(':', '-') : 'all'}`}
                      className={skillSourcePillClass(active)}
                      onClick={() => setSourceFilter(active ? null : key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSourceFilter(active ? null : key);
                        }
                      }}
                    >
                      {label}
                      <span className='ml-6px text-12px opacity-60'>{count}</span>
                    </div>
                  );
                })}
            </div>
          ) : null}

          {mySkills.length > 0 ? (
            <div
              className='w-full grid grid-cols-1 gap-12px sm:grid-cols-2 lg:grid-cols-4 relative z-10'
              data-testid='skill-card-grid'
            >
              {groupedSkills.map((group) => (
                <React.Fragment key={group.category ?? '__uncategorized'}>
                  {group.category && (
                    <div
                      data-testid={`skill-category-${normalizeTestId(group.category)}`}
                      className='col-span-full flex items-center gap-8px mt-10px mb-2px px-2px'
                    >
                      <span className='w-3px h-12px rd-2px bg-primary-6 opacity-70' />
                      <span className='text-13px font-semibold text-t-secondary'>{group.category}</span>
                      <span className='text-11px text-t-tertiary'>{group.skills.length}</span>
                    </div>
                  )}
                  {group.skills.map((skill) => {
                    const isCustom = skill.source === 'custom';
                    return (
                      <div
                        key={skill.name}
                        data-testid={`my-skill-card-${normalizeTestId(skill.name)}`}
                        style={{ contentVisibility: 'auto', containIntrinsicSize: '168px' }}
                        ref={(el) => {
                          skillRefs.current[skill.name] = el;
                        }}
                        onClick={
                          batchMode
                            ? isCustom
                              ? () => toggleSkillSelected(skill.name)
                              : undefined
                            : () => openSkillDetail(skill.name)
                        }
                        className={`group flex h-full flex-col p-14px border rd-12px transition-all duration-200 cursor-pointer ${
                          highlightedSkill === skill.name
                            ? 'border-primary-5 bg-primary-1'
                            : selectedSkillNames.has(skill.name) && batchMode
                              ? 'border-transparent bg-[rgba(var(--primary-6),0.06)]'
                              : 'border-border-2 bg-base hover:border-primary-4 hover:bg-fill-1 hover:shadow-sm'
                        }`}
                      >
                        {batchMode && isCustom && (
                          <div className='shrink-0 flex items-center sm:self-center'>
                            <Checkbox
                              data-testid={`checkbox-skill-${normalizeTestId(skill.name)}`}
                              checked={selectedSkillNames.has(skill.name)}
                              onChange={() => toggleSkillSelected(skill.name)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        )}
                        <div className='flex items-start justify-between gap-8px'>
                          <div className='shrink-0'>
                            {skill.icon_file ? (
                              <img
                                src={resolveExtensionAssetUrl(`/api/skills/${encodeURIComponent(skill.name)}/icon`)}
                                alt=''
                                className='w-40px h-40px rd-10px object-cover shadow-sm'
                                loading='lazy'
                              />
                            ) : (
                              <div
                                className={`w-40px h-40px rd-10px flex items-center justify-center font-bold text-16px shadow-sm text-transform-uppercase ${getAvatarColorClass(skill.name)}`}
                              >
                                {(skill.display_name || skill.name).charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          {/* Category, not source. "Custom" was never the
                              user's word for these -- they are skills this
                              product ships and the user installed, and the
                              label said the opposite. Source stays available
                              as a pill filter. */}
                          {skillPillKey(skill).startsWith('cat:') ? (
                            <span className='mt-1px max-w-96px shrink-0 truncate rounded-6px bg-fill-2 px-8px py-2px text-11px text-t-secondary'>
                              {t(`settings.skillsHub.builtinCategory.${skillPillKey(skill).slice(4)}`, {
                                defaultValue: '',
                              })}
                            </span>
                          ) : null}
                        </div>

                        <h3
                          className='mt-10px text-14px font-semibold text-t-primary/90 truncate m-0'
                          title={skill.name}
                        >
                          {builtinSkillDisplay(skill).title}
                        </h3>

                        {/* Fixed two-line box. Without the floor, a short
                            description leaves the card shorter than its row and
                            the grid drifts out of alignment. */}
                        <p
                          className='mt-6px min-h-32px line-clamp-2 text-12px leading-[1.5] text-t-secondary m-0'
                          title={builtinSkillDisplay(skill).description}
                        >
                          {builtinSkillDisplay(skill).description}
                        </p>

                        {(skill.tags ?? []).length > 0 && (
                          <div className='mt-6px flex flex-wrap gap-4px overflow-hidden max-h-20px'>
                            {(skill.tags ?? []).map((tag) => (
                              <span
                                key={tag}
                                data-testid={`skill-tag-${normalizeTestId(tag)}`}
                                className='bg-[rgba(var(--primary-6),0.06)] text-t-secondary border border-border-1 text-11px px-6px py-1px rd-4px font-medium'
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {!batchMode && (
                          <div className='mt-auto flex shrink-0 items-center gap-6px pt-8px'>
                            <Button
                              type='text'
                              size='mini'
                              data-testid={`btn-use-skill-${normalizeTestId(skill.name)}`}
                              className='!h-28px !flex-1 !rounded-8px !bg-fill-2 !px-8px !text-12px !text-t-secondary hover:!bg-primary-6 hover:!text-white'
                              onClick={(e) => {
                                e.stopPropagation();
                                void navigate(`/guid?skill=${encodeURIComponent(skill.name)}`);
                              }}
                            >
                              {t('settings.skillsHub.useSkill', { defaultValue: 'Use' })}
                            </Button>
                            <Button
                              type='text'
                              size='mini'
                              data-testid={`btn-edit-skill-${normalizeTestId(skill.name)}`}
                              className='!h-28px !flex-1 !rounded-8px !bg-fill-2 !px-8px !text-12px !text-t-secondary hover:!bg-primary-6 hover:!text-white'
                              onClick={(e) => {
                                e.stopPropagation();
                                openSkillDetail(skill.name);
                              }}
                            >
                              {t('settings.skillsHub.editSkill', { defaultValue: 'Edit' })}
                            </Button>
                            <SkillUsedByStack
                              assistants={getAssistantsUsingSkill(skill.name, assistantCatalog ?? [])}
                            />
                            {isCustom && (
                              <button
                                data-testid={`btn-delete-${normalizeTestId(skill.name)}`}
                                className='shrink-0 p-4px hover:bg-danger-1 hover:text-danger-6 text-t-tertiary rd-6px outline-none flex items-center justify-center border border-transparent cursor-pointer transition-colors bg-transparent opacity-0 group-hover:opacity-100 transition-opacity'
                                onClick={(e) => {
                                  e.stopPropagation();
                                  Modal.confirm({
                                    title: t('settings.skillsHub.deleteConfirmTitle', { defaultValue: 'Delete Skill' }),
                                    content: t('settings.skillsHub.deleteConfirmContent', {
                                      name: skill.name,
                                      defaultValue: `Are you sure you want to delete "${skill.name}"?`,
                                    }),
                                    okButtonProps: { status: 'danger' },
                                    okText: t('common.delete', { defaultValue: 'Delete' }),
                                    onOk: () => void handleDelete(skill.name),
                                    wrapClassName: 'modal-delete-skill',
                                  });
                                }}
                                title={t('common.delete', { defaultValue: 'Delete' })}
                              >
                                <Delete size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className='text-center text-t-secondary text-13px py-40px bg-fill-1 rd-12px border border-b-base border-dashed relative z-10'>
              {loading
                ? t('common.loading', { defaultValue: 'Please wait...' })
                : t('settings.skillsHub.noSkills', {
                    defaultValue: 'No skills found. Import some to get started.',
                  })}
            </div>
          )}
        </div>

        {/* ======== Extension Skills ======== */}
        {extensionSkills.length > 0 && (
          <div
            data-testid='extension-skills-section'
            className='px-[16px] md:px-[32px] py-32px bg-base rd-16px md:rd-24px shadow-sm border border-b-base relative overflow-hidden transition-all'
          >
            <div className='flex items-center gap-10px mb-24px'>
              <Puzzle theme='filled' size={20} fill='var(--color-primary-6)' />
              <span className='text-16px md:text-18px text-t-primary font-bold tracking-tight'>
                {t('settings.extensionSkills', { defaultValue: 'Extension Skills' })}
              </span>
              <span className='bg-[rgba(var(--primary-6),0.08)] text-primary-6 text-12px px-10px py-2px rd-[100px] font-medium ml-4px'>
                {extensionSkills.length}
              </span>
            </div>
            <div className='w-full flex flex-col gap-6px'>
              {extensionSkills.map((skill) => (
                <div
                  key={skill.name}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '84px' }}
                  ref={(el) => {
                    skillRefs.current[skill.name] = el;
                  }}
                  className={`flex flex-col sm:flex-row gap-16px p-16px bg-base border hover:border-border-1 hover:bg-fill-1 rd-12px transition-all duration-200 ${highlightedSkill === skill.name ? 'border-primary-5 bg-primary-1' : 'border-transparent'}`}
                >
                  <div className='shrink-0 flex items-start sm:mt-2px'>
                    <div className='w-40px h-40px rd-10px bg-[rgba(var(--primary-6),0.08)] flex items-center justify-center shadow-sm'>
                      <Puzzle theme='filled' size={20} fill='rgb(var(--primary-6))' />
                    </div>
                  </div>
                  <div className='flex-1 min-w-0 flex flex-col justify-center gap-4px'>
                    <div className='flex items-center gap-10px'>
                      <h3 className='text-14px font-semibold text-t-primary/90 truncate m-0'>{skill.name}</h3>
                      <span className='bg-[rgba(var(--primary-6),0.08)] text-primary-6 border border-[rgba(var(--primary-6),0.2)] text-10px px-6px py-1px rd-4px font-medium uppercase'>
                        {t('settings.extensionSkillsBadge', { defaultValue: 'Extension' })}
                      </span>
                    </div>
                    {skill.description && (
                      <p className='text-13px text-t-secondary leading-relaxed line-clamp-2 m-0'>{skill.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ======== Builtin Auto-injected Skills ======== */}
        {builtinAutoSkills.length > 0 && (
          <div
            data-testid='auto-skills-section'
            className='px-[16px] md:px-[32px] py-32px bg-base rd-16px md:rd-24px shadow-sm border border-b-base relative overflow-hidden transition-all'
          >
            <div className='flex items-center gap-10px mb-24px'>
              <Lightning theme='filled' size={20} fill='var(--color-primary-6)' />
              <span className='text-16px md:text-18px text-t-primary font-bold tracking-tight'>
                {t('settings.autoInjectedSkills')}
              </span>
              <span className='bg-[rgba(var(--success-6),0.08)] text-[rgb(var(--success-6))] text-12px px-10px py-2px rd-[100px] font-medium ml-4px'>
                {builtinAutoSkills.length}
              </span>
            </div>
            <div className='w-full flex flex-col gap-6px'>
              {builtinAutoSkills.map((skill) => (
                <div
                  key={skill.name}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '84px' }}
                  ref={(el) => {
                    skillRefs.current[skill.name] = el;
                  }}
                  className={`flex flex-col sm:flex-row gap-16px p-16px bg-base border hover:border-border-1 hover:bg-fill-1 rd-12px transition-all duration-200 ${highlightedSkill === skill.name ? 'border-primary-5 bg-primary-1' : 'border-transparent'}`}
                >
                  <div className='shrink-0 flex items-start sm:mt-2px'>
                    <div className='w-40px h-40px rd-10px bg-[rgba(var(--success-6),0.08)] flex items-center justify-center shadow-sm'>
                      <Lightning theme='filled' size={20} fill='rgb(var(--success-6))' />
                    </div>
                  </div>
                  <div className='flex-1 min-w-0 flex flex-col justify-center gap-4px'>
                    <div className='flex items-center gap-10px'>
                      <h3 className='text-14px font-semibold text-t-primary/90 truncate m-0'>{skill.name}</h3>
                      <span className='bg-[rgba(var(--success-6),0.08)] text-[rgb(var(--success-6))] border border-[rgba(var(--success-6),0.2)] text-10px px-6px py-1px rd-4px font-medium uppercase'>
                        {t('settings.autoInjectedSkillsBadge')}
                      </span>
                    </div>
                    {skill.description && (
                      <p className='text-13px text-t-secondary leading-relaxed line-clamp-2 m-0'>{skill.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return withWrapper ? <SettingsPageWrapper>{mainContent}</SettingsPageWrapper> : mainContent;
};

export default SkillsHubSettings;
