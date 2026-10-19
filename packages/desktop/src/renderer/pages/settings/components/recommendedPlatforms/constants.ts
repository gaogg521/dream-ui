/**
 * Copyright 2026 One Work
 */

import baoyunLogo from '@renderer/assets/logos/recommended/baoyun.svg';
import deepseekLogo from '@renderer/assets/logos/recommended/deepseek.png';
import mimoLogo from '@renderer/assets/logos/recommended/mimo.png';
import zhipuLogo from '@renderer/assets/logos/recommended/zhipu.png';

export type RecommendedPlatformId = 'zhipu' | 'deepseek' | 'mimo' | 'baoyun';

/** i18n key suffixes under `settings.recommendedPlatforms.step.*`. */
type StepLabel = 'register' | 'registerVerify' | 'subscribe' | 'createKey' | 'getKey' | 'topUp' | 'connect';

export type RecommendedPlatformStep = {
  label: StepLabel;
  /** Plain text shown under the label that never needs translating (a host name, tool names). */
  literal?: string;
  /** Translated detail, looked up at `settings.recommendedPlatforms.<id>.<detailKey>`. */
  detailKey?: string;
};

export type RecommendedPlatform = {
  id: RecommendedPlatformId;
  /** Official website the logo tile opens. */
  url: string;
  logo: string;
  /** Registration -> plan/top-up -> key -> connect, in the order a new user walks them. */
  steps: RecommendedPlatformStep[];
  /** Endpoint to paste into a tool, when the platform has a single one worth showing. */
  baseUrl?: string;
};

export const RECOMMENDED_PLATFORMS: readonly RecommendedPlatform[] = [
  {
    id: 'zhipu',
    url: 'https://open.bigmodel.cn',
    logo: zhipuLogo,
    steps: [
      { label: 'register', literal: 'open.bigmodel.cn' },
      { label: 'subscribe', detailKey: 'subscribeDetail' },
      { label: 'createKey', detailKey: 'keyDetail' },
      { label: 'connect', literal: 'ZCode / Claude Code / Codex / WorkBuddy' },
    ],
  },
  {
    id: 'deepseek',
    url: 'https://platform.deepseek.com',
    logo: deepseekLogo,
    steps: [
      { label: 'registerVerify', literal: 'platform.deepseek.com' },
      { label: 'createKey', detailKey: 'keyDetail' },
      { label: 'topUp', detailKey: 'topUpDetail' },
      { label: 'connect', literal: 'Claude Code / Codex / Harness', detailKey: 'connectDetail' },
    ],
  },
  {
    id: 'mimo',
    url: 'https://mimo.mi.com',
    logo: mimoLogo,
    steps: [
      { label: 'register', literal: 'mimo.mi.com / platform.xiaomimimo.com' },
      { label: 'subscribe', detailKey: 'subscribeDetail' },
      { label: 'getKey', detailKey: 'keyDetail' },
      { label: 'connect', literal: 'OpenCode / OpenClaw / Claude Code' },
    ],
  },
  {
    id: 'baoyun',
    url: 'https://www.baoyun.com',
    logo: baoyunLogo,
    baseUrl: 'https://ai-api.baoyun.com/v1',
    steps: [
      { label: 'register', literal: 'www.baoyun.com', detailKey: 'registerDetail' },
      { label: 'createKey', detailKey: 'keyDetail' },
      { label: 'topUp', detailKey: 'topUpDetail' },
      { label: 'connect', detailKey: 'connectDetail' },
    ],
  },
];
