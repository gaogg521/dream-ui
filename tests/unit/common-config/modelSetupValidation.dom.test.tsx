import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ error: vi.fn(), submit: vi.fn(), close: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@/common/utils', () => ({ uuid: () => 'new-provider' }));
vi.mock('@renderer/hooks/agent/useModeModeList', () => ({
  default: () => ({ data: { models: [] }, mutate: vi.fn(), isLoading: false }),
}));
vi.mock('@renderer/hooks/system/useProtocolDetection', () => ({
  default: () => ({ reset: vi.fn(), isDetecting: false, result: null }),
}));
vi.mock('@/renderer/pages/settings/components/TrialModelCard', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/components/recommendedPlatforms/RecommendedPlatforms', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/agent/ThemedLogo', () => ({ ProviderLogo: () => null }));
vi.mock('@/renderer/components/base/DreamModal', async () => {
  const { Modal } = await import('@arco-design/web-react');
  return {
    default: ({ children, visible, onOk }: { children: React.ReactNode; visible: boolean; onOk: () => void }) => (
      <Modal visible={visible} onOk={onOk} okText='Confirm'>
        {children}
      </Modal>
    ),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { field?: string; fields?: string }) => {
      const labels: Record<string, string> = {
        'settings.apiEndpoint': 'API 请求地址',
        'settings.apiKey': 'API Key',
        'settings.modelName': '模型名称',
      };
      if (key === 'settings.modelFieldRequired') return `请填写${values?.field}`;
      if (key === 'settings.modelValidationFailed') return `请检查必填项：${values?.fields}`;
      return labels[key] || key;
    },
  }),
}));
vi.mock('@arco-design/web-react', async (original) => ({
  ...(await original<typeof import('@arco-design/web-react')>()),
  Message: { useMessage: () => [{ error: mocks.error, warning: vi.fn(), info: vi.fn(), success: vi.fn() }, null] },
}));
import AddPlatformModal from '@/renderer/pages/settings/components/AddPlatformModal';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('model configuration validation', () => {
  it('explains missing fields with visible labels and keeps the dialog open', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
    );
    render(
      <AddPlatformModal onSubmit={mocks.submit} modalProps={{ visible: true }} modalCtrl={{ close: mocks.close }} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith({
        content: '请检查必填项：API 请求地址, API Key, 模型名称',
        duration: 6000,
      })
    );
    expect(screen.getByText('请填写模型名称')).toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
