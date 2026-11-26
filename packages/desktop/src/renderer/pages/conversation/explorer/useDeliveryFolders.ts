import { ipcBridge } from '@/common';
import { useEffect, useRef } from 'react';
import { useSWRConfig } from 'swr';
import { useMessageList } from '../Messages/hooks';
import { toLocalFileHref } from '@/renderer/components/Markdown/markdownUtils';
import { deliveryParent, deliveryPaths, folderContains } from './deliveryFolders';
import { getCurrentProject } from './currentProjectStore';
import { reveal } from './explorerStore';

/** Persist verified delivery roots on the owning project, including historical replies. */
export function useDeliveryFolders(conversationId: string) {
  const messages = useMessageList();
  const { mutate } = useSWRConfig();
  const processed = useRef(new Set<string>());
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const candidates = deliveryPaths(messages);
      if (!candidates.length) return;
      queue.current = queue.current
        .then(async () => {
          if (cancelled) return;
          const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
          const projectId = conversation?.project_id;
          if (!projectId || cancelled) return;
          const detail = await ipcBridge.project.get.invoke({ project_id: projectId });
          const roots = detail.explorer.entries.map((entry) => entry.display_path);
          for (const path of candidates) {
            if (cancelled) return;
            const key = `${projectId}:${path}`;
            if (processed.current.has(key)) continue;
            if (roots.some((root) => folderContains(root, path))) {
              processed.current.add(key);
              continue;
            }
            try {
              const metadata = await ipcBridge.fs.getFileMetadata.invoke({ path });
              if (!metadata) continue;
              const folder = metadata.isDirectory ? path : deliveryParent(path);
              // A delivery must not turn an entire drive or filesystem into a project root.
              if (!folder || /^(?:[A-Za-z]:\/?|\/)$/u.test(folder)) continue;
              if (!roots.some((root) => folderContains(root, folder))) {
                const entry = await ipcBridge.project.attachFolder.invoke({
                  project_id: projectId,
                  uri: toLocalFileHref(folder),
                });
                roots.push(entry.display_path);
                await mutate(`explorer-project/${projectId}`);
                if (getCurrentProject() === projectId) reveal({ pe_id: entry.pe_id, relative_path: '' });
              }
              processed.current.add(key);
            } catch (error) {
              // Incomplete streamed paths and files removed since an older reply are retryable.
              console.debug('[delivery-folders] Could not associate delivery', error);
            }
          }
        })
        .catch((error) => console.debug('[delivery-folders] Could not load owning project', error));
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversationId, messages, mutate]);
}
