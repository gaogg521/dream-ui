import { MODEL_KINDS, type IProvider } from '@/common/config/storage';
import {
  diagnoseEndpointMismatch,
  ENDPOINT_STYLE_INFO,
  IMPLEMENTED_ENDPOINT_STYLES,
  resolveMediaModelSpec,
  SYNC_IMAGE_ENDPOINT_STYLES,
} from '@/common/media/catalog';
import {
  type ModelKindChoice,
  type ModelImageInputChoice,
  type ModelOpenAiApiModeChoice,
  supportsOpenAiApiMode,
  updateModelSettings,
} from '@/common/utils/modelCapabilities';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { SHOW_MEDIA_COST_SWR_KEY } from '@renderer/hooks/media/useMediaCost';
import { mutate as globalMutate } from 'swr';
import DreamModal from '@/renderer/components/base/DreamModal';
import { Input, Select, Switch } from '@arco-design/web-react';
import { PreviewOpen } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useModeModeList from '@renderer/hooks/agent/useModeModeList';
import {
  isNewApiPlatform,
  NEW_API_PROTOCOL_OPTIONS,
  detectNewApiProtocol,
} from '@/renderer/utils/model/modelPlatforms';

const AddModelModal = ModalHOC<{ data?: IProvider; model?: string; onSubmit: (model: IProvider) => void }>(
  ({ modalProps, data, model: editingModel, onSubmit, modalCtrl }) => {
    const { t } = useTranslation();
    const [models, setModels] = useState<string[]>([]);
    const [modelProtocol, setModelProtocol] = useState<string>('openai');
    const [imageInput, setImageInput] = useState<ModelImageInputChoice>('auto');
    const [openAiApiMode, setOpenAiApiMode] = useState<ModelOpenAiApiModeChoice>('auto');
    const [modelKind, setModelKind] = useState<ModelKindChoice>('auto');
    /** Context window as typed; parsed to tokens on save. Empty = engine default. */
    const [contextWindow, setContextWindow] = useState<string>('');
    const [mediaEndpoint, setMediaEndpoint] = useState<string>('');
    const [mediaUnitPrice, setMediaUnitPrice] = useState<string>('');
    const [showMediaCost, setShowMediaCost] = useState(false);
    /** Per-resolution prices as typed, keyed by tier. Parsed on save. */
    const [tierPrices, setTierPrices] = useState<Record<string, string>>({});
    const isNewApi = isNewApiPlatform(data?.platform ?? '');
    const isEditing = Boolean(editingModel);
    const { data: modelList, isLoading } = useModeModeList(data?.platform, data?.base_url, data?.api_key);
    const existingModels = data?.models || [];
    const showOpenAiApiMode = supportsOpenAiApiMode(data?.platform ?? '', modelProtocol);
    const optionsList = useMemo(() => {
      // 处理新的数据格式，可能包含 fix_base_url
      const fetchedModels = Array.isArray(modelList) ? modelList : modelList?.models || [];
      if (!fetchedModels || !data?.models) return fetchedModels;
      return fetchedModels.map((item) => {
        return { ...item, disabled: data.models.includes(item.value) };
      });
    }, [modelList, data?.models]);

    /**
     * "You probably picked the wrong protocol" — display only, matching the
     * `useMediaFailureAdvice.ts` philosophy: a guess this cheap (a substring
     * match against a driver's own fallback host) can inform, never gate.
     * `hostAgnostic` (Kling) and `gatewayStyle` (the two internal-gateway
     * styles) get a fixed explanatory note instead of a host comparison —
     * neither has a `base_url` it would make sense to check against.
     */
    const endpointMismatchWarning = useMemo(() => {
      if (!mediaEndpoint) return null;
      const diagnosis = diagnoseEndpointMismatch(mediaEndpoint, data?.base_url);
      if (!diagnosis) return null;
      switch (diagnosis.kind) {
        case 'hostAgnostic':
          return t('settings.mediaEndpointHostAgnosticWarning');
        case 'gatewayStyle':
          return t('settings.mediaEndpointGatewayNote');
        case 'hostMismatch':
          return t('settings.mediaEndpointHostMismatchWarning', {
            baseUrl: diagnosis.baseUrl,
            hints: diagnosis.hints.join(' / '),
          });
      }
    }, [mediaEndpoint, data?.base_url, t]);

    useEffect(() => {
      if (!modalProps.visible) return;

      setModels([]);
      const settings = editingModel ? data?.model_settings?.[editingModel] : undefined;
      setImageInput(settings?.image_input ?? 'auto');
      setOpenAiApiMode(settings?.openai_api_mode ?? 'auto');
      setModelKind(settings?.model_kind ?? 'auto');
      setContextWindow(typeof settings?.context_window === 'number' ? String(settings.context_window) : '');
      setMediaEndpoint(settings?.media_endpoint ?? '');
      setMediaUnitPrice(
        typeof settings?.media_unit_price_usd === 'number' ? String(settings.media_unit_price_usd) : ''
      );
      setTierPrices(
        Object.fromEntries(
          Object.entries(settings?.media_unit_prices_usd ?? {}).map(([tier, value]) => [tier, String(value)])
        )
      );
      setModelProtocol(editingModel ? (data?.model_protocols?.[editingModel] ?? 'openai') : 'openai');
      // The cost-display preference is global, so it is read here rather than
      // from this model's settings — and re-read on every open so a change made
      // from another model's dialog is reflected.
      void getClientBusinessSetting('tools.showMediaCost')
        .then((value) => setShowMediaCost(value === true))
        .catch(() => setShowMediaCost(false));
    }, [data, editingModel, modalProps.visible]);

    /**
     * The resolution tiers this model actually offers, so a price can be given
     * per tier instead of one flat rate for all of them.
     *
     * Only when editing a single existing model: the multi-select "add models"
     * path has no one spec to read, and offering tiers that may not apply to
     * every selected model would invite prices attached to nothing. Empty for a
     * model whose spec lists no resolutions (most image models), which collapses
     * this back to the single flat field.
     */
    const priceTiers = useMemo(() => {
      if (!editingModel || !data) return [] as string[];
      if (modelKind !== 'image' && modelKind !== 'video') return [] as string[];
      const spec = resolveMediaModelSpec(modelKind, data, editingModel);
      return spec?.params?.resolutions ?? spec?.params?.sizes ?? [];
    }, [data, editingModel, modelKind]);

    const handleConfirm = useCallback(() => {
      if (!data || (!editingModel && !models.length)) return;
      const targetModels = editingModel ? [editingModel] : models;
      const updatedData: IProvider = {
        ...data,
        models: editingModel ? existingModels : [...existingModels, ...models],
        model_settings: updateModelSettings(
          data.model_settings,
          targetModels,
          imageInput,
          showOpenAiApiMode ? openAiApiMode : 'auto',
          modelKind,
          mediaEndpoint,
          mediaUnitPrice.trim() ? Number(mediaUnitPrice) : undefined,
          Object.fromEntries(
            Object.entries(tierPrices)
              .filter(([, raw]) => raw.trim() !== '')
              .map(([tier, raw]) => [tier, Number(raw)])
          ),
          contextWindow.trim() ? Number(contextWindow) : undefined
        ),
      };

      // new-api 平台：为每个选中的模型添加协议配置 / new-api platform: add protocol config for every selected model
      if (isNewApi) {
        updatedData.model_protocols = {
          ...data?.model_protocols,
          ...Object.fromEntries(targetModels.map((model) => [model, modelProtocol])),
        };
      }

      onSubmit(updatedData);
      modalCtrl.close();
    }, [
      contextWindow,
      data,
      editingModel,
      existingModels,
      imageInput,
      isNewApi,
      mediaEndpoint,
      mediaUnitPrice,
      modelKind,
      modelProtocol,
      models,
      onSubmit,
      openAiApiMode,
      modalCtrl,
      showOpenAiApiMode,
    ]);

    return (
      <DreamModal
        variant='standard'
        visible={modalProps.visible}
        onCancel={modalCtrl.close}
        header={{ title: t(isEditing ? 'settings.configureModel' : 'settings.addModel'), showClose: true }}
        onOk={handleConfirm}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !isEditing && !models.length }}
      >
        <div className='flex flex-col gap-16px'>
          {isEditing ? (
            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.modelName')}</div>
              <div className='text-14px text-t-primary'>{editingModel}</div>
            </div>
          ) : (
            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.addModelPlaceholder')}</div>
              <Select
                mode='multiple'
                showSearch
                options={optionsList}
                loading={isLoading}
                onChange={(value: string[]) => {
                  setModels(value);
                  // new-api 平台：以最后选中的模型推断协议 / new-api: infer protocol from the last picked model
                  if (isNewApi && value.length > 0) setModelProtocol(detectNewApiProtocol(value[value.length - 1]));
                }}
                value={models}
                allowCreate
                placeholder={t('settings.addModelPlaceholder')}
              />
            </div>
          )}

          {/* New API 协议选择 / New API Protocol Selection */}
          {isNewApi && (
            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.modelProtocol')}</div>
              <Select
                value={modelProtocol}
                onChange={setModelProtocol}
                options={NEW_API_PROTOCOL_OPTIONS}
                triggerProps={{ getPopupContainer: (node) => node.parentElement || document.body }}
              />
              <div className='text-11px text-t-secondary leading-4'>{t('settings.modelProtocolTip')}</div>
            </div>
          )}

          <div className='space-y-8px'>
            <div className='flex items-center gap-5px text-13px font-500 text-t-secondary'>
              <PreviewOpen theme='outline' size='14' />
              <span>{t('settings.imageInput')}</span>
            </div>
            <Select
              value={imageInput}
              onChange={(value) => setImageInput(value as ModelImageInputChoice)}
              options={[
                { label: t('settings.imageInputAuto'), value: 'auto' },
                { label: t('settings.imageInputSupported'), value: 'supported' },
                { label: t('settings.imageInputUnsupported'), value: 'unsupported' },
              ]}
            />
            <div className='text-11px text-t-secondary leading-4'>{t('settings.imageInputTip')}</div>
          </div>
          {/* Context window — text models only. Carrying a token limit on an
              image/video model would be a stale number after a kind change,
              the same reason the media price fields are gated below. */}
          {modelKind !== 'image' && modelKind !== 'video' && (
            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.contextWindow')}</div>
              <Input
                value={contextWindow}
                onChange={setContextWindow}
                placeholder={t('settings.contextWindowPlaceholder')}
                allowClear
              />
              <div className='text-11px text-t-secondary leading-4'>{t('settings.contextWindowTip')}</div>
            </div>
          )}
          <div className='flex flex-col gap-4px'>
            <div className='flex items-center gap-4px'>
              <span>{t('settings.modelKind')}</span>
            </div>
            <Select
              value={modelKind}
              onChange={(value) => setModelKind(value as ModelKindChoice)}
              options={[
                { label: t('settings.modelKindAuto'), value: 'auto' },
                ...MODEL_KINDS.map((kind) => ({ label: t(`settings.modelKind_${kind}` as never), value: kind })),
              ]}
            />
            <div className='text-11px text-t-secondary leading-4'>{t('settings.modelKindTip')}</div>
            {(modelKind === 'image' || modelKind === 'video') && (
              <>
                {/* Both of these fields used to carry no label at all — the
                    protocol select was bare and the price was identifiable only
                    from its placeholder, which disappears the moment anything is
                    typed. `modelKind` above always had one; these now match it. */}
                <span>{t('settings.mediaEndpointLabel')}</span>
                <Select
                  value={mediaEndpoint || 'auto'}
                  onChange={(value) => setMediaEndpoint(value === 'auto' ? '' : String(value))}
                  options={[
                    { label: t('settings.mediaEndpointAuto'), value: 'auto' },
                    /* Image models can also speak a synchronous non-standard
                       protocol; video ones cannot, so those are not offered
                       there — an unusable choice reads as a supported one. */
                    ...(modelKind === 'image' ? SYNC_IMAGE_ENDPOINT_STYLES : []).map((style) => ({
                      label: ENDPOINT_STYLE_INFO[style] ? t(ENDPOINT_STYLE_INFO[style].labelKey as never) : style,
                      value: style,
                    })),
                    ...IMPLEMENTED_ENDPOINT_STYLES.map((style) => ({
                      label: ENDPOINT_STYLE_INFO[style] ? t(ENDPOINT_STYLE_INFO[style].labelKey as never) : style,
                      value: style,
                    })),
                  ]}
                />
                <div className='text-11px text-t-secondary leading-4'>{t('settings.mediaEndpointTip')}</div>
                {mediaEndpoint && ENDPOINT_STYLE_INFO[mediaEndpoint] && (
                  <div className='text-11px text-t-secondary leading-4'>
                    {t(ENDPOINT_STYLE_INFO[mediaEndpoint].descriptionKey as never)}
                  </div>
                )}
                {/* A guess, never a gate (see useMediaFailureAdvice.ts) — this
                    never blocks saving, it only surfaces early what would
                    otherwise only show up as an opaque failure on the first
                    real (paid) generation call. */}
                {mediaEndpoint && endpointMismatchWarning && (
                  <div className='flex items-center gap-6px text-12px text-warning py-4px'>
                    <div className='flex items-center justify-center w-16px h-16px rounded-4px bg-warning/10 shrink-0'>
                      <span className='text-10px font-medium'>!</span>
                    </div>
                    <span>{endpointMismatchWarning}</span>
                  </div>
                )}
                <span>{t('settings.mediaUnitPriceLabel')}</span>
                <Input
                  value={mediaUnitPrice}
                  onChange={setMediaUnitPrice}
                  placeholder={t('settings.mediaUnitPricePlaceholder')}
                  allowClear
                />
                <div className='text-11px text-t-secondary leading-4'>
                  {modelKind === 'video' ? t('settings.mediaUnitPriceTipVideo') : t('settings.mediaUnitPriceTipImage')}
                </div>
                {/* One field per resolution the model offers.
                    A single rate cannot describe what these actually cost:
                    vendors price tiers several-fold apart, so whichever tier was
                    not the one entered is billed wrong. Optional throughout — a
                    blank tier falls back to the flat rate above, so nothing here
                    has to be filled in. */}
                {priceTiers.length > 0 && (
                  <div className='flex flex-col gap-4px pt-4px' data-testid='media-tier-prices'>
                    <span className='text-12px'>{t('settings.mediaTierPriceLabel')}</span>
                    {priceTiers.map((tier) => (
                      <div key={tier} className='flex items-center gap-8px'>
                        <span className='text-12px text-t-secondary w-64px shrink-0'>{tier}</span>
                        <Input
                          value={tierPrices[tier] ?? ''}
                          onChange={(value) => setTierPrices((prev) => ({ ...prev, [tier]: value }))}
                          placeholder={t('settings.mediaTierPricePlaceholder')}
                          allowClear
                          data-testid={`media-tier-price-${tier}`}
                        />
                      </div>
                    ))}
                    <div className='text-11px text-t-secondary leading-4'>{t('settings.mediaTierPriceTip')}</div>
                  </div>
                )}
                {/* Whether to show cost figures anywhere at all.
                    Deliberately here rather than in a general preferences page:
                    this is the one screen where a user is already thinking about
                    what a generation costs, so it is where they will look for
                    the way to stop being told. Global, not per-model — someone
                    who does not care about price does not care per model, and a
                    default-off per-model flag would have to be flipped on every
                    one of them. Applies immediately: the SWR key both display
                    sites read is revalidated on change. */}
                <div className='flex items-center justify-between gap-8px pt-4px'>
                  <span className='text-12px'>{t('settings.showMediaCostLabel')}</span>
                  <Switch
                    size='small'
                    checked={showMediaCost}
                    onChange={(checked) => {
                      setShowMediaCost(checked);
                      void setClientBusinessSetting('tools.showMediaCost', checked)
                        .then(() => globalMutate(SHOW_MEDIA_COST_SWR_KEY))
                        .catch(() => {
                          // Persisting failed: put the switch back rather than
                          // leaving the UI claiming a preference that was not
                          // stored.
                          setShowMediaCost(!checked);
                        });
                    }}
                  />
                </div>
                <div className='text-11px text-t-secondary leading-4'>{t('settings.showMediaCostTip')}</div>
              </>
            )}
          </div>

          {showOpenAiApiMode && (
            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.openAiApiMode')}</div>
              <Select
                value={openAiApiMode}
                onChange={(value) => setOpenAiApiMode(value as ModelOpenAiApiModeChoice)}
                options={[
                  { label: t('settings.modelSettingAuto'), value: 'auto' },
                  { label: t('settings.openAiApiModeChatCompletions'), value: 'chat_completions' },
                  { label: t('settings.openAiApiModeResponses'), value: 'responses' },
                ]}
              />
              <div className='text-11px text-t-secondary leading-4'>{t('settings.openAiApiModeTip')}</div>
            </div>
          )}

          {!isEditing && models.length > 1 && (
            <div className='text-11px text-t-secondary leading-4'>{t('settings.modelSettingsApplyToSelected')}</div>
          )}
        </div>
      </DreamModal>
    );
  }
);

export default AddModelModal;
