/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { IMAGE_EXTENSIONS } from '@/common/config/constants';
import type { IMcpServer, IProvider, TProviderWithModel } from '@/common/config/storage';
import type { Assistant, MarketplacePersona } from '@/common/types/agent/assistantTypes';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import { DROPDOWN_SEARCH_THRESHOLD } from '@/renderer/components/agent/runtimeSelectorOptions';
import DreamInlineSearchInput from '@/renderer/components/base/DreamInlineSearchInput';
import MobileActionSheet from '@/renderer/components/chat/MobileActionSheet';
import type {
  MobileActionSheetEntry,
  MobileActionSheetOption,
} from '@/renderer/components/chat/MobileActionSheet/types';
import type { AgentModeOption } from '@/renderer/utils/model/agentTypes';
import type { AgentRuntimeDerivedOption } from '@/renderer/utils/model/agentRuntimeCatalog';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getCleanFileNames, FileService } from '@/renderer/services/FileService';
import { resolveAssistantAvatar } from '@/renderer/utils/model/assistantAvatar';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import { iconColors } from '@/renderer/styles/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import type { AcpModelInfo } from '../types';
import { getAvailableModels } from '../utils/modelUtils';
import { Button, Checkbox, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import {
  ArrowUp,
  Brain,
  Close,
  FolderOpen,
  FolderUpload,
  Lightning,
  Paperclip,
  Plus,
  Robot,
  Shield,
  Star,
  UploadOne,
} from '@icon-park/react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GuidExpertPickerGrid from './GuidExpertPickerGrid';
import styles from '../index.module.css';

/**
 * Shared shell for the skills / MCP submenu popups: an optional pinned search
 * box on top and a single scroll container below (`.dropdown-search-scroll`,
 * see arco-override.css), mirroring RuntimeSelectorModelList's layout so the
 * search box never scrolls away with the list.
 */
const SubmenuSearchList: React.FC<{
  showSearch: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  searchTestId: string;
  emptyText: string;
  isEmpty: boolean;
  children: React.ReactNode;
}> = ({ showSearch, query, onQueryChange, placeholder, searchTestId, emptyText, isEmpty, children }) => (
  <>
    {showSearch ? (
      <div className='px-6px pt-4px pb-6px' style={{ background: 'var(--color-bg-popup)' }}>
        <DreamInlineSearchInput
          value={query}
          onChange={onQueryChange}
          placeholder={placeholder}
          data-testid={searchTestId}
          // Stop keydown from bubbling into Arco Menu's own keyboard handling
          // (typeahead / arrow-key nav) — without this, IME composition
          // keystrokes (Chinese/Japanese/Korean input) get intercepted and
          // the whole "+" dropdown closes mid-composition.
          inputProps={{ onKeyDown: (event) => event.stopPropagation() }}
        />
      </div>
    ) : null}
    <div className='dropdown-search-scroll max-h-320px overflow-y-auto'>
      {isEmpty ? <div className='px-12px py-10px text-12px text-t-tertiary text-center'>{emptyText}</div> : children}
    </div>
  </>
);

type GuidActionRowProps = {
  // File handling
  files: string[];
  /** Device uploads (browser input → managed dir): sent as `upload` refs. */
  onFilesUploaded: (paths: string[]) => void;
  /** Backend-machine picker (native dialog / server-fs browse): sent as `local` refs. */
  onFilesPicked: (paths: string[]) => void;

  // Model selector node (rendered by parent for the desktop layout)
  modelSelectorNode: React.ReactNode;
  /** Media-generation mode switch, so the welcome page can start a generation. */
  mediaControlNode?: React.ReactNode;
  /** True while the send box is in an image/video generation mode. */
  mediaActive?: boolean;
  /**
   * True while a generation mode is active: the welcome page has its own "+"
   * rather than the conversation `FileAttachButton`, so the reference-image
   * wording and the images-only picker have to be repeated here.
   */
  referenceOnly?: boolean;

  // Flat model data for the mobile action sheet (desktop uses modelSelectorNode).
  isGeminiMode: boolean;
  modelList: IProvider[];
  current_model?: TProviderWithModel;
  setCurrentModel: (model: TProviderWithModel) => Promise<void>;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  selectedAcpModel: string | null;
  setSelectedAcpModel: (model: string | null) => void;

  // Thought level (mobile action sheet; only present for ACP agents)
  thoughtLevelOption?: AgentRuntimeDerivedOption | null;
  onThoughtLevelSelect?: (value: string) => void;

  // Agent mode
  modeBackend?: string;
  selectedMode: string;
  dynamicModes?: AgentModeOption[];
  onModeSelect: (mode: string) => void;

  // Skills management
  allSkills: Array<{ name: string; description: string; isAuto: boolean }>;
  disabledBuiltinSkills: string[];
  enabledSkills: string[];
  onToggleSkill: (name: string, isAuto: boolean) => void;
  mcpServers: IMcpServer[];
  selectedMcpServerIds: string[];
  onToggleMcpServer: (serverId: string) => void;

  // Expert / persona picker.
  personaAssistants: Assistant[];
  /** Full marketplace catalog — only consulted once the user searches, so
   * an uninstalled expert can still be found and one-click installed. */
  marketplacePersonas: MarketplacePersona[];
  selectedAssistantId?: string | null;
  selectedPersona: Assistant | null;
  localeKey: string;
  onSelectAssistant: (assistantId: string) => void;
  onInstallAndSelectPersona: (assistantId: string) => void;
  onBrowseMoreExperts: () => void;
  onClearPersona: () => void;

  // Send button
  loading: boolean;
  isButtonDisabled: boolean;
  speechInputNode?: React.ReactNode;
  onSend: () => void;
};

const GuidActionRow: React.FC<GuidActionRowProps> = ({
  files,
  onFilesPicked,
  onFilesUploaded,
  modelSelectorNode,
  mediaControlNode,
  mediaActive = false,
  referenceOnly = false,
  isGeminiMode,
  modelList,
  current_model,
  setCurrentModel,
  currentAcpCachedModelInfo,
  selectedAcpModel,
  setSelectedAcpModel,
  thoughtLevelOption,
  onThoughtLevelSelect,
  modeBackend,
  selectedMode,
  dynamicModes = [],
  onModeSelect,
  allSkills,
  disabledBuiltinSkills,
  enabledSkills,
  onToggleSkill,
  mcpServers,
  selectedMcpServerIds,
  onToggleMcpServer,
  personaAssistants,
  marketplacePersonas,
  selectedAssistantId,
  selectedPersona,
  localeKey,
  onSelectAssistant,
  onInstallAndSelectPersona,
  onBrowseMoreExperts,
  onClearPersona,
  loading,
  isButtonDisabled,
  speechInputNode,
  onSend,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [mcpQuery, setMcpQuery] = useState('');
  const [isSkillSubmenuOpen, setIsSkillSubmenuOpen] = useState(false);
  const [isMcpSubmenuOpen, setIsMcpSubmenuOpen] = useState(false);
  const [isExpertSubmenuOpen, setIsExpertSubmenuOpen] = useState(false);

  // Arco's hover-trigger popups (the outer "+" Dropdown, and each
  // Menu.SubMenu nested inside it) treat certain signals — mouse leaving
  // the trigger, a transient blur — as "close now". IME composition,
  // especially in Electron where the OS candidate window can momentarily
  // perturb focus, was tripping this while the user was still actively
  // typing in one of the nested search boxes: the *SubMenu* (not the outer
  // dropdown) would snap shut mid-keystroke, dropping back to the plain
  // "+" list and reading as "the whole thing closed".
  //
  // `isComposingRef` is the authoritative signal — set for the whole
  // duration of an IME composition (compositionstart..compositionend),
  // listened for at the root of this component so it fires regardless of
  // which nested search box is active (composition events bubble through
  // the React tree even though the popup itself renders via a portal).
  // A plain focus check was tried first but is racy: the OS candidate
  // window can cause a transient blur before focus returns to the input,
  // and by the time the visibility callback runs `activeElement` may have
  // already moved on — composition state has no such gap.
  const isComposingRef = useRef(false);

  const ignoreCloseWhileSearchFocused = useCallback((visible: boolean) => {
    if (visible) return false;
    if (isComposingRef.current) return true;
    const activeTestId = document.activeElement?.getAttribute('data-testid');
    return !!activeTestId && ['guid-skill-search', 'guid-mcp-search', 'guid-expert-search'].includes(activeTestId);
  }, []);

  const handlePlusDropdownVisibleChange = useCallback(
    (visible: boolean) => {
      if (ignoreCloseWhileSearchFocused(visible)) return;
      setIsPlusDropdownOpen(visible);
      // Reopening the "+" menu should always show the full lists again.
      if (!visible) {
        setSkillQuery('');
        setMcpQuery('');
        setIsSkillSubmenuOpen(false);
        setIsMcpSubmenuOpen(false);
        setIsExpertSubmenuOpen(false);
      }
    },
    [ignoreCloseWhileSearchFocused]
  );

  const handleSkillSubmenuVisibleChange = useCallback(
    (visible: boolean) => {
      if (ignoreCloseWhileSearchFocused(visible)) return;
      setIsSkillSubmenuOpen(visible);
    },
    [ignoreCloseWhileSearchFocused]
  );

  const handleMcpSubmenuVisibleChange = useCallback(
    (visible: boolean) => {
      if (ignoreCloseWhileSearchFocused(visible)) return;
      setIsMcpSubmenuOpen(visible);
    },
    [ignoreCloseWhileSearchFocused]
  );

  const handleExpertSubmenuVisibleChange = useCallback(
    (visible: boolean) => {
      if (ignoreCloseWhileSearchFocused(visible)) return;
      setIsExpertSubmenuOpen(visible);
    },
    [ignoreCloseWhileSearchFocused]
  );
  const showModeSwitch = dynamicModes.length > 0;

  // The chat model selector is hidden while a generation mode is on. That send
  // does not use the chat model — the job runs on the media model named in the
  // parameter pill — so showing both put two disagreeing answers to "which
  // model runs my next Enter" side by side, which is exactly what folding media
  // models into a single picker was meant to end. It also un-crowds the row:
  // media mode adds a mode pill, a parameter pill, the price and an exit
  // button, and the overflow was rendering on top of the selector.
  const showModelSelector = !!modelSelectorNode && !mediaActive;
  const configOptionCount = (showModelSelector ? 1 : 0) + (showModeSwitch ? 1 : 0);

  // Browser file picker ref (WebUI only)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setUploading(true);
      try {
        const processed = await FileService.processDroppedFiles(fileList);
        if (processed.length > 0) {
          onFilesUploaded(processed.map((f) => f.path));
        }
      } catch {
        Message.error(t('common.fileAttach.failed'));
      } finally {
        setUploading(false);
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [onFilesUploaded, t]
  );

  const getModeDisplayLabel = (mode: AgentModeOption): string =>
    t(`agentMode.${mode.value}`, { defaultValue: mode.label });

  const isWebUI = !isElectronDesktop();

  const isSkillChecked = (skill: { name: string; isAuto: boolean }) =>
    skill.isAuto ? !disabledBuiltinSkills.includes(skill.name) : enabledSkills.includes(skill.name);

  const activeSkillCount = allSkills.filter(isSkillChecked).length;
  const activeMcpCount = selectedMcpServerIds.length;

  const skillKeyword = skillQuery.trim().toLowerCase();
  const filteredSkills = skillKeyword
    ? allSkills.filter((skill) => skill.name.toLowerCase().includes(skillKeyword))
    : allSkills;
  const mcpKeyword = mcpQuery.trim().toLowerCase();
  const filteredMcpServers = mcpKeyword
    ? mcpServers.filter((server) => server.name.toLowerCase().includes(mcpKeyword))
    : mcpServers;
  const showSkillSearch = allSkills.length > DROPDOWN_SEARCH_THRESHOLD;
  const showMcpSearch = mcpServers.length > DROPDOWN_SEARCH_THRESHOLD;

  const openHostFilePicker = useCallback(() => {
    ipcBridge.dialog.showOpen
      .invoke({
        properties: ['openFile', 'multiSelections'],
        // Otherwise the dialog opens on "All Files (*.*)" and a PDF looks like
        // a valid choice for a reference image.
        ...(referenceOnly
          ? { filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS.map((ext) => ext.replace(/^\./, '')) }] }
          : {}),
      })
      .then((pickedFiles) => {
        if (pickedFiles && pickedFiles.length > 0) onFilesPicked(pickedFiles);
      })
      .catch((error) => console.error('Failed to open file dialog:', error));
  }, [onFilesPicked, referenceOnly]);

  // Build the mobile action sheet entries: model / thought level / permission
  // (single-select), attach (action), skills / MCP (multi-select checkboxes).
  const sheetEntries = useMemo<MobileActionSheetEntry[]>(() => {
    if (!isMobile) return [];
    const entries: MobileActionSheetEntry[] = [];

    // Model — dream is provider-grouped, ACP is a flat cached list.
    let modelOptions: MobileActionSheetOption[] = [];
    let currentModelLabel = '';
    let onModelSelect: (key: string) => void = () => {};
    if (isGeminiMode) {
      const enabled = modelList.filter((p) => p.enabled !== false);
      modelOptions = enabled.flatMap((provider) =>
        getAvailableModels(provider).map((modelName) => ({
          key: `${provider.id}::${modelName}`,
          label: modelName,
          description: provider.name,
          active: current_model?.id === provider.id && current_model?.use_model === modelName,
        }))
      );
      currentModelLabel = current_model?.use_model || '';
      onModelSelect = (key) => {
        const [providerId, modelName] = key.split('::');
        const provider = enabled.find((p) => p.id === providerId);
        if (provider) void setCurrentModel({ ...provider, use_model: modelName } as TProviderWithModel);
      };
    } else {
      const available = currentAcpCachedModelInfo?.available_models ?? [];
      modelOptions = available.map((model) => ({
        key: model.id,
        label: model.label || model.id,
        description: model.description,
        active: model.id === selectedAcpModel,
      }));
      currentModelLabel =
        available.find((m) => m.id === selectedAcpModel)?.label || currentAcpCachedModelInfo?.current_model_label || '';
      onModelSelect = (key) => setSelectedAcpModel(key);
    }
    if (modelOptions.length > 0) {
      entries.push({
        key: 'model',
        icon: <Brain theme='outline' size='16' />,
        label: t('common.model', { defaultValue: 'Model' }),
        meta: currentModelLabel,
        submenu: {
          title: t('common.model', { defaultValue: 'Model' }),
          options: modelOptions,
          onSelect: onModelSelect,
        },
      });
    }

    // Thought level (ACP agents only).
    if (thoughtLevelOption && thoughtLevelOption.options.length > 0 && onThoughtLevelSelect) {
      const currentValue = thoughtLevelOption.currentValue;
      entries.push({
        key: 'thought-level',
        icon: <Brain theme='outline' size='16' />,
        label: t('agent.thoughtLevel.label'),
        meta: thoughtLevelOption.options.find((o) => o.value === currentValue)?.label || currentValue || '',
        submenu: {
          title: t('agent.thoughtLevel.label'),
          options: thoughtLevelOption.options.map((o) => ({
            key: o.value,
            label: o.label,
            description: o.description ?? undefined,
            active: o.value === currentValue,
          })),
          onSelect: (value) => onThoughtLevelSelect(value),
        },
      });
    }

    // Permission / agent mode.
    if (dynamicModes.length > 0) {
      const modeOptions: MobileActionSheetOption[] = dynamicModes.map((mode) => ({
        key: mode.value,
        label: t(`agentMode.${mode.value}`, { defaultValue: mode.label }),
        description: mode.description,
        active: mode.value === selectedMode,
      }));
      entries.push({
        key: 'permission',
        icon: <Shield theme='outline' size='16' />,
        label: t('agentMode.permission', { defaultValue: 'Permission' }),
        meta: modeOptions.find((o) => o.active)?.label,
        submenu: {
          title: t('agentMode.permission', { defaultValue: 'Permission' }),
          options: modeOptions,
          onSelect: onModeSelect,
        },
      });
    }

    // Match the conversation send box: WebUI offers both the backend-machine
    // picker and an upload from the phone/current browser device.
    const attachFilesLabel = referenceOnly
      ? t('common.fileAttach.addReferenceImage', { defaultValue: 'Add reference image' })
      : t('common.fileAttach.addFiles', { defaultValue: 'Add files' });
    if (isWebUI) {
      entries.push(
        {
          key: 'attach-host-files',
          icon: <Paperclip theme='outline' size='16' />,
          label: attachFilesLabel,
          variant: 'muted',
          dividerBefore: true,
          onClick: openHostFilePicker,
        },
        {
          key: 'attach-my-device',
          icon: <FolderOpen theme='outline' size='16' />,
          label: t('common.fileAttach.myDevice', { defaultValue: 'Upload from device' }),
          variant: 'muted',
          onClick: () => fileInputRef.current?.click(),
        }
      );
    } else {
      entries.push({
        key: 'attach',
        icon: <FolderUpload theme='outline' size='16' />,
        label: attachFilesLabel,
        variant: 'muted',
        dividerBefore: true,
        onClick: openHostFilePicker,
      });
    }

    // Skills (multi-select).
    if (allSkills.length > 0) {
      entries.push({
        key: 'skills',
        icon: <Lightning theme='outline' size='16' />,
        label: t('settings.capabilitiesTab.skills'),
        variant: 'muted',
        meta:
          activeSkillCount > 0
            ? t('common.selectedCount', { count: activeSkillCount, defaultValue: `Selected ${activeSkillCount}` })
            : undefined,
        submenu: {
          title: t('settings.capabilitiesTab.skills'),
          multiSelect: true,
          options: allSkills.map((skill) => ({
            key: skill.name,
            label: skill.name,
            description: skill.description || undefined,
            active: isSkillChecked(skill),
          })),
          onSelect: (name) => {
            const skill = allSkills.find((s) => s.name === name);
            if (skill) onToggleSkill(skill.name, skill.isAuto);
          },
        },
      });
    }

    // MCP servers (multi-select).
    if (mcpServers.length > 0) {
      entries.push({
        key: 'mcp',
        icon: <Shield theme='outline' size='16' />,
        label: t('mcp.label'),
        variant: 'muted',
        meta:
          activeMcpCount > 0
            ? t('common.selectedCount', { count: activeMcpCount, defaultValue: `Selected ${activeMcpCount}` })
            : undefined,
        submenu: {
          title: t('mcp.label'),
          multiSelect: true,
          options: mcpServers.map((server) => ({
            key: server.id,
            label: server.name,
            description: server.tools?.length ? `${server.tools.length} ${t('mcp.tools')}` : undefined,
            active: selectedMcpServerIds.includes(server.id),
          })),
          onSelect: (id) => onToggleMcpServer(id),
        },
      });
    }

    return entries;
  }, [
    isMobile,
    isGeminiMode,
    modelList,
    current_model,
    setCurrentModel,
    currentAcpCachedModelInfo,
    selectedAcpModel,
    setSelectedAcpModel,
    thoughtLevelOption,
    onThoughtLevelSelect,
    dynamicModes,
    selectedMode,
    onModeSelect,
    allSkills,
    disabledBuiltinSkills,
    enabledSkills,
    onToggleSkill,
    mcpServers,
    selectedMcpServerIds,
    onToggleMcpServer,
    activeSkillCount,
    activeMcpCount,
    isWebUI,
    openHostFilePicker,
    t,
  ]);

  const menuContent = (
    <Menu
      className='min-w-200px'
      onClickMenuItem={(key) => {
        if (key === 'file') {
          ipcBridge.dialog.showOpen
            .invoke({ properties: ['openFile', 'multiSelections'] })
            .then((pickedFiles) => {
              if (pickedFiles && pickedFiles.length > 0) {
                onFilesPicked(pickedFiles);
              }
            })
            .catch((error) => {
              console.error('Failed to open file dialog:', error);
            });
        } else if (key === 'device') {
          fileInputRef.current?.click();
        }
      }}
    >
      {isWebUI ? (
        <>
          <Menu.Item key='file'>
            <div className='flex items-center gap-8px'>
              <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span>{t('common.fileAttach.addFiles')}</span>
            </div>
          </Menu.Item>
          <Menu.Item key='device'>
            <div className='flex items-center gap-8px'>
              <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span>{t('common.fileAttach.myDevice')}</span>
            </div>
          </Menu.Item>
        </>
      ) : (
        <Menu.Item key='file'>
          <div className='flex items-center gap-8px'>
            <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
            <span>{t('common.fileAttach.addFiles')}</span>
          </div>
        </Menu.Item>
      )}
      {personaAssistants.length > 0 && (
        <Menu.SubMenu
          key='experts'
          title={
            <div className='flex items-center gap-8px'>
              <Star theme='filled' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>{t('settings.assistantTabMarketplace', { defaultValue: 'Experts' })}</span>
            </div>
          }
          triggerProps={{
            popupStyle: { overflowX: 'hidden' },
            popupVisible: isExpertSubmenuOpen,
            onVisibleChange: handleExpertSubmenuVisibleChange,
          }}
        >
          <GuidExpertPickerGrid
            assistants={personaAssistants}
            marketplacePersonas={marketplacePersonas}
            selectedAssistantId={selectedAssistantId}
            localeKey={localeKey}
            onSelect={(assistantId) => {
              onSelectAssistant(assistantId);
              setIsExpertSubmenuOpen(false);
              setIsPlusDropdownOpen(false);
            }}
            onInstallAndSelect={(assistantId) => {
              onInstallAndSelectPersona(assistantId);
              setIsExpertSubmenuOpen(false);
              setIsPlusDropdownOpen(false);
            }}
            onBrowseMore={() => {
              setIsExpertSubmenuOpen(false);
              setIsPlusDropdownOpen(false);
              onBrowseMoreExperts();
            }}
          />
        </Menu.SubMenu>
      )}
      {allSkills.length > 0 && (
        <Menu.SubMenu
          key='skills'
          title={
            <div className='flex items-center gap-8px'>
              <Lightning theme='filled' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>
                {t('settings.capabilitiesTab.skills')} ({activeSkillCount}/{allSkills.length})
              </span>
            </div>
          }
          triggerProps={{
            popupStyle: { overflowX: 'hidden' },
            popupVisible: isSkillSubmenuOpen,
            onVisibleChange: handleSkillSubmenuVisibleChange,
          }}
        >
          <SubmenuSearchList
            showSearch={showSkillSearch}
            query={skillQuery}
            onQueryChange={setSkillQuery}
            placeholder={t('settings.skillsHub.searchPlaceholder', { defaultValue: 'Search skills...' })}
            searchTestId='guid-skill-search'
            emptyText={t('settings.skillsHub.noSearchResults', { defaultValue: 'No matching skills.' })}
            isEmpty={filteredSkills.length === 0}
          >
            {filteredSkills.map((skill) => (
              <Menu.Item
                key={`skill-${skill.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSkill(skill.name, skill.isAuto);
                }}
              >
                <Checkbox
                  checked={isSkillChecked(skill)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  onChange={() => onToggleSkill(skill.name, skill.isAuto)}
                >
                  <span className='text-13px'>{skill.name}</span>
                </Checkbox>
              </Menu.Item>
            ))}
          </SubmenuSearchList>
        </Menu.SubMenu>
      )}
      {mcpServers.length > 0 && (
        <Menu.SubMenu
          key='mcp'
          title={
            <div className='flex items-center gap-8px'>
              <Shield theme='outline' size='16' fill={iconColors.primary} style={{ lineHeight: 0 }} />
              <span>
                {t('mcp.label')} ({activeMcpCount}/{mcpServers.length})
              </span>
            </div>
          }
          triggerProps={{
            popupStyle: { overflowX: 'hidden' },
            popupVisible: isMcpSubmenuOpen,
            onVisibleChange: handleMcpSubmenuVisibleChange,
          }}
        >
          <SubmenuSearchList
            showSearch={showMcpSearch}
            query={mcpQuery}
            onQueryChange={setMcpQuery}
            placeholder={t('mcp.searchServers', { defaultValue: 'Search servers...' })}
            searchTestId='guid-mcp-search'
            emptyText={t('mcp.noServersFound', { defaultValue: 'No servers found matching your criteria' })}
            isEmpty={filteredMcpServers.length === 0}
          >
            {filteredMcpServers.map((server) => (
              <Menu.Item
                key={`mcp-${server.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMcpServer(server.id);
                }}
              >
                <Checkbox
                  checked={selectedMcpServerIds.includes(server.id)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  onChange={() => onToggleMcpServer(server.id)}
                >
                  <span className='text-13px'>
                    {server.name}
                    {server.tools?.length ? ` (${server.tools.length} ${t('mcp.tools')})` : ''}
                  </span>
                </Checkbox>
              </Menu.Item>
            ))}
          </SubmenuSearchList>
        </Menu.SubMenu>
      )}
    </Menu>
  );

  return (
    <div
      className={styles.actionRow}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
      }}
    >
      <div className={styles.actionTools}>
        <div className={styles.actionEntry}>
          {isMobile ? (
            // Mobile: the "+" opens the bottom action sheet holding every control.
            <span className='flex items-center gap-4px lh-[1]'>
              <Button
                type='secondary'
                shape='circle'
                icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />}
                loading={uploading}
                disabled={uploading}
                data-testid='file-upload-btn'
                onClick={() => setIsSheetOpen(true)}
              />
              {files.length > 0 && (
                <Tooltip
                  className={'!max-w-max'}
                  content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}
                >
                  <span className='text-t-primary'>File({files.length})</span>
                </Tooltip>
              )}
            </span>
          ) : (
            <Dropdown
              trigger='hover'
              popupVisible={isPlusDropdownOpen}
              onVisibleChange={handlePlusDropdownVisibleChange}
              droplist={menuContent}
            >
              <span className='flex items-center gap-4px cursor-pointer lh-[1]'>
                <Button
                  type='secondary'
                  shape='circle'
                  className={isPlusDropdownOpen ? styles.plusButtonRotate : styles.plusButtonPulse}
                  icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />}
                  loading={uploading}
                  disabled={uploading}
                  data-testid='file-upload-btn'
                />
                {files.length > 0 && (
                  <Tooltip
                    className={'!max-w-max'}
                    content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}
                  >
                    <span className='text-t-primary'>File({files.length})</span>
                  </Tooltip>
                )}
              </span>
            </Dropdown>
          )}
          {isWebUI && (
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept={referenceOnly ? 'image/*' : undefined}
              style={{ display: 'none' }}
              onChange={handleLocalFileChange}
            />
          )}
        </div>
        {mediaControlNode}
        {selectedPersona && (
          <div
            className='inline-flex min-w-0 shrink items-center gap-4px rounded-999px py-4px pl-4px pr-6px'
            style={{ background: 'var(--color-fill-2)' }}
            data-testid='guid-selected-persona-chip'
          >
            <span className='inline-flex h-18px w-18px shrink-0 items-center justify-center overflow-hidden rounded-999px bg-fill-3'>
              {(() => {
                const avatar = resolveAssistantAvatar(selectedPersona.avatar);
                if (avatar.kind === 'image')
                  return <img src={avatar.value} alt='' className='h-full w-full object-cover' />;
                if (avatar.kind === 'emoji') return <span style={{ fontSize: 10 }}>{avatar.value}</span>;
                return <Robot theme='outline' size={10} />;
              })()}
            </span>
            <span className='max-w-100px truncate text-12px text-t-primary'>
              {resolveAssistantName(selectedPersona, localeKey)}
            </span>
            <span
              className='inline-flex h-14px w-14px shrink-0 cursor-pointer items-center justify-center rounded-999px hover:bg-fill-3'
              data-testid='guid-clear-persona'
              onClick={onClearPersona}
            >
              <Close theme='outline' size={10} fill={iconColors.secondary} />
            </span>
          </div>
        )}
      </div>
      {isMobile && (
        <MobileActionSheet
          open={isSheetOpen}
          onClose={() => setIsSheetOpen(false)}
          title={t('common.more')}
          entries={sheetEntries}
        />
      )}
      <div className={styles.actionSubmit}>
        {/* Desktop keeps the inline model/permission selectors; on mobile they move into the sheet. */}
        {!isMobile && configOptionCount > 0 && (
          <div className={styles.actionConfigGroup} data-mobile={isMobile ? 'true' : undefined}>
            {showModelSelector && modelSelectorNode}

            {showModeSwitch && (
              <AgentModeSelector
                backend={modeBackend}
                compact
                initialMode={selectedMode}
                onModeSelect={onModeSelect}
                dynamicModes={dynamicModes}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={getModeDisplayLabel}
              />
            )}
          </div>
        )}

        {speechInputNode}
        <Button
          shape='circle'
          type='primary'
          loading={loading}
          disabled={isButtonDisabled}
          className='send-button-custom'
          style={{
            backgroundColor: isButtonDisabled ? undefined : '#000000',
            borderColor: isButtonDisabled ? undefined : '#000000',
          }}
          icon={<ArrowUp theme='filled' size='14' fill='white' strokeWidth={5} />}
          onClick={onSend}
          data-testid='guid-send-btn'
        />
      </div>
    </div>
  );
};

export default GuidActionRow;
