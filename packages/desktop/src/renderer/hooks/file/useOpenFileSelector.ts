import { ipcBridge } from '@/common';
import { IMAGE_EXTENSIONS } from '@/common/config/constants';
import { useCallback } from 'react';

interface UseOpenFileSelectorOptions {
  onFilesSelected: (files: string[]) => void;
}

interface UseOpenFileSelectorResult {
  openFileSelector: (imagesOnly?: boolean) => void;
  onSlashBuiltinCommand: (name: string) => void;
}

/**
 * Shared open-file selector behavior for send boxes.
 * Unifies '+' button and '/open' builtin command handling.
 *
 * In Electron: opens native file dialog.
 * In WebUI: routes through the registered web file picker (webFsPicker),
 * which browses the server filesystem via `/api/fs/dir`.
 */
export function useOpenFileSelector(options: UseOpenFileSelectorOptions): UseOpenFileSelectorResult {
  const { onFilesSelected } = options;

  /**
   * `imagesOnly` narrows the native dialog to picture files. Without it the
   * dialog opens on "All Files (*.*)" even in media mode, which is how a user
   * ends up picking a PDF as a "reference image".
   */
  const openFileSelector = useCallback(
    (imagesOnly?: boolean) => {
      void ipcBridge.dialog.showOpen
        .invoke({
          properties: ['openFile', 'multiSelections'],
          ...(imagesOnly
            ? { filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS.map((ext) => ext.replace(/^\./, '')) }] }
            : {}),
        })
        .then((files) => {
          if (!files || files.length === 0) {
            return;
          }
          onFilesSelected(files);
        })
        .catch((error) => {
          // In WebUI, dialog may fail if DirectorySelectionModal is not rendered
          // or bridge is not properly connected. Log error for debugging.
          console.warn('[useOpenFileSelector] Failed to open file selector:', error);
        });
    },
    [onFilesSelected]
  );

  const onSlashBuiltinCommand = useCallback(
    (name: string) => {
      if (name === 'open') {
        openFileSelector();
      }
    },
    [openFileSelector]
  );

  return {
    openFileSelector,
    onSlashBuiltinCommand,
  };
}
