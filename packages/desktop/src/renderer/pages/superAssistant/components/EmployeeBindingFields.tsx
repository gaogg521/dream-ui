/**
 * Expert / backend / model form fields for a digital employee.
 *
 * Shared by CreateAgentModal and ManageAgentModal so creating and editing an
 * employee offer the same choices. The layout mirrors the scheduled-task dialog
 * (`pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx`): the expert is the
 * primary choice, the backend follows it unless overridden, and the model
 * selector only appears for backends that need one — which is what stops the
 * old "pick an agent type and hope it has a model" confusion.
 *
 * The picker components are borrowed from the team member flow; they are
 * generic (their props carry nothing team-specific) and already support the
 * marketplace merge + install-on-select behaviour we want here.
 */

import React, { useMemo, useState } from 'react';
import { Button, Form, Message, Select } from '@arco-design/web-react';
import { Down, Robot } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { resolveLocaleKey } from '@/common/utils';
import { isAionrsAssistant } from '@/common/types/agent/assistantTypes';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import GuidModelSelector from '@renderer/pages/guid/components/GuidModelSelector';
import TeamAssistantPickerDropdown from '@renderer/pages/team/components/memberPicker/TeamAssistantPickerDropdown';
import {
  assistantToOption,
  marketplacePersonaToOption,
  type TeamAssistantOption,
} from '@renderer/pages/team/components/assistantSelectUtils';
import { NO_EXPERT_ID, type UseEmployeeAgentBindingResult } from '../hooks/useEmployeeAgentBinding';

type EmployeeBindingFieldsProps = {
  binding: UseEmployeeAgentBindingResult;
};

const EmployeeBindingFields: React.FC<EmployeeBindingFieldsProps> = ({ binding }) => {
  const { t, i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n?.language ?? 'en-US');
  const [pickerVisible, setPickerVisible] = useState(false);

  const {
    assistants,
    marketplacePersonas,
    selectedAssistant,
    selectAssistant,
    installAndSelectAssistant,
    installingAssistantId,
    backendOptions,
    selectedBackendAgentId,
    setBackendAgentId,
    hasAionrsProvider,
    showModelSelector,
    modelSelectorProps,
  } = binding;

  const assistantOptions = useMemo<TeamAssistantOption[]>(() => {
    const noExpert: TeamAssistantOption = {
      id: NO_EXPERT_ID,
      name: t('common.superAssistant.noExpertOption', { defaultValue: '不指定专家（仅用运行后端）' }),
      installed: true,
    };

    const installed = assistants.map((assistant) => {
      const option = assistantToOption(assistant, localeKey);
      // Official templates ship disabled; treat "not enabled yet" the same as
      // "not installed yet" so both are adopted by the one click.
      if (assistant.enabled === false) {
        option.installed = false;
      }
      // An aionrs expert cannot run without a model provider — block the row
      // with an explanation instead of letting the run fail later.
      if (isAionrsAssistant(assistant) && !hasAionrsProvider) {
        return {
          ...option,
          team_selectable: false,
          team_block_reason: t('common.superAssistant.aionrsProviderRequired', {
            defaultValue: '需要先在「设置 - 模型」中配置一个模型服务商',
          }),
        };
      }
      return option;
    });

    // Show the whole marketplace catalogue up front rather than only on search:
    // the expert library IS the point of this field, and a user browsing for an
    // expert should not have to guess a keyword first.
    const knownIds = new Set(installed.map((option) => option.id));
    const fromMarketplace = marketplacePersonas
      .filter((persona) => !knownIds.has(persona.id))
      .map(marketplacePersonaToOption);

    return [noExpert, ...installed, ...fromMarketplace];
  }, [assistants, marketplacePersonas, localeKey, hasAionrsProvider, t]);

  const handleSelect = (option: TeamAssistantOption) => {
    selectAssistant(option.id);
    setPickerVisible(false);
  };

  const handleInstallAndSelect = (assistantId: string) => {
    void installAndSelectAssistant(assistantId)
      .then(() => setPickerVisible(false))
      .catch((error) => {
        // The Guid page's equivalent only console.logs here, which silently
        // swallows install failures — surface it instead.
        Message.error(
          t('common.superAssistant.expertInstallFailed', { defaultValue: '添加专家失败' }) + ': ' + String(error)
        );
      });
  };

  const selectedAvatar = resolveAssistantAvatar(selectedAssistant?.avatar);

  return (
    <>
      <Form.Item label={t('common.superAssistant.fieldExpert', { defaultValue: '专家' })}>
        <TeamAssistantPickerDropdown
          assistants={assistantOptions}
          onSelect={handleSelect}
          visible={pickerVisible}
          onVisibleChange={setPickerVisible}
          pendingAssistantId={installingAssistantId}
          testIdPrefix='employee-expert-picker'
          panelTestId='employee-expert-picker-panel'
          title={t('common.superAssistant.pickExpertTitle', { defaultValue: '选择专家' })}
          subtitle={t('common.superAssistant.pickExpertHint', {
            defaultValue: '官方助手与专家市场都在这里，未添加的点一下会自动添加并选中',
          })}
          // The catalogue is already merged into `assistantOptions` so it shows
          // without searching; passing it again here would double-merge.
          onInstallAndSelect={handleInstallAndSelect}
        >
          <Button long className='!h-32px !justify-between !px-12px' data-testid='employee-expert-trigger'>
            <span className='flex min-w-0 items-center gap-8px'>
              {selectedAssistant ? (
                <>
                  <span className='inline-flex h-18px w-18px shrink-0 items-center justify-center overflow-hidden rounded-999px bg-fill-3'>
                    {selectedAvatar.kind === 'image' ? (
                      <img src={selectedAvatar.value} alt='' className='h-full w-full object-cover' />
                    ) : selectedAvatar.kind === 'emoji' ? (
                      <span style={{ fontSize: 10 }}>{selectedAvatar.value}</span>
                    ) : (
                      <Robot theme='outline' size={10} />
                    )}
                  </span>
                  <span className='truncate'>{selectedAssistant.name}</span>
                </>
              ) : (
                <span className='text-t-tertiary'>
                  {t('common.superAssistant.noExpertOption', { defaultValue: '不指定专家（仅用运行后端）' })}
                </span>
              )}
            </span>
            <Down theme='outline' size={12} />
          </Button>
        </TeamAssistantPickerDropdown>
      </Form.Item>

      <Form.Item
        label={t('common.superAssistant.fieldBackend', { defaultValue: '运行后端' })}
        extra={t('common.superAssistant.fieldBackendHint', {
          defaultValue: '默认跟随所选专家，可手动改为其他已安装的后端；不指定专家时由这里决定',
        })}
      >
        <Select
          value={selectedBackendAgentId}
          onChange={setBackendAgentId}
          placeholder={t('common.superAssistant.fieldBackendPlaceholder', { defaultValue: '请选择运行后端' })}
          data-testid='employee-backend-select'
          options={backendOptions.map((option) => ({ label: option.label, value: option.id }))}
        />
      </Form.Item>

      {showModelSelector ? (
        <Form.Item label={t('common.superAssistant.fieldModel', { defaultValue: '模型' })}>
          <div data-testid='employee-model-selector'>
            <GuidModelSelector {...modelSelectorProps} />
          </div>
        </Form.Item>
      ) : null}
    </>
  );
};

export default EmployeeBindingFields;
