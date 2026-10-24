import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectFileRef } from '@/common/types/chatFile';

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), read: vi.fn(), legacyRead: vi.fn(), open: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { getContentMetadata: { invoke: mocks.metadata }, readContent: { invoke: mocks.read } },
    secureExport: { readBinary: { invoke: mocks.legacyRead } },
    onePlatform: { openSecurePackage: { invoke: mocks.open } },
  },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({ getEnterpriseServerUrl: () => 'https://ow.example.com' }));
vi.mock('@/common/adapter/httpBridge', () => ({ isBackendHttpError: () => false }));
vi.mock('@/renderer/utils/enterprise/secureExport/policy', () => ({ isSecureExportEnterpriseActive: () => true }));

import { loadSecurePackage } from '@/renderer/utils/enterprise/secureExport/openPackage';
import {
  MAX_PACKAGE_BYTES,
  buildPayload,
  bytesToBase64,
  randomBytes,
  sealPackage,
} from '@/renderer/utils/enterprise/secureExport/packageFormat';

const file = projectFileRef('pe-allowed', 'exports/test.owenc');
const t = (key: string) => key;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.metadata.mockResolvedValue({ size: 1024 });
});
async function fixture(serverOrigin = 'https://ow.example.com') {
  const key = randomBytes(32);
  const { payload } = await buildPayload(
    [{ name: 'brief.md', bytes: new TextEncoder().encode('QA protected brief') }],
    'QA',
    1
  );
  const bytes = await sealPackage(payload, key, {
    packageId: 'pkg-qa',
    serverOrigin,
    enterpriseId: 'ent-qa',
    createdAt: 1,
  });
  mocks.read.mockResolvedValue(bytesToBase64(bytes));
  mocks.open.mockResolvedValue({ dek: bytesToBase64(key), package: { id: 'pkg-qa' } });
}
describe('project-scoped encrypted package opening', () => {
  it('decrypts authorized project bytes without resolving or reading an absolute path', async () => {
    await fixture();
    const result = await loadSecurePackage(file, t);
    expect(result.ok).toBe(true);
    expect(new TextDecoder().decode(result.value?.files[0].bytes)).toBe('QA protected brief');
    expect(mocks.read).toHaveBeenCalledWith({ file, encoding: 'base64' });
    expect(mocks.legacyRead).not.toHaveBeenCalled();
  });
  it('does not read bytes or request a key when project permission is denied', async () => {
    mocks.metadata.mockRejectedValue(new Error('Forbidden'));
    expect((await loadSecurePackage(file, t)).ok).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('rejects oversized files before loading their bytes', async () => {
    mocks.metadata.mockResolvedValue({ size: MAX_PACKAGE_BYTES + 1 });
    expect((await loadSecurePackage(file, t)).ok).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('never requests a key for a package naming a different server', async () => {
    await fixture('https://other.example.com');
    expect((await loadSecurePackage(file, t)).ok).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('leaves revoked packages closed', async () => {
    await fixture();
    mocks.open.mockRejectedValue(new Error('revoked'));
    expect((await loadSecurePackage(file, t)).ok).toBe(false);
  });
});
