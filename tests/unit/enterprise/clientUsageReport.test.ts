/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportUsageMock, getConversationMock, isEnterpriseRemoteActiveMock } = vi.hoisted(() => ({
  reportUsageMock: vi.fn().mockResolvedValue(undefined),
  getConversationMock: vi.fn(),
  isEnterpriseRemoteActiveMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneBilling: { reportClientUsage: { invoke: reportUsageMock } },
    conversation: { get: { invoke: getConversationMock } },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  isEnterpriseRemoteActive: isEnterpriseRemoteActiveMock,
}));

import { reportClientTurnUsage } from '@/renderer/utils/enterprise/clientUsageReport';

const personalTurn = {
  model: { id: 'prov_local_openai', use_model: 'gpt-4.1' },
};

describe('client usage reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnterpriseRemoteActiveMock.mockReturnValue(true);
    getConversationMock.mockResolvedValue(personalTurn);
  });

  /**
   * The hard gate. A personal user has no company to report to and has agreed
   * to nothing; the check is made per call rather than trusted from a
   * render-time flag, because the flag flips when a member disconnects.
   */
  it('never reports when the client is not connected to a company', async () => {
    isEnterpriseRemoteActiveMock.mockReturnValue(false);

    await reportClientTurnUsage({ conversationId: 'conv-1', inputTokens: 900, outputTokens: 40 });

    expect(reportUsageMock).not.toHaveBeenCalled();
  });

  it('reports the counts with the model and the local provider id', async () => {
    await reportClientTurnUsage({ conversationId: 'conv-1', inputTokens: 900, outputTokens: 40 });

    expect(reportUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        model: 'gpt-4.1',
        channelId: 'prov_local_openai',
        inputTokens: 900,
        outputTokens: 40,
        requestId: expect.any(String),
      })
    );
  });

  /**
   * A company-channel turn is already metered by the proxy, and the server
   * drops reports whose provider id carries the `prov_chan_` marker. The
   * client must still send it: deciding here as well would put the same rule
   * in two places, and the two would drift.
   */
  it('sends company-channel turns too, and lets the server deduplicate', async () => {
    getConversationMock.mockResolvedValue({ model: { id: 'prov_chan_abc', use_model: 'glm-flash-latest' } });

    await reportClientTurnUsage({ conversationId: 'conv-2', inputTokens: 10, outputTokens: 5 });

    expect(reportUsageMock).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'prov_chan_abc' }));
  });

  it('skips a turn that burned nothing', async () => {
    await reportClientTurnUsage({ conversationId: 'conv-3', inputTokens: 0, outputTokens: 0 });

    expect(reportUsageMock).not.toHaveBeenCalled();
  });

  /**
   * ACP conversations carry no model on the record. Spend without attribution
   * still belongs in the company total, so the report goes out regardless.
   */
  it('still reports when the conversation carries no model', async () => {
    getConversationMock.mockResolvedValue({ type: 'acp' });

    await reportClientTurnUsage({ conversationId: 'conv-4', inputTokens: 120, outputTokens: 8 });

    expect(reportUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-4', model: undefined, channelId: undefined })
    );
  });

  it('swallows a failed report rather than surfacing it', async () => {
    reportUsageMock.mockRejectedValueOnce(new Error('offline'));

    await expect(
      reportClientTurnUsage({ conversationId: 'conv-5', inputTokens: 1, outputTokens: 1 })
    ).resolves.toBeUndefined();
  });
});
