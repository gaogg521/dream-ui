/**
 * Copyright 2026 One Work
 */

import DreamModal from '@renderer/components/base/DreamModal';
import { FEEDBACK_MODULES } from './feedbackModules';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { uploadFileViaHttp } from '@/renderer/services/FileService';
import { Alert, Button, Input, Select, Message, Upload, Tabs } from '@arco-design/web-react';
import type { UploadItem } from '@arco-design/web-react/es/Upload';
import { Info } from '@icon-park/react';
import QqContactLogo from '@renderer/assets/contact/qq-logo.png';
import MailContactLogo from '@renderer/assets/contact/mail-logo.ico?url';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { RefTextAreaType } from '@arco-design/web-react/es/Input/textarea';
import { useTranslation } from 'react-i18next';
import {
  type FeedbackAttachment,
  type FeedbackEventExtra,
  type FeedbackEventTags,
  submitFeedbackReport,
} from '@/renderer/services/feedback/submitFeedbackReport';
import type {
  FeedbackDiagnosticsExplicitContext,
  FeedbackDiagnosticsProfile,
} from '@/common/types/feedbackDiagnostics';
import { captureFeedbackRoute } from '@/renderer/services/feedback/routeContext';
import { openExternalUrl } from '@/renderer/utils/platform';

export type { FeedbackEventExtra, FeedbackEventTags } from '@/renderer/services/feedback/submitFeedbackReport';

const DESCRIPTION_MAX_LENGTH = 2000;
const MAX_SCREENSHOTS = 3;
const ACCEPTED_IMAGE_TYPES = '.png,.jpg,.jpeg,.gif';

const FEEDBACK_CONTACT_EMAIL = '475332294@qq.com';
const FEEDBACK_CONTACT_QQ = '475332294';
const FEEDBACK_QQ_URL = `https://wpa.qq.com/msgrd?v=3&uin=${FEEDBACK_CONTACT_QQ}&site=qq&menu=yes`;

// dream's AuthUser is { id, username } and carries no email; aionpro's AuthUser
// does. Read it structurally (no AuthUser type import, no `any`) so this file
// stays byte-identical across both repos and simply yields undefined whenever
// the signed-in user has no email (the open-source desktop build is usually
// logged out entirely), in which case the report is submitted without one.
const readAccountEmail = (user: unknown): string | undefined => {
  if (!user || typeof user !== 'object' || !('email' in user)) {
    return undefined;
  }
  const email = (user as { email: unknown }).email;
  return typeof email === 'string' && email.trim().length > 0 ? email.trim() : undefined;
};

const getUploadItemKey = (item: Pick<UploadItem, 'name' | 'originFile'>) =>
  `${item.originFile?.name ?? item.name}_${item.originFile?.size ?? 0}`;

const createPastedImageName = (file: File, index: number) => {
  if (file.name.trim()) {
    return file.name;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = file.type.split('/')[1] || 'png';
  return `pasted-screenshot-${timestamp}-${index + 1}.${ext}`;
};

export type PrefilledScreenshot = {
  filename: string;
  data: Uint8Array;
  type: string;
};

type FeedbackReportModalProps = {
  visible: boolean;
  onCancel: () => void;
  defaultModule?: string;
  prefilledScreenshots?: PrefilledScreenshot[];
  feedbackTags?: FeedbackEventTags;
  feedbackExtra?: FeedbackEventExtra;
  feedbackDiagnosticsContext?: {
    explicitContext?: FeedbackDiagnosticsExplicitContext;
    explicitProfiles?: FeedbackDiagnosticsProfile[];
    routeAtOpen?: string;
  };
};

const FeedbackReportModal: React.FC<FeedbackReportModalProps> = ({
  visible,
  onCancel,
  defaultModule,
  prefilledScreenshots,
  feedbackTags,
  feedbackExtra,
  feedbackDiagnosticsContext,
}) => {
  const { t } = useTranslation();
  const talkToButler = useTalkToButler();
  const { user } = useAuth();
  const accountEmail = readAccountEmail(user);

  const [module, setModule] = useState<string | undefined>(defaultModule);
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const descriptionRef = useRef<RefTextAreaType | null>(null);
  const [error, setError] = useState('');
  const [feedbackView, setFeedbackView] = useState('report');
  const [receipt, setReceipt] = useState<string | null>(null);
  const submitLock = useRef(false);

  const resetForm = useCallback(() => {
    setFeedbackView('report');
    setModule(undefined);
    setDescription('');
    setScreenshots([]);
    setError('');
    setReceipt(null);
  }, []);

  // Auto-focus the description textarea when the modal opens so users can
  // start typing immediately. Deferred one frame after the open transition so
  // ModalWrapper's internal focus lock has finished installing its traps.
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => {
      descriptionRef.current?.focus?.();
    }, 80);
    return () => window.clearTimeout(id);
  }, [visible]);

  // Seed form with prefilled module + screenshots whenever the modal (re)opens.
  // Prefilled screenshots are auto-captured by the one-click feedback entry points
  // and arrive as raw bytes; wrap them as File/UploadItem so the existing Upload
  // submit flow handles them identically to user-uploaded images.
  useEffect(() => {
    if (!visible) return;
    setModule(defaultModule);
    if (prefilledScreenshots && prefilledScreenshots.length > 0) {
      const items: UploadItem[] = prefilledScreenshots.slice(0, MAX_SCREENSHOTS).map((shot, index) => {
        // Normalize into a Blob so the BlobPart typing accepts SharedArrayBuffer-backed
        // Uint8Array values returned over IPC on some Electron/TS target combos.
        const blob = new Blob([shot.data.slice().buffer as ArrayBuffer], { type: shot.type });
        const file = new File([blob], shot.filename, { type: shot.type });
        return {
          uid: `prefilled-${Date.now()}-${index}`,
          name: shot.filename,
          originFile: file,
          status: 'done',
        };
      });
      setScreenshots(items);
    }
  }, [visible, defaultModule, prefilledScreenshots]);

  const handleCancel = useCallback(() => {
    if (submitLock.current) return;
    resetForm();
    onCancel();
  }, [onCancel, resetForm]);

  const selectedModule = FEEDBACK_MODULES.find((item) => item.tag === module);

  const handleSubmit = useCallback(async () => {
    if (!module || !description.trim() || submitLock.current || receipt) {
      return;
    }

    setError('');
    submitLock.current = true;
    setSubmitting(true);

    try {
      const attachments = (
        await Promise.all(
          screenshots.map(async (item, index) => {
            if (!item.originFile) {
              return null;
            }

            const buffer = await item.originFile.arrayBuffer();
            const ext = item.originFile.name.split('.').pop() || 'png';
            return {
              filename: `screenshot-${index + 1}-${item.originFile.name}`,
              data: new Uint8Array(buffer),
              contentType: item.originFile.type || `image/${ext}`,
            };
          })
        )
      ).filter((item): item is FeedbackAttachment => item !== null);

      const moduleLabel = t(selectedModule?.i18nKey ?? 'settings.bugReportModuleOther');

      const delivered = await submitFeedbackReport({
        attachments,
        collectDbDiagnostics: {
          explicitContext: feedbackDiagnosticsContext?.explicitContext,
          explicitProfiles: feedbackDiagnosticsContext?.explicitProfiles,
          routeAtOpen: feedbackDiagnosticsContext?.routeAtOpen,
          routeAtSubmit: captureFeedbackRoute(),
          selectedModule: module,
        },
        collectLogs: true,
        // Silently attach the signed-in user's account email (undefined when
        // logged out or on the open-source build) so support can follow up
        // without asking the reporter to type it in.
        contactEmail: accountEmail,
        description,
        extra: feedbackExtra,
        module,
        moduleLabel,
        tags: feedbackTags,
      });

      setReceipt(delivered.eventId);
    } catch {
      setError(t('settings.bugReportError'));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }, [
    module,
    description,
    accountEmail,
    screenshots,
    t,
    onCancel,
    resetForm,
    selectedModule,
    feedbackExtra,
    feedbackTags,
    feedbackDiagnosticsContext,
    receipt,
  ]);

  const contact = async (channel: 'qq' | 'copy' | 'email') => {
    try {
      if (channel === 'copy') {
        await navigator.clipboard.writeText(FEEDBACK_CONTACT_QQ);
        Message.success(t('settings.feedbackQqCopied'));
      } else if (channel === 'qq') {
        await openExternalUrl(FEEDBACK_QQ_URL);
        Message.info(t('settings.feedbackQqOpening'));
      } else {
        const moduleLabel = t(selectedModule?.i18nKey ?? 'settings.bugReportModuleOther');
        const subject = `[One Work] ${moduleLabel}`;
        const body = [moduleLabel, description.trim(), receipt ? t('settings.feedbackReceipt', { id: receipt }) : '']
          .filter(Boolean)
          .join('\n\n');
        await openExternalUrl(
          `mailto:${FEEDBACK_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        );
        Message.info(t('settings.feedbackEmailOpening'));
      }
    } catch {
      Message.error(t('settings.feedbackContactFailed'));
    }
  };

  // "Solve via chat": hand the report to the Dream UI Butler for on-the-spot
  // diagnosis instead of submitting to the team. The typed description + module
  // become a structured prompt; screenshots are uploaded to disk so they ride
  // along in the chat input (reusing the same upload path as pasted images).
  const handleDiagnose = useCallback(async () => {
    if (!description.trim()) return;
    setError('');
    setDiagnosing(true);
    try {
      const files = (
        await Promise.all(
          screenshots.map(async (item) => {
            if (!item.originFile) return null;
            try {
              return await uploadFileViaHttp(item.originFile);
            } catch (uploadError) {
              console.error('[feedback] failed to upload screenshot for diagnosis:', uploadError);
              return null;
            }
          })
        )
      ).filter((path): path is string => typeof path === 'string' && path.length > 0);

      const moduleLabel = t(selectedModule?.i18nKey ?? 'settings.bugReportModuleOther');
      const prompt = t('settings.talkToButler.prompt.diagnose', {
        defaultValue:
          'I ran into a problem with One Work, please help me diagnose it.\n\n[Module] {{module}}\n[Description] {{description}}\n[Attachments] see the screenshots in the input.\n\nPlease diagnose the cause and tell me how to fix it.',
        module: moduleLabel,
        description: description.trim(),
      });

      await talkToButler({ prompt, files });
      resetForm();
      onCancel();
    } catch {
      setError(t('settings.bugReportError'));
    } finally {
      setDiagnosing(false);
    }
  }, [description, screenshots, selectedModule, t, talkToButler, resetForm, onCancel]);

  const isFormValid = module !== undefined && description.trim().length > 0;

  const appendScreenshotFiles = useCallback((files: File[]) => {
    setError('');
    setScreenshots((current) => {
      const merged = [...current];
      const seen = new Set(current.map(getUploadItemKey));

      files.forEach((file, index) => {
        if (merged.length >= MAX_SCREENSHOTS) {
          return;
        }

        const normalizedFile = file.name.trim()
          ? file
          : new File([file], createPastedImageName(file, index), {
              type: file.type,
              lastModified: file.lastModified,
            });
        const nextItem: UploadItem = {
          uid: `pasted-${Date.now()}-${index}-${merged.length}`,
          name: normalizedFile.name,
          originFile: normalizedFile,
          status: 'done',
        };

        const key = getUploadItemKey(nextItem);
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        merged.push(nextItem);
      });

      return merged;
    });
  }, []);

  const handleScreenshotChange = useCallback((fileList: UploadItem[]) => {
    setError('');
    // Deduplicate by file name + size, then mark as 'done' to hide progress indicators
    const seen = new Set<string>();
    const deduped = fileList.filter((f) => {
      const key = `${f.originFile?.name ?? f.name}_${f.originFile?.size ?? 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setScreenshots(deduped.map((f) => (f.status === 'done' ? f : Object.assign({}, f, { status: 'done' as const }))));
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      appendScreenshotFiles(files);
    },
    [appendScreenshotFiles]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste, visible]);

  return (
    <DreamModal
      variant='standard'
      header={{ title: t('settings.bugReportTitle'), showClose: !submitting }}
      visible={visible}
      onCancel={handleCancel}
      maskClosable={!submitting}
      escToExit={!submitting}
      onOk={() => {
        if (feedbackView === 'report') void handleSubmit();
      }}
      confirmLoading={submitting}
      okText={t('settings.bugReportSubmit')}
      cancelText={t('settings.bugReportCancel')}
      okButtonProps={{ disabled: !isFormValid }}
      alignCenter
      footer={{
        render: () => (
          <div className={`flex items-center gap-8px ${feedbackView === 'report' ? 'justify-between' : 'justify-end'}`}>
            {/* "Solve via chat" is an alternative self-service path — kept on the
                left as a borderless text action so it reads as secondary to the
                primary submit, not as a competing filled button. */}
            {feedbackView === 'report' && (
              <Button
                type='text'
                loading={diagnosing}
                disabled={!description.trim() || submitting || Boolean(receipt)}
                onClick={() => void handleDiagnose()}
                data-testid='btn-feedback-diagnose'
                className='!text-primary-6 hover:!text-primary-5'
              >
                {t('settings.talkToButler.solveViaChat', { defaultValue: 'Solve via chat' })}
              </Button>
            )}
            <div className='flex items-center gap-8px'>
              <Button
                disabled={submitting}
                onClick={handleCancel}
                className='px-20px min-w-80px'
                style={{ borderRadius: 8 }}
              >
                {t(receipt || feedbackView === 'contact' ? 'common.close' : 'settings.bugReportCancel')}
              </Button>
              {!receipt && feedbackView === 'report' && (
                <Button
                  type='primary'
                  loading={submitting}
                  disabled={!isFormValid || diagnosing}
                  onClick={() => void handleSubmit()}
                  className='px-20px min-w-80px'
                  style={{ borderRadius: 8 }}
                >
                  {t('settings.bugReportSubmit')}
                </Button>
              )}
            </div>
          </div>
        ),
      }}
      className='w-[min(600px,calc(100vw-32px))] max-w-600px'
      autoFocus={false}
      // The feedback modal is global and may be opened from inside another
      // DreamModal (e.g. the Agent editor). Arco's default z-index stacks
      // modals in mount order, which leaves the feedback modal under the
      // pre-existing modal when both are open. Bump wrap+mask above the
      // standard 1001 so feedback always appears on top.
      wrapStyle={{ zIndex: 1050 }}
      maskStyle={{ zIndex: 1050 }}
    >
      <div data-testid='feedback-report-scroll-body' className='overflow-x-hidden'>
        <Tabs
          activeTab={feedbackView}
          onChange={setFeedbackView}
          style={{ '--primary-6': 'var(--blue-6)', '--arcoblue-6': 'var(--blue-6)' } as React.CSSProperties}
        >
          <Tabs.TabPane key='report' title={t('settings.feedbackReportTitle')} disabled={submitting}>
            <div className='flex flex-col gap-16px pt-8px'>
              {receipt && (
                <Alert
                  type='success'
                  title={t('settings.bugReportSuccess')}
                  content={<span className='break-all'>{t('settings.feedbackReceipt', { id: receipt })}</span>}
                />
              )}
              {/* Description */}
              <div className='flex flex-col gap-4px'>
                <label className='text-13px text-t-secondary'>
                  {t('settings.bugReportDescriptionLabel')} <span className='text-red-500'>*</span>
                </label>
                <Input.TextArea
                  ref={descriptionRef}
                  disabled={submitting || Boolean(receipt)}
                  placeholder={t('settings.bugReportDescriptionPlaceholder')}
                  value={description}
                  onChange={(val) => {
                    setDescription(val);
                    setError('');
                  }}
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  showWordLimit
                  autoSize={{ minRows: 3, maxRows: 6 }}
                />
              </div>

              {/* Module Select */}
              <div className='flex flex-col gap-4px'>
                <label className='text-13px text-t-secondary'>
                  {t('settings.bugReportModuleLabel')} <span className='text-red-500'>*</span>
                </label>
                <Select
                  disabled={submitting || Boolean(receipt)}
                  placeholder={t('settings.bugReportModulePlaceholder')}
                  value={module}
                  onChange={(val) => {
                    setModule(val);
                    setError('');
                  }}
                >
                  {FEEDBACK_MODULES.map((m) => (
                    <Select.Option key={m.tag} value={m.tag}>
                      {t(m.i18nKey)}
                    </Select.Option>
                  ))}
                </Select>
              </div>

              {/* Screenshot Upload */}
              <div className='flex flex-col gap-4px'>
                <label className='text-13px text-t-secondary'>
                  {t('settings.bugReportScreenshotLabel')}
                  {screenshots.length > 0 && (
                    <span data-testid='feedback-report-screenshot-count'>
                      {' '}
                      {t('settings.bugReportScreenshotUploaded', { count: screenshots.length })}
                    </span>
                  )}
                </label>
                <div data-testid='feedback-report-upload-trigger'>
                  <Upload
                    disabled={submitting || Boolean(receipt)}
                    listType='picture-card'
                    multiple
                    accept={ACCEPTED_IMAGE_TYPES}
                    autoUpload={false}
                    fileList={screenshots}
                    onChange={handleScreenshotChange}
                    limit={MAX_SCREENSHOTS}
                    imagePreview
                  />
                </div>
              </div>

              {/* Auto-info Banner */}
              <div className='flex'>
                <div
                  data-testid='feedback-report-auto-info'
                  className='inline-flex max-w-full items-start gap-6px px-10px py-8px bg-fill-1 rd-8px text-12px leading-18px text-t-tertiary'
                >
                  <Info theme='outline' size='14' className='mt-2px flex-shrink-0' />
                  <span>{t('settings.bugReportAutoInfo')}</span>
                </div>
              </div>

              {error ? (
                <div className='px-12px py-8px bg-[rgba(var(--danger-6),0.1)] rd-8px text-13px text-red-500 b-1px b-solid b-[rgba(var(--danger-6),0.4)]'>
                  {error}
                </div>
              ) : null}
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane key='contact' title={t('settings.feedbackContactTitle')} disabled={submitting}>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-16px py-12px'>
              <section className='border border-2 rd-20px p-20px flex flex-col gap-16px min-w-0 bg-fill-1'>
                <div className='flex items-center gap-12px'>
                  <span className='flex items-center justify-center w-52px h-52px rd-16px bg-[rgba(var(--blue-6),0.10)]'>
                    <img src={QqContactLogo} alt='' className='w-40px h-40px object-contain' />
                  </span>
                  <strong className='text-16px text-t-primary'>{t('settings.feedbackQqTitle')}</strong>
                </div>
                <span className='text-24px font-600 text-t-primary tracking-wide'>{FEEDBACK_CONTACT_QQ}</span>
                <p className='text-13px text-t-secondary leading-relaxed m-0'>{t('settings.feedbackQqHint')}</p>
                <div className='flex flex-wrap gap-8px mt-auto pt-8px'>
                  <Button
                    type='primary'
                    className='flex-1'
                    style={{ background: 'rgb(var(--blue-6))', borderColor: 'rgb(var(--blue-6))' }}
                    onClick={() => void contact('qq')}
                  >
                    {t('settings.feedbackOpenQq')}
                  </Button>
                  <Button className='flex-1' onClick={() => void contact('copy')}>
                    {t('settings.feedbackCopyQq')}
                  </Button>
                </div>
              </section>
              <section className='border border-2 rd-20px p-20px flex flex-col gap-16px min-w-0 bg-fill-1'>
                <div className='flex items-center gap-12px'>
                  <span className='flex items-center justify-center w-52px h-52px rd-16px bg-[rgba(var(--blue-6),0.10)]'>
                    <img src={MailContactLogo} alt='' className='w-40px h-40px object-contain' />
                  </span>
                  <strong className='text-16px text-t-primary'>{t('settings.feedbackEmailTitle')}</strong>
                </div>
                <span className='text-16px font-600 text-t-primary break-all leading-32px'>
                  {FEEDBACK_CONTACT_EMAIL}
                </span>
                <p className='text-13px text-t-secondary leading-relaxed m-0'>{t('settings.feedbackEmailHint')}</p>
                <Button className='mt-auto' onClick={() => void contact('email')}>
                  {t('settings.bugReportEmailConfirmOk')}
                </Button>
              </section>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </DreamModal>
  );
};

export default FeedbackReportModal;
