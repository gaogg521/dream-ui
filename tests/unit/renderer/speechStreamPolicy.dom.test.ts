/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import {
  clearStreamMemory,
  getModelStreamCapability,
  getStreamCapability,
  rememberStreamUnsupported,
  shouldTryStreaming,
} from '@renderer/services/speech/speechStreamPolicy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openaiOfficial = (model: string): SpeechToTextConfig => ({
  enabled: true,
  provider: 'openai',
  openai: { api_key: 'k', base_url: '', model },
});

const openaiCustom = (model: string): SpeechToTextConfig => ({
  enabled: true,
  provider: 'openai',
  openai: { api_key: 'k', base_url: 'https://my-proxy/v1', model },
});

const hostedConfig = (): SpeechToTextConfig => ({
  enabled: true,
  provider: 'hosted',
});

// ---------------------------------------------------------------------------
// 0. getModelStreamCapability
// ---------------------------------------------------------------------------

describe('getModelStreamCapability', () => {
  describe('custom source', () => {
    it('any model → unknown', () => {
      expect(getModelStreamCapability('custom', 'gpt-4o-transcribe')).toBe('unknown');
    });

    it('whisper-1 with custom source → unknown (not unsupported)', () => {
      expect(getModelStreamCapability('custom', 'whisper-1')).toBe('unknown');
    });
  });

  describe('hosted source', () => {
    it('any model → unsupported (mode D has no realtime protocol)', () => {
      expect(getModelStreamCapability('hosted', 'aliyun')).toBe('unsupported');
    });
  });

  describe('openai source (official endpoint)', () => {
    it('whisper-1 → unsupported', () => {
      expect(getModelStreamCapability('openai', 'whisper-1')).toBe('unsupported');
    });

    it('gpt-4o-transcribe → supported', () => {
      expect(getModelStreamCapability('openai', 'gpt-4o-transcribe')).toBe('supported');
    });

    it('gpt-4o-mini-transcribe → supported', () => {
      expect(getModelStreamCapability('openai', 'gpt-4o-mini-transcribe')).toBe('supported');
    });

    it('non-preset model → unknown', () => {
      expect(getModelStreamCapability('openai', 'some-future-model')).toBe('unknown');
    });
  });
});

// ---------------------------------------------------------------------------
// 1. getStreamCapability
// ---------------------------------------------------------------------------

describe('getStreamCapability', () => {
  describe('hosted provider', () => {
    it('always unsupported (mode D has no realtime protocol)', () => {
      expect(getStreamCapability(hostedConfig())).toBe('unsupported');
    });
  });

  describe('openai provider — official endpoint (empty base_url)', () => {
    it('gpt-4o-transcribe → supported', () => {
      expect(getStreamCapability(openaiOfficial('gpt-4o-transcribe'))).toBe('supported');
    });

    it('gpt-4o-mini-transcribe → supported', () => {
      expect(getStreamCapability(openaiOfficial('gpt-4o-mini-transcribe'))).toBe('supported');
    });

    it('whisper-1 → unsupported', () => {
      expect(getStreamCapability(openaiOfficial('whisper-1'))).toBe('unsupported');
    });

    it('non-preset model → unknown', () => {
      expect(getStreamCapability(openaiOfficial('gpt-realtime-audio'))).toBe('unknown');
    });
  });

  describe('openai provider — custom base_url', () => {
    it('gpt-4o-transcribe with custom base_url → unknown (must probe)', () => {
      expect(getStreamCapability(openaiCustom('gpt-4o-transcribe'))).toBe('unknown');
    });

    it('whisper-1 with custom base_url → unknown', () => {
      expect(getStreamCapability(openaiCustom('whisper-1'))).toBe('unknown');
    });

    it('whitespace-only base_url is treated as official', () => {
      const config: SpeechToTextConfig = {
        enabled: true,
        provider: 'openai',
        openai: { api_key: 'k', base_url: '  ', model: 'whisper-1' },
      };
      expect(getStreamCapability(config)).toBe('unsupported');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. shouldTryStreaming + rememberStreamUnsupported + clearStreamMemory
// ---------------------------------------------------------------------------

describe('shouldTryStreaming', () => {
  beforeEach(() => {
    localStorage.clear();
    clearStreamMemory();
  });

  it('unsupported capability → false regardless of memory', () => {
    expect(shouldTryStreaming(openaiOfficial('whisper-1'))).toBe(false);
  });

  it('supported capability with no memory entry → true', () => {
    expect(shouldTryStreaming(openaiOfficial('gpt-4o-transcribe'))).toBe(true);
  });

  it('after rememberStreamUnsupported → false for same config', () => {
    const cfg = openaiOfficial('gpt-4o-transcribe');
    rememberStreamUnsupported(cfg);
    expect(shouldTryStreaming(cfg)).toBe(false);
  });

  it('memory for config-A does not affect config-B (different model)', () => {
    rememberStreamUnsupported(openaiOfficial('gpt-4o-transcribe'));
    expect(shouldTryStreaming(openaiOfficial('gpt-4o-mini-transcribe'))).toBe(true);
  });

  it('memory for config-A does not affect a hosted config (unsupported regardless)', () => {
    rememberStreamUnsupported(openaiOfficial('gpt-4o-transcribe'));
    expect(shouldTryStreaming(hostedConfig())).toBe(false);
  });

  it('clearStreamMemory removes all entries → true again', () => {
    const cfg = openaiOfficial('gpt-4o-transcribe');
    rememberStreamUnsupported(cfg);
    clearStreamMemory();
    expect(shouldTryStreaming(cfg)).toBe(true);
  });

  it('unknown capability with no memory → true (optimistic)', () => {
    expect(shouldTryStreaming(openaiCustom('gpt-4o-transcribe'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. localStorage error resilience
// ---------------------------------------------------------------------------

describe('localStorage error resilience', () => {
  beforeEach(() => {
    localStorage.clear();
    clearStreamMemory();
    vi.restoreAllMocks();
  });

  it('getItem throwing → shouldTryStreaming does not throw, returns capability-based answer', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    // capability is 'supported' → optimistic true (memory read failed silently)
    expect(() => shouldTryStreaming(openaiOfficial('gpt-4o-transcribe'))).not.toThrow();
    expect(shouldTryStreaming(openaiOfficial('gpt-4o-transcribe'))).toBe(true);
  });

  it('setItem throwing → rememberStreamUnsupported does not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    expect(() => rememberStreamUnsupported(openaiOfficial('gpt-4o-transcribe'))).not.toThrow();
  });

  it('getItem throwing for clearStreamMemory → does not throw', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => clearStreamMemory()).not.toThrow();
  });

  it('capability unsupported → false even when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(shouldTryStreaming(openaiOfficial('whisper-1'))).toBe(false);
  });
});
