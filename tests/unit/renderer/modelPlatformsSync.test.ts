/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * `mergeModelPlatformPresets` is the load-bearing half of syncing the
 * canonical preset list from dream-core: it must update existing entries and
 * append new ones without ever reordering or dropping what was already
 * there, since a failed or partial sync must never leave the picker worse
 * off than the built-in list.
 */

import { describe, expect, it } from 'vitest';

import { mergeModelPlatformPresets } from '@renderer/utils/model/modelPlatformsSync';
import type { PlatformConfig } from '@renderer/utils/model/modelPlatforms';

const config = (overrides: Partial<PlatformConfig> & Pick<PlatformConfig, 'name' | 'value' | 'platform'>): PlatformConfig => ({
  logo: null,
  ...overrides,
});

describe('mergeModelPlatformPresets', () => {
  it('appends a preset the target does not have yet, without disturbing existing entries', () => {
    const target: PlatformConfig[] = [config({ name: 'Custom', value: 'custom', platform: 'custom' })];
    mergeModelPlatformPresets(target, [config({ name: 'New Vendor', value: 'NewVendor', platform: 'custom', base_url: 'https://new.example/v1' })]);

    expect(target.map((p) => p.value)).toEqual(['custom', 'NewVendor']);
    expect(target[1].base_url).toBe('https://new.example/v1');
  });

  it('updates an existing entry in place by value, keeping its position', () => {
    const target: PlatformConfig[] = [
      config({ name: 'Custom', value: 'custom', platform: 'custom' }),
      config({ name: 'Old Name', value: 'Vendor', platform: 'custom', base_url: 'https://old.example/v1' }),
    ];
    mergeModelPlatformPresets(target, [
      config({ name: 'Renamed', value: 'Vendor', platform: 'custom', base_url: 'https://new.example/v1' }),
    ]);

    expect(target.map((p) => p.value)).toEqual(['custom', 'Vendor']);
    expect(target[1].name).toBe('Renamed');
    expect(target[1].base_url).toBe('https://new.example/v1');
  });

  it('leaves the target untouched when there is nothing new to merge', () => {
    const target: PlatformConfig[] = [config({ name: 'Custom', value: 'custom', platform: 'custom' })];
    mergeModelPlatformPresets(target, []);
    expect(target).toEqual([config({ name: 'Custom', value: 'custom', platform: 'custom' })]);
  });
});
