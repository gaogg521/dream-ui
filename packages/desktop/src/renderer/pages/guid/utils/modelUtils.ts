/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import { hasSpecificModelCapability } from '@/renderer/utils/model/modelCapabilities';
import { isChatCapableModel } from '@/common/utils/modelCapabilities';

/**
 * Cache for provider available models to avoid repeated computation.
 */
const available_modelsCache = new Map<string, string[]>();

/**
 * Get all available primary models for a provider (with cache).
 * Filters out disabled models based on model_enabled state.
 * @param provider - Provider configuration
 * @returns Array of available primary model names
 */
export const getAvailableModels = (provider: IProvider): string[] => {
  // 包含 model_enabled 状态到缓存 key 中
  const model_enabledKey = provider.model_enabled ? JSON.stringify(provider.model_enabled) : 'all-enabled';
  // Declared kinds now decide chat eligibility, so they belong in the key —
  // otherwise labelling a model as video leaves it in the picker until reload.
  const settingsKey = provider.model_settings ? JSON.stringify(provider.model_settings) : 'no-settings';
  const cacheKey = `${provider.id}-${(provider.models || []).join(',')}-${model_enabledKey}-${settingsKey}`;

  if (available_modelsCache.has(cacheKey)) {
    return available_modelsCache.get(cacheKey)!;
  }

  const result: string[] = [];
  for (const modelName of provider.models || []) {
    // 检查模型是否被禁用（默认为启用）
    const isModelEnabled = provider.model_enabled?.[modelName] !== false;
    if (!isModelEnabled) continue;

    const functionCalling = hasSpecificModelCapability(provider, modelName, 'function_calling');

    if ((functionCalling === true || functionCalling === undefined) && isChatCapableModel(provider, modelName)) {
      result.push(modelName);
    }
  }

  available_modelsCache.set(cacheKey, result);
  return result;
};

/**
 * Check if a provider has any available primary conversation models (efficient version).
 * @param provider - Provider configuration
 * @returns true if the provider has available models
 */
export const hasAvailableModels = (provider: IProvider): boolean => {
  return getAvailableModels(provider).length > 0;
};
