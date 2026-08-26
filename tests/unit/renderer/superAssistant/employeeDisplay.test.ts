/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  resolveEmployeeBackendLabel,
  resolveEmployeeExpertName,
  resolveEmployeeRunErrorMessage,
} from '@/renderer/pages/superAssistant/utils/employeeDisplay';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const CATALOG = [
  { id: 'agent_claude', name: 'Claude Code', backend: 'claude', agent_type: 'acp' },
  { id: 'agent_aionrs', name: '1ONE CLI', agent_type: 'aionrs' },
] as unknown as ManagedAgent[];

const t = ((_key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? _key) as unknown as TFunction;

describe('resolveEmployeeBackendLabel', () => {
  it('shows the product name instead of the raw backend id', () => {
    // The roster used to render `agent.agentType` verbatim, which is why an
    // dream employee displayed a bare "dream".
    expect(resolveEmployeeBackendLabel({ agentType: 'aionrs' }, CATALOG)).toBe('1ONE CLI');
    expect(resolveEmployeeBackendLabel({ agentType: 'claude' }, CATALOG)).toBe('Claude Code');
  });

  it('prefers the explicit backend override over the stored label', () => {
    expect(resolveEmployeeBackendLabel({ agentType: 'claude', agentIdOverride: 'agent_aionrs' }, CATALOG)).toBe(
      '1ONE CLI'
    );
  });

  it('falls back to the raw label when the catalog has no matching row', () => {
    expect(resolveEmployeeBackendLabel({ agentType: 'uninstalled-thing' }, CATALOG)).toBe('uninstalled-thing');
  });

  it('prefers a localized catalog name when present', () => {
    const localized = [
      { id: 'a', name: 'Fallback', agent_type: 'acp', backend: 'x', name_i18n: { 'zh-CN': '本地名' } },
    ];
    expect(resolveEmployeeBackendLabel({ agentType: 'x' }, localized as unknown as ManagedAgent[], 'zh-CN')).toBe(
      '本地名'
    );
  });
});

describe('resolveEmployeeExpertName', () => {
  const assistants = [{ id: 'persona_1', name: '安全审计师' }] as unknown as Assistant[];

  it('resolves the bound expert name', () => {
    expect(resolveEmployeeExpertName({ assistantId: 'persona_1' }, assistants)).toBe('安全审计师');
  });

  it('falls back to the legacy customAgentId column', () => {
    expect(resolveEmployeeExpertName({ customAgentId: 'persona_1' }, assistants)).toBe('安全审计师');
  });

  it('is undefined for a backend-only employee', () => {
    expect(resolveEmployeeExpertName({}, assistants)).toBeUndefined();
  });

  it('degrades to the raw id when the expert was removed', () => {
    expect(resolveEmployeeExpertName({ assistantId: 'gone' }, assistants)).toBe('gone');
  });
});

describe('resolveEmployeeRunErrorMessage', () => {
  it('replaces the raw provider lookup failure with actionable text', () => {
    // This is the exact string the reported bug surfaced in the run history.
    expect(resolveEmployeeRunErrorMessage("Provider '' not found", t)).toBe(
      '该员工绑定的模型已不存在，请在「管理」里重新选择模型'
    );
    expect(resolveEmployeeRunErrorMessage("Provider 'ff9e8905' not found", t)).toBe(
      '该员工绑定的模型已不存在，请在「管理」里重新选择模型'
    );
  });

  it('leaves unrelated errors untouched', () => {
    expect(resolveEmployeeRunErrorMessage('agent turn failed', t)).toBe('agent turn failed');
    expect(resolveEmployeeRunErrorMessage('Provider is unreachable', t)).toBe('Provider is unreachable');
  });
});
