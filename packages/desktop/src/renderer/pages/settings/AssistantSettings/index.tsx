/**
 * AssistantSettings — Settings page for managing assistants.
 *
 * Editing permissions by assistant type:
 *
 * | Field          | Builtin | Custom |
 * |----------------|---------|--------|
 * | Save button    |  yes    |  yes   |
 * | Name           |  no     |  yes   |
 * | Description    |  no     |  yes   |
 * | Avatar         |  no     |  yes   |
 * | Main Agent     |  yes    |  yes   |
 * | Prompt editing |  no     |  yes   |
 * | Delete         |  no     |  yes   |
 *
 * Builtin assistants only allow Main Agent plus default model / permission
 * overrides. The full-page editor still renders builtin skills and prompts as
 * read-only so users can inspect what's bundled.
 */
import { Message } from '@arco-design/web-react';
import { useAssistantEditor, useAssistantList, useMarketplacePersonas } from '@/renderer/hooks/assistant';
import { useManagedAgentRuntimeCatalog } from '@/renderer/hooks/agent/useManagedAgents';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import { buildAssistantEditorBackends, resolveAvatarImageSrc } from './assistantUtils';
import AssistantEditorPage from './AssistantEditorPage';
import AssistantHomeTabs from './home/AssistantHomeTabs';
import DeleteAssistantModal from './DeleteAssistantModal';
import PersonaImportModal from './PersonaImportModal';
import SkillConfirmModals from './SkillConfirmModals';
import type { AssistantEditorViewModel, AssistantListItem } from './types';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { refreshManagedAgentCatalogAndAssistants } from '@/renderer/hooks/agent/useManagedAgents';
import '@/renderer/pages/settings/components/settings.css';

type AssistantNavigationState = {
  openAssistantId?: string;
  openAssistantEditor?: boolean;
  initialTab?: 'enabled' | 'mine' | 'official' | 'marketplace';
};
const OPEN_ASSISTANT_EDITOR_INTENT_KEY = 'guid.openAssistantEditorIntent';

const AssistantSettings: React.FC = () => {
  const [message, messageContext] = Message.useMessage({ maxCount: 10 });
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = (location.state as AssistantNavigationState | null) ?? null;

  // Which home tab to show when returning from the editor. Upstream's unified
  // Enabled tab is the default entry point (it owns assistant ordering), but a
  // caller can still request a specific starting tab — editing an official
  // assistant lands back on Official, and the Guid page's "+" expert picker
  // jumps straight to the fork-only marketplace tab.
  const [homeTab, setHomeTab] = React.useState<'enabled' | 'mine' | 'official' | 'marketplace'>(
    navigationState?.initialTab ?? 'enabled'
  );
  const [importModalVisible, setImportModalVisible] = React.useState(false);
  const {
    personas: marketplacePersonas,
    loading: marketplaceLoading,
    install: installMarketplacePersona,
  } = useMarketplacePersonas();

  // "Chat" on an assistant → open a new conversation with it preselected.
  const handleStartChat = useCallback(
    (assistant: AssistantListItem) => {
      navigate('/guid', { state: { selectedAssistantId: assistant.id } });
    },
    [navigate]
  );

  // Installing a marketplace persona materializes it as a real assistant with
  // the same id, so this can navigate exactly like handleStartChat.
  const handleStartMarketplaceChat = useCallback(
    (assistantId: string) => {
      navigate('/guid', { state: { selectedAssistantId: assistantId } });
    },
    [navigate]
  );

  // Compose hooks
  const {
    assistants,
    activeAssistantId,
    setActiveAssistantId,
    activeAssistant,
    loadAssistants,
    reorderEnabledAssistants,
    assistantOrder,
    setAssistantOrder,
    localeKey,
    loading: assistantsLoading,
  } = useAssistantList();

  const handleInstallMarketplacePersona = useCallback(
    async (id: string) => {
      await installMarketplacePersona(id);
      await loadAssistants();
    },
    [installMarketplacePersona, loadAssistants]
  );

  const managedAgentRuntimeCatalog = useManagedAgentRuntimeCatalog();
  const agentCatalogPrimedRef = useRef(false);

  useEffect(() => {
    if (agentCatalogPrimedRef.current) return;
    agentCatalogPrimedRef.current = true;
    // This helper already invalidates and refreshes the shared assistants SWR
    // key. Calling loadAssistants again caused a duplicate full-list request on
    // every first visit to the Assistants page.
    void refreshManagedAgentCatalogAndAssistants();
  }, []);

  const builtinAvatarOptions = useMemo(
    () =>
      assistants
        .filter((assistant) => assistant.source === 'builtin' && assistant.avatar?.startsWith('/api/assistants/'))
        .map((assistant) => {
          const src = resolveAvatarImageSrc(assistant.avatar);
          if (!src) {
            return null;
          }

          return {
            id: assistant.id,
            label: resolveAssistantName(assistant, localeKey),
            src,
          };
        })
        .filter((option): option is NonNullable<typeof option> => option !== null),
    [assistants, localeKey]
  );
  const editor = useAssistantEditor({
    localeKey,
    activeAssistant,
    setActiveAssistantId,
    loadAssistants,
    assistants,
    assistantOrder,
    setAssistantOrder,
    message,
  });
  const availableBackends = useMemo(
    () => buildAssistantEditorBackends(managedAgentRuntimeCatalog, localeKey, editor.editAgent),
    [editor.editAgent, localeKey, managedAgentRuntimeCatalog]
  );

  const editAvatarImage = editor.editAvatarPreview || resolveAvatarImageSrc(editor.editAvatar);
  const hasConsumedNavigationIntentRef = useRef(false);
  const showEditor = editor.editVisible && (editor.isCreating || activeAssistantId !== null);
  const editorViewModel: AssistantEditorViewModel = {
    isCreating: editor.isCreating,
    profile: {
      name: editor.editName,
      setName: editor.setEditName,
      description: editor.editDescription,
      setDescription: editor.setEditDescription,
      avatar: editor.editAvatar,
      setAvatar: editor.setEditAvatar,
      setAvatarPreview: editor.setEditAvatarPreview,
      avatarImage: editAvatarImage,
      builtinAvatarOptions,
    },
    agent: {
      value: editor.editAgent,
      setValue: editor.setEditAgent,
      availableBackends,
    },
    prompts: {
      text: editor.editRecommendedPromptsText,
      setText: editor.setEditRecommendedPromptsText,
    },
    defaults: {
      model: {
        mode: editor.defaultModelMode,
        setMode: editor.setDefaultModelMode,
        value: editor.defaultModelValue,
        setValue: editor.setDefaultModelValue,
      },
      permission: {
        mode: editor.defaultPermissionMode,
        setMode: editor.setDefaultPermissionMode,
        value: editor.defaultPermissionValue,
        setValue: editor.setDefaultPermissionValue,
      },
      thoughtLevel: {
        mode: editor.defaultThoughtLevelMode,
        setMode: editor.setDefaultThoughtLevelMode,
        value: editor.defaultThoughtLevelValue,
        setValue: editor.setDefaultThoughtLevelValue,
      },
      skills: {
        mode: editor.defaultSkillsMode,
        setMode: editor.setDefaultSkillsMode,
      },
      mcps: {
        mode: editor.defaultMcpMode,
        setMode: editor.setDefaultMcpMode,
        availableServers: editor.availableMcpServers,
        selectedIds: editor.selectedMcpIds,
        setSelectedIds: editor.setSelectedMcpIds,
      },
    },
    rules: {
      content: editor.editContext,
      setContent: editor.setEditContext,
      viewMode: editor.promptViewMode,
      setViewMode: editor.setPromptViewMode,
    },
    skills: {
      availableSkills: editor.availableSkills,
      selectedSkills: editor.selectedSkills,
      setSelectedSkills: editor.setSelectedSkills,
      pendingSkills: editor.pendingSkills,
      setDeletePendingSkillName: editor.setDeletePendingSkillName,
      setDeleteCustomSkillName: editor.setDeleteCustomSkillName,
      builtinAutoSkills: editor.builtinAutoSkills,
      disabledBuiltinSkills: editor.disabledBuiltinSkills,
      setDisabledBuiltinSkills: editor.setDisabledBuiltinSkills,
    },
    actions: {
      save: editor.handleSave,
      requestDelete: editor.handleDeleteClick,
      duplicate: (assistant) => void editor.handleDuplicate(assistant),
    },
  };

  useEffect(() => {
    if (hasConsumedNavigationIntentRef.current) return;
    const openAssistantFromRoute =
      navigationState?.openAssistantEditor && navigationState.openAssistantId ? navigationState.openAssistantId : null;

    let openAssistantFromSession: string | null = null;
    try {
      const rawIntent = sessionStorage.getItem(OPEN_ASSISTANT_EDITOR_INTENT_KEY);
      if (rawIntent) {
        const parsedIntent = JSON.parse(rawIntent) as { assistantId?: string; openAssistantEditor?: boolean };
        if (parsedIntent.openAssistantEditor && parsedIntent.assistantId) {
          openAssistantFromSession = parsedIntent.assistantId;
        }
      }
    } catch (error) {
      console.error('[AssistantManagement] Failed to parse assistant open intent:', error);
    }

    const targetAssistantId = openAssistantFromRoute ?? openAssistantFromSession;
    if (!targetAssistantId) return;
    if (assistants.length === 0) return;

    const targetAssistant = assistants.find((assistant) => assistant.id === targetAssistantId);
    if (!targetAssistant) return;

    hasConsumedNavigationIntentRef.current = true;
    try {
      sessionStorage.removeItem(OPEN_ASSISTANT_EDITOR_INTENT_KEY);
    } catch (error) {
      console.error('[AssistantManagement] Failed to clear assistant open intent:', error);
    }
    void editor.handleEdit(targetAssistant);
  }, [assistants, editor, navigationState]);

  return (
    <div className='h-full w-full overflow-hidden bg-bg-0'>
      <div className='flex flex-col h-full w-full'>
        {messageContext}
        <div className='flex-1 min-h-0'>
          {showEditor ? (
            <AssistantEditorPage
              editor={editorViewModel}
              activeAssistant={activeAssistant}
              onBack={() => editor.setEditVisible(false)}
            />
          ) : (
            <AssistantHomeTabs
              assistants={assistants}
              loading={assistantsLoading}
              assistantOrder={assistantOrder}
              localeKey={localeKey}
              initialTab={homeTab}
              onTabChange={setHomeTab}
              onOpenDetail={(assistant) => {
                setActiveAssistantId(assistant.id);
                void editor.handleEdit(assistant);
              }}
              onOpenSettings={(assistant) => {
                setActiveAssistantId(assistant.id);
                void editor.handleEdit(assistant);
              }}
              onDuplicate={(assistant) => {
                // A duplicate becomes a new user assistant, so return to My
                // Assistants after saving — not the Official tab it came from.
                setHomeTab('mine');
                void editor.handleDuplicate(assistant);
              }}
              onDelete={(assistant) => editor.handleDeleteRequest(assistant)}
              onCreate={() => {
                setHomeTab('mine');
                void editor.handleCreate();
              }}
              onImportPersonas={() => {
                setHomeTab('mine');
                setImportModalVisible(true);
              }}
              onToggleEnabled={(assistant, checked) => void editor.handleToggleEnabled(assistant, checked)}
              onReorderEnabled={async (activeId, overId) => {
                try {
                  await reorderEnabledAssistants(activeId, overId);
                } catch {
                  message.error(t('common.failed', { defaultValue: 'Failed' }));
                }
              }}
              onStartChat={handleStartChat}
              marketplacePersonas={marketplacePersonas}
              marketplaceLoading={marketplaceLoading}
              onInstallMarketplacePersona={handleInstallMarketplacePersona}
              onStartMarketplaceChat={handleStartMarketplaceChat}
            />
          )}

          <DeleteAssistantModal
            visible={editor.deleteConfirmVisible}
            onCancel={() => editor.setDeleteConfirmVisible(false)}
            onConfirm={editor.handleDeleteConfirm}
            activeAssistant={activeAssistant}
          />

          <PersonaImportModal
            visible={importModalVisible}
            onCancel={() => setImportModalVisible(false)}
            onImported={() => {
              setImportModalVisible(false);
              void loadAssistants();
            }}
          />

          <SkillConfirmModals
            deletePendingSkillName={editor.deletePendingSkillName}
            setDeletePendingSkillName={editor.setDeletePendingSkillName}
            pendingSkills={editor.pendingSkills}
            setPendingSkills={editor.setPendingSkills}
            deleteCustomSkillName={editor.deleteCustomSkillName}
            setDeleteCustomSkillName={editor.setDeleteCustomSkillName}
            customSkills={editor.customSkills}
            setCustomSkills={editor.setCustomSkills}
            selectedSkills={editor.selectedSkills}
            setSelectedSkills={editor.setSelectedSkills}
            message={message}
          />
        </div>
      </div>
    </div>
  );
};

export default AssistantSettings;
