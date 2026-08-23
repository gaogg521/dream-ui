/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process-wide registry of user-supplied catalog entries.
 *
 * Deliberately its own module: `overrides.ts` needs the driver gate from
 * `resolve.ts` to validate entries, and `resolve.ts` needs the installed
 * entries — putting the registry in either one would make them import each
 * other. A leaf module holds the state and both depend on it.
 *
 * Renderer-safe: no Node.js imports.
 */

import type { MediaModelSpec } from './types';

let userSpecs: MediaModelSpec[] = [];

/**
 * Install the user's entries for this process.
 *
 * Both the main process (which executes) and the renderer (which decides what
 * the picker offers) install from the same stored setting — if only one did,
 * the two would disagree about what is selectable, which is the drift the
 * catalog exists to prevent.
 */
export const setUserMediaModelSpecs = (specs: MediaModelSpec[]): void => {
  userSpecs = specs;
};

export const getUserMediaModelSpecs = (): MediaModelSpec[] => userSpecs;
