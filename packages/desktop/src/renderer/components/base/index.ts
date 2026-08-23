/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AionUi 基础组件库统一导出 / AionUi base components unified exports
 *
 * 提供所有基础组件和类型的统一导出入口
 * Provides unified export entry for all base components and types
 */

// ==================== 组件导出 / Component Exports ====================

export { default as DreamModal } from './DreamModal';
export { default as DreamCollapse } from './DreamCollapse';
export { default as DreamSelect } from './DreamSelect';
export { default as DreamScrollArea } from './DreamScrollArea';
export { default as DreamSteps } from './DreamSteps';
export { default as DreamSearchInput } from './DreamSearchInput';
export { default as DreamInlineSearchInput } from './DreamInlineSearchInput';

// ==================== 类型导出 / Type Exports ====================

// DreamModal 类型 / DreamModal types
export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  AionModalProps,
} from './DreamModal';
export { MODAL_SIZES } from './DreamModal';

// DreamCollapse 类型 / DreamCollapse types
export type { AionCollapseProps, AionCollapseItemProps } from './DreamCollapse';

// DreamSelect 类型 / DreamSelect types
export type { AionSelectProps } from './DreamSelect';

// DreamSteps 类型 / DreamSteps types
export type { AionStepsProps } from './DreamSteps';

// DreamSearchInput 类型 / DreamSearchInput types
export type { AionSearchInputProps } from './DreamSearchInput';

// DreamInlineSearchInput 类型 / DreamInlineSearchInput types
export type { AionInlineSearchInputProps } from './DreamInlineSearchInput';
