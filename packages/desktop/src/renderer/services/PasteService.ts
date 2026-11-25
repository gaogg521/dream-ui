/**
 * Copyright 2026 One Work
 */

import type { FileMetadata } from './FileService';
import { FileService, getFileExtension } from './FileService';
import type { UploadSource } from '@/renderer/hooks/file/useUploadState';

type PasteHandler = (event: React.ClipboardEvent | ClipboardEvent) => Promise<boolean>;

/**
 * Per-SendBox counter used to assign stable names to clipboard images. The
 * hook owns one instance and passes it into `handlePaste`, so sequence
 * numbers persist across multiple paste actions within the same mount.
 */
export type ImageCounter = { next: () => number };

// MIME 类型到文件扩展名的映射
function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
  };
  return mimeMap[mimeType] || '.png'; // 默认为 .png
}

// 浏览器把剪贴板图片默认命名成 image.png / image.jpg 之类，这种名字
// 跟 MIME 一一对应、没有实际语义，应视为系统默认名并由我们重命名。
const BROWSER_DEFAULT_IMAGE_NAME_RE = /^image\.(png|jpe?g|gif|webp|bmp|svg)$/i;
// 我们自己旧版本的默认名，形如 `2024-01-02_03-04-05` 前缀。
const LEGACY_SYSTEM_GENERATED_NAME_RE = /^[a-zA-Z]?_?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;

function isSystemGeneratedImageName(name: string | undefined | null): boolean {
  if (!name) return true;
  return LEGACY_SYSTEM_GENERATED_NAME_RE.test(name) || BROWSER_DEFAULT_IMAGE_NAME_RE.test(name);
}

class PasteServiceClass {
  private handlers: Map<string, PasteHandler> = new Map();
  private lastFocusedComponent: string | null = null;
  private isInitialized = false;

  // 初始化全局粘贴监听
  init() {
    if (this.isInitialized) return;

    document.addEventListener('paste', this.handleGlobalPaste);
    this.isInitialized = true;
  }

  // 注册组件的粘贴处理器
  registerHandler(componentId: string, handler: PasteHandler) {
    this.handlers.set(componentId, handler);
  }

  // 注销组件的粘贴处理器
  unregisterHandler(componentId: string) {
    this.handlers.delete(componentId);
  }

  // 设置当前焦点组件
  setLastFocusedComponent(componentId: string) {
    this.lastFocusedComponent = componentId;
  }

  // 全局粘贴事件处理
  private handleGlobalPaste = async (event: ClipboardEvent) => {
    // 当粘贴目标是可编辑元素（input/textarea/contentEditable）时，直接交给浏览器原生行为，避免拦截其他输入框
    if (this.shouldAllowNativePaste(event)) {
      return;
    }

    if (!this.lastFocusedComponent) return;

    const handler = this.handlers.get(this.lastFocusedComponent);
    if (handler) {
      const handled = await handler(event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  private shouldAllowNativePaste(event: ClipboardEvent): boolean {
    const target = event.target;
    if (!target || !(target instanceof Element)) {
      return false;
    }

    const editableElement = target.closest('input, textarea, [contenteditable]');
    if (!editableElement) {
      return false;
    }

    if (editableElement instanceof HTMLInputElement || editableElement instanceof HTMLTextAreaElement) {
      return true;
    }

    if (editableElement instanceof HTMLElement) {
      if (editableElement.isContentEditable) {
        return true;
      }
      const attr = editableElement.getAttribute('contenteditable');
      return !!attr && attr.toLowerCase() !== 'false';
    }

    return false;
  }

  // 通用粘贴处理逻辑
  async handlePaste(
    event: React.ClipboardEvent | ClipboardEvent,
    supportedExts: string[],
    onFilesAdded: (files: FileMetadata[]) => void,
    onTextPaste?: (text: string) => void,
    conversation_id?: string,
    source: UploadSource = 'sendbox',
    imageCounter?: ImageCounter
  ): Promise<boolean> {
    // 立即事件冒泡,避免全局监听器重复处理
    event.stopPropagation();
    const clipboardText = event.clipboardData?.getData('text');
    // Clipboard FileList access is restricted to the paste event.
    const files = Array.from(event.clipboardData?.files ?? []);
    const allowAll = !supportedExts || supportedExts.length === 0;

    if (files.length > 0) {
      const attachments: File[] = [];
      const usedNames = new Set<string>();
      for (const file of files) {
        const image = file.type.startsWith('image/');
        const extension = getFileExtension(file.name) || (image ? getExtensionFromMimeType(file.type) : '');
        if (!allowAll && !supportedExts.includes(extension)) continue;

        let name = file.name;
        const localPath =
          image && (window.electronAPI?.getPathForFile?.(file) || (file as File & { path?: string }).path);
        if (image && !localPath && isSystemGeneratedImageName(name)) {
          name = imageCounter ? `image-${imageCounter.next()}${extension}` : `pasted_image_${Date.now()}${extension}`;
        }
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.');
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const suffix = dot > 0 ? name.slice(dot) : extension;
          let count = 2;
          while (usedNames.has(`${stem}_${count}${suffix}`)) count++;
          name = `${stem}_${count}${suffix}`;
        }
        usedNames.add(name);
        attachments.push(name === file.name ? file : new File([file], name, file));
      }
      const uploaded = await FileService.processDroppedFiles(attachments, conversation_id, source);
      if (uploaded.length > 0) onFilesAdded(uploaded);
      return true;
    }

    if (clipboardText) {
      // 在 iOS 上, 让 Safari 自己处理纯文本粘贴, 以避免粘贴菜单/键盘抖动问题
      const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);
      if (isIOS) {
        return false;
      }
      if (onTextPaste) {
        // 清理文本中多余的换行符，特别是末尾的换行符
        const cleanedText = clipboardText.replace(/\n\s*$/, '');
        onTextPaste(cleanedText);
        return true; // 已处理，阻止默认行为
      }
      return false; // 如果没有回调，允许默认行为
    }

    return false;
  }

  // 清理资源
  destroy() {
    if (this.isInitialized) {
      document.removeEventListener('paste', this.handleGlobalPaste);
      this.handlers.clear();
      this.lastFocusedComponent = null;
      this.isInitialized = false;
    }
  }
}

// 导出单例实例
export const PasteService = new PasteServiceClass();
