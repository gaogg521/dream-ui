/**
 * Copyright 2026 One Work
 */

/**
 * Read-only view of a decrypted `.owenc` package. There is deliberately no
 * save, export or "open in system app": the content exists only in this
 * window's memory. Selecting and copying text still works — screens cannot be
 * protected, and pretending otherwise would only mislead — but the explicit
 * "copy all" button is recorded like any other export.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Empty, Message, Modal, Tabs } from '@arco-design/web-react';
import MarkdownView from '@renderer/components/Markdown';
import { copyText } from '@renderer/utils/ui/clipboard';
import type { OpenedPackage } from '@renderer/utils/enterprise/secureExport/openPackage';
import { recordClipboardCopy } from '@renderer/utils/enterprise/secureExport/gateway';

const TEXT_EXTENSIONS = ['md', 'markdown', 'txt', 'json', 'csv', 'log', 'html', 'htm', 'xml', 'yaml', 'yml'];
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function FileBody({ name, bytes }: { name: string; bytes: Uint8Array<ArrayBuffer> }) {
  const { t } = useTranslation();
  const ext = extensionOf(name);
  const text = useMemo(() => (TEXT_EXTENSIONS.includes(ext) ? new TextDecoder().decode(bytes) : null), [bytes, ext]);
  const imageUrl = useMemo(
    () => (IMAGE_MIME[ext] ? URL.createObjectURL(new Blob([bytes], { type: IMAGE_MIME[ext] })) : null),
    [bytes, ext]
  );
  useEffect(() => () => (imageUrl ? URL.revokeObjectURL(imageUrl) : undefined), [imageUrl]);

  if (text !== null) {
    return (
      <div className='flex flex-col gap-8px'>
        <div className='flex justify-end'>
          <Button
            size='mini'
            data-testid='secure-viewer-copy'
            onClick={() => {
              void copyText(text)
                .then(() => {
                  void recordClipboardCopy(text.length);
                  Message.success(t('common.copySuccess'));
                })
                .catch(() => Message.error(t('common.copyFailed')));
            }}
          >
            {t('messages.secureExport.viewerCopyAll')}
          </Button>
        </div>
        {ext === 'md' || ext === 'markdown' ? (
          <MarkdownView>{text}</MarkdownView>
        ) : (
          <pre className='whitespace-pre-wrap break-all text-13px m-0'>{text}</pre>
        )}
      </div>
    );
  }
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className='max-w-full' />;
  }
  return <Empty description={t('messages.secureExport.viewerUnsupported', { size: bytes.length })} />;
}

const SecurePackageViewer: React.FC<{ opened: OpenedPackage | null; onClose: () => void }> = ({ opened, onClose }) => {
  const { t } = useTranslation();
  const [active, setActive] = useState('0');
  useEffect(() => setActive('0'), [opened]);
  if (!opened) return null;
  const { info, files } = opened;

  return (
    <Modal
      visible
      title={t('messages.secureExport.viewerTitle')}
      footer={null}
      onCancel={onClose}
      style={{ width: 'min(960px, 92vw)' }}
      unmountOnExit
    >
      <div data-testid='secure-package-viewer' className='flex flex-col gap-12px'>
        <Alert
          type='info'
          content={t('messages.secureExport.viewerNotice', {
            sender: info.ownerName,
            createdAt: new Date(info.createdAt).toLocaleString(),
            expires: info.expiresAt
              ? new Date(info.expiresAt).toLocaleString()
              : t('messages.secureExport.expiryNever'),
          })}
        />
        {files.length === 1 ? (
          <div className='max-h-[65vh] overflow-auto'>
            <div className='mb-8px text-13px font-medium'>{files[0].name}</div>
            <FileBody name={files[0].name} bytes={files[0].bytes} />
          </div>
        ) : (
          <Tabs activeTab={active} onChange={setActive} type='card-gutter'>
            {files.map((file, index) => (
              <Tabs.TabPane key={String(index)} title={file.name}>
                <div className='max-h-[60vh] overflow-auto pt-8px'>
                  <FileBody name={file.name} bytes={file.bytes} />
                </div>
              </Tabs.TabPane>
            ))}
          </Tabs>
        )}
      </div>
    </Modal>
  );
};

export default SecurePackageViewer;
