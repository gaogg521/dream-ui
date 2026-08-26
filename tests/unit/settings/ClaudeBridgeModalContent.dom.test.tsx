/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getConfigMock = vi.fn();
const setConfigMock = vi.fn();
const messages: string[] = [];

// A stable `t` reference matters here: real react-i18next keeps `t` stable
// across renders (it's a dependency of this component's config-load effect),
// so a mock that returns a fresh function identity every call would make
// that effect re-run — and re-fetch/overwrite state — on every re-render.
const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

vi.mock('@/renderer/components/base/DreamScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  claudeBridge: {
    getConfig: { invoke: () => getConfigMock() },
    setConfig: { invoke: (params: unknown) => setConfigMock(params) },
  },
}));

// Real Arco components rely on a portal-based ReactDOM.render call for
// `Message` that isn't available in this project's jsdom test environment
// (see other `*.dom.test.tsx` files for the same pattern) — stub the small
// subset this component actually uses instead of the real library.
vi.mock('@arco-design/web-react', () => {
  const Button = ({
    children,
    onClick,
    loading,
    disabled,
    ...props
  }: React.PropsWithChildren<{ onClick?: () => void; loading?: boolean; disabled?: boolean }>) => (
    <button type='button' onClick={onClick} disabled={disabled || loading} {...props}>
      {children}
    </button>
  );
  const Switch = ({
    checked,
    onChange,
    disabled,
    ...props
  }: {
    checked?: boolean;
    onChange?: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      {...props}
    />
  );
  const Select = ({
    children,
    onChange,
    value,
    placeholder,
    disabled,
    ...props
  }: React.PropsWithChildren<{
    onChange?: (value: string) => void;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
  }>) => (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange?.(e.target.value)} {...props}>
      <option value='' disabled>
        {placeholder}
      </option>
      {children}
    </select>
  );
  const Option = ({ value, children }: React.PropsWithChildren<{ value: string }>) => (
    <option value={value}>{children}</option>
  );
  Select.Option = Option;
  const Message = {
    error: (msg: string) => {
      messages.push(msg);
      const el = document.createElement('div');
      el.setAttribute('data-mock-message', 'error');
      el.textContent = msg;
      document.body.appendChild(el);
    },
    success: (msg: string) => {
      messages.push(msg);
      const el = document.createElement('div');
      el.setAttribute('data-mock-message', 'success');
      el.textContent = msg;
      document.body.appendChild(el);
    },
  };
  return { Button, Switch, Select, Message };
});

vi.mock('@icon-park/react', () => ({
  LinkCloud: () => <span data-testid='link-cloud-icon' />,
}));

const mockProviders = [
  { id: 'prov-1', platform: 'custom', name: 'Provider One', base_url: '', api_key: '', models: ['model-a', 'model-b'] },
  { id: 'prov-2', platform: 'custom', name: 'Provider Two', base_url: '', api_key: '', models: ['model-c'] },
];

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: mockProviders,
    getAvailableModels: (provider: { id: string }) => mockProviders.find((p) => p.id === provider.id)?.models ?? [],
    formatModelLabel: (_provider: unknown, modelName?: string) => modelName ?? '',
  }),
}));

import ClaudeBridgeModalContent from '@/renderer/pages/settings/ClaudeBridgeSettings/ClaudeBridgeModalContent';

describe('ClaudeBridgeModalContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messages.length = 0;
    document.body.innerHTML = '';
  });

  it('loads and displays the saved provider/model when already configured', async () => {
    getConfigMock.mockResolvedValue({ enabled: true, provider_id: 'prov-1', model: 'model-a' });

    render(<ClaudeBridgeModalContent />);

    await waitFor(() => {
      expect(screen.getByTestId('claude-bridge-enable-switch')).toBeInTheDocument();
    });
    expect(screen.getByTestId('claude-bridge-enable-switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Provider One')).toBeInTheDocument();
    expect(screen.getByText('model-a')).toBeInTheDocument();
  });

  it('shows a load-failure message and keeps the form usable when the config fetch rejects', async () => {
    getConfigMock.mockRejectedValue(new Error('network down'));

    render(<ClaudeBridgeModalContent />);

    await waitFor(() => {
      expect(messages).toContain('settings.claudeBridge.loadFailed');
    });
    // Falls back to disabled/unconfigured rather than getting stuck loading.
    expect(screen.getByTestId('claude-bridge-enable-switch')).not.toBeDisabled();
    expect(screen.getByTestId('claude-bridge-enable-switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('blocks saving when enabling without a selected provider and model', async () => {
    getConfigMock.mockResolvedValue({ enabled: false, provider_id: null, model: null });
    const user = userEvent.setup();

    render(<ClaudeBridgeModalContent />);
    await waitFor(() => expect(screen.getByTestId('claude-bridge-enable-switch')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('claude-bridge-enable-switch'));
    await waitFor(() => {
      expect(screen.getByTestId('claude-bridge-enable-switch')).toHaveAttribute('aria-checked', 'true');
    });
    await user.click(screen.getByTestId('claude-bridge-save-button'));

    await waitFor(() => {
      expect(messages).toContain('settings.claudeBridge.providerModelRequired');
    });
    expect(setConfigMock).not.toHaveBeenCalled();
  });

  it('saves the enabled config with the selected provider and model', async () => {
    getConfigMock.mockResolvedValue({ enabled: true, provider_id: 'prov-1', model: 'model-a' });
    setConfigMock.mockResolvedValue({ enabled: true, provider_id: 'prov-1', model: 'model-a' });
    const user = userEvent.setup();

    render(<ClaudeBridgeModalContent />);
    await waitFor(() => expect(screen.getByText('Provider One')).toBeInTheDocument());

    await user.click(screen.getByTestId('claude-bridge-save-button'));

    await waitFor(() => {
      expect(setConfigMock).toHaveBeenCalledWith({ enabled: true, provider_id: 'prov-1', model: 'model-a' });
    });
    expect(messages).toContain('settings.claudeBridge.saveSuccess');
  });

  it('resets the model selection when switching to a provider that lacks the current model', async () => {
    getConfigMock.mockResolvedValue({ enabled: true, provider_id: 'prov-1', model: 'model-a' });
    setConfigMock.mockResolvedValue({ enabled: true, provider_id: 'prov-2', model: 'model-c' });
    const user = userEvent.setup();

    render(<ClaudeBridgeModalContent />);
    await waitFor(() => expect(screen.getByTestId('claude-bridge-provider-select')).not.toBeDisabled());

    fireEvent.change(screen.getByTestId('claude-bridge-provider-select'), { target: { value: 'prov-2' } });
    await user.click(screen.getByTestId('claude-bridge-save-button'));

    await waitFor(() => {
      expect(setConfigMock).toHaveBeenCalledWith({ enabled: true, provider_id: 'prov-2', model: 'model-c' });
    });
  });
});
