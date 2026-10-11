/**
 * Copyright 2026 One Work
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const SEED_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  plan: vi.fn(),
  seed: vi.fn(),
  createPackage: vi.fn(),
  reportEvents: vi.fn(),
  ask: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    onePlatform: {
      mySecurityPolicy: { invoke: mocks.policy },
      secureExportSeed: { invoke: mocks.seed },
      createSecurePackage: { invoke: mocks.createPackage },
      reportExportEvents: { invoke: mocks.reportEvents },
    },
    oneBilling: { myPlan: { invoke: mocks.plan } },
    credential: {
      encrypt: { invoke: async () => ({ success: false, msg: 'n/a' }) },
      decrypt: { invoke: async () => ({ success: false, msg: 'n/a' }) },
    },
  },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({ getEnterpriseServerUrl: () => 'https://ow.example.com' }));
vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (e: unknown) => Boolean(e && typeof e === 'object' && 'code' in e),
}));
vi.mock('@/renderer/utils/enterprise/secureExport/protectionDialog', () => ({ askExportProtection: mocks.ask }));

import { prepareExport } from '@/renderer/utils/enterprise/secureExport/gateway';
import { flushExportEvents } from '@/renderer/utils/enterprise/secureExport/events';
import { base64ToBytes, openPackage } from '@/renderer/utils/enterprise/secureExport/packageFormat';
import { setSecureExportEnterpriseActive } from '@/renderer/utils/enterprise/secureExport/policy';
import { contentHashPrefix } from '@/renderer/utils/enterprise/secureExport/watermark';

const t = (key: string) => key;
const BODY = '# Q3 plan\n\nTarget: 12M.\n';

function entitled(mode: 'optional' | 'default' | 'required', watermark = true) {
  mocks.policy.mockResolvedValue({
    conversationShareMode: 'off',
    exportWatermarkEnabled: watermark,
    exportEncryptionMode: mode,
  });
  mocks.plan.mockResolvedValue({ enterpriseId: 'ent-1', entitlements: [{ feature: 'secure_export', allowed: true }] });
  mocks.seed.mockResolvedValue({ seedId: 'SEED1', seedKey: SEED_KEY, expiresAt: Date.now() + 30 * 864e5 });
}

beforeEach(() => {
  // Leaving the company drops the in-memory seed; each test starts cold.
  setSecureExportEnterpriseActive(false);
  store.clear();
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.reportEvents.mockResolvedValue({ accepted: 1 });
});

describe('export gateway', () => {
  it('passes files through untouched outside a company, without a single request', async () => {
    setSecureExportEnterpriseActive(false);
    const files = [{ name: 'a.md', text: BODY }];
    const decision = await prepareExport({ kind: 'conversation_markdown', files, suggestedName: 'a.md', t });
    expect(decision.mode).toBe('plain');
    expect(decision.mode === 'plain' && decision.files).toBe(files);
    if (decision.mode === 'plain') decision.report();
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('passes files through when the plan lacks the feature', async () => {
    setSecureExportEnterpriseActive(true);
    mocks.policy.mockResolvedValue({ exportWatermarkEnabled: true, exportEncryptionMode: 'required' });
    mocks.plan.mockResolvedValue({ entitlements: [{ feature: 'secure_export', allowed: false }] });
    const files = [{ name: 'a.md', text: BODY }];
    const decision = await prepareExport({ kind: 'conversation_markdown', files, suggestedName: 'a.md', t });
    expect(decision.mode === 'plain' && decision.files).toBe(files);
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('watermarks a plain export and records it after the write', async () => {
    setSecureExportEnterpriseActive(true);
    entitled('optional');
    mocks.ask.mockResolvedValue({
      encrypt: false,
      recipientScope: 'tenant',
      recipientUserIds: [],
      expiresInDays: null,
    });
    const decision = await prepareExport({
      kind: 'conversation_markdown',
      files: [
        { name: 'q3.md', text: BODY },
        { name: 'data.csv', text: 'a,b\n' },
      ],
      suggestedName: 'x',
      t,
    });
    expect(decision.mode).toBe('plain');
    if (decision.mode !== 'plain') return;
    const [md, csv] = decision.files;
    expect(md.text).toMatch(/\n<!-- ow:wm1\.SEED1\.[0-9a-z]+\.[0-9a-f]{16}\.[0-9a-f]{16} -->\n$/);
    expect(await contentHashPrefix(md.text!)).toBe(await contentHashPrefix(BODY));
    expect(csv.text).toBe('a,b\n');
    expect(mocks.reportEvents).not.toHaveBeenCalled();
    decision.report();
    await flushExportEvents();
    const sent = mocks.reportEvents.mock.calls[0][0].events[0];
    expect(sent).toMatchObject({
      kind: 'conversation_markdown',
      encrypted: false,
      seedId: 'SEED1',
      fileNames: ['q3.md', 'data.csv'],
    });
    expect(JSON.stringify(sent)).not.toContain('Target: 12M');
  });

  it('seals an encrypted package the deposited key opens', async () => {
    setSecureExportEnterpriseActive(true);
    entitled('required');
    mocks.ask.mockResolvedValue({
      encrypt: true,
      recipientScope: 'users',
      recipientUserIds: ['bob'],
      expiresInDays: 7,
    });
    mocks.createPackage.mockResolvedValue({});
    const decision = await prepareExport({
      kind: 'history_batch',
      files: [{ name: 'q3.md', text: BODY }],
      suggestedName: 'x.zip',
      t,
    });
    expect(decision.mode).toBe('encrypted');
    if (decision.mode !== 'encrypted') return;
    expect(decision.fileName).toBe('q3.owenc');
    const deposited = mocks.createPackage.mock.calls[0][0];
    expect(deposited).toMatchObject({ recipientScope: 'users', recipientUserIds: ['bob'], fileNames: ['q3.md'] });
    expect(deposited.expiresAt).toBeGreaterThan(Date.now() + 6 * 864e5);
    const opened = await openPackage(decision.bytes, base64ToBytes(deposited.dek));
    expect(opened.header.serverOrigin).toBe('https://ow.example.com');
    expect(opened.header.packageId).toBe(deposited.packageId);
    const text = new TextDecoder().decode(opened.files[0].bytes);
    expect(text.startsWith(BODY.trimEnd())).toBe(true);
    expect(text).toContain('<!-- ow:wm1.SEED1.');
  });

  it('blocks instead of falling back to plaintext when the key cannot be deposited', async () => {
    setSecureExportEnterpriseActive(true);
    entitled('required');
    mocks.ask.mockResolvedValue({ encrypt: true, recipientScope: 'tenant', recipientUserIds: [], expiresInDays: null });
    mocks.createPackage.mockRejectedValue(new TypeError('fetch failed'));
    const decision = await prepareExport({
      kind: 'conversation_markdown',
      files: [{ name: 'q3.md', text: BODY }],
      suggestedName: 'x',
      t,
    });
    expect(decision).toMatchObject({ mode: 'blocked', reason: 'offline' });
  });

  it('still exports when no seed can be had — watermarking never gates an export', async () => {
    setSecureExportEnterpriseActive(true);
    entitled('optional');
    mocks.seed.mockRejectedValue(new TypeError('offline'));
    mocks.ask.mockResolvedValue({
      encrypt: false,
      recipientScope: 'tenant',
      recipientUserIds: [],
      expiresInDays: null,
    });
    const decision = await prepareExport({
      kind: 'conversation_markdown',
      files: [{ name: 'q3.md', text: BODY }],
      suggestedName: 'x',
      t,
    });
    expect(decision.mode === 'plain' && decision.files[0].text).toBe(BODY);
  });

  it('an empty flush (app start) does not wedge later uploads', async () => {
    // Regression: the empty-queue flush used to leave a settled promise in
    // the in-flight slot, so no event was ever sent again (found on a real
    // client: the admin's export record stayed empty).
    await flushExportEvents();
    setSecureExportEnterpriseActive(true);
    entitled('optional');
    mocks.ask.mockResolvedValue({
      encrypt: false,
      recipientScope: 'tenant',
      recipientUserIds: [],
      expiresInDays: null,
    });
    const decision = await prepareExport({
      kind: 'team',
      files: [{ name: 't.html', text: '<p>x</p>' }],
      suggestedName: 'x',
      t,
    });
    if (decision.mode !== 'plain') throw new Error('expected plain');
    decision.report();
    await flushExportEvents();
    expect(mocks.reportEvents).toHaveBeenCalledTimes(1);
    expect(store.get('one.secureExport.events.v1')).toBe('[]');
  });

  it('cancelling the dialog writes nothing', async () => {
    setSecureExportEnterpriseActive(true);
    entitled('default');
    mocks.ask.mockResolvedValue(null);
    const decision = await prepareExport({
      kind: 'conversation_markdown',
      files: [{ name: 'q3.md', text: BODY }],
      suggestedName: 'x',
      t,
    });
    expect(decision.mode).toBe('cancelled');
    expect(mocks.createPackage).not.toHaveBeenCalled();
  });
});
