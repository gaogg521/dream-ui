import { describe, expect, it } from 'vitest';
import {
  appendEnterpriseServerUrlHistory,
  DEFAULT_WEBUI_DEPLOYMENT_ROLE,
  MAX_ENTERPRISE_SERVER_URL_HISTORY,
  normalizeEnterpriseServerUrl,
  normalizeEnterpriseServerUrlHistory,
  normalizeWebuiDeploymentRole,
  resolveDeploymentRole,
} from '@/common/config/webuiEnterpriseConfig';

describe('webuiEnterpriseConfig', () => {
  describe('normalizeEnterpriseServerUrl', () => {
    it('returns null for empty input', () => {
      expect(normalizeEnterpriseServerUrl('')).toBeNull();
      expect(normalizeEnterpriseServerUrl('   ')).toBeNull();
    });

    it('prepends http:// and strips path to origin', () => {
      expect(normalizeEnterpriseServerUrl('192.168.1.10:25809')).toBe('http://192.168.1.10:25809');
      expect(normalizeEnterpriseServerUrl('http://192.168.1.10:25809/api')).toBe('http://192.168.1.10:25809');
    });

    it('returns null for invalid URLs', () => {
      expect(normalizeEnterpriseServerUrl('not a url !!!')).toBeNull();
    });
  });

  describe('normalizeWebuiDeploymentRole', () => {
    it('only accepts explicit server', () => {
      expect(normalizeWebuiDeploymentRole('server')).toBe('server');
      expect(normalizeWebuiDeploymentRole('client')).toBe('client');
      expect(normalizeWebuiDeploymentRole(undefined)).toBe('client');
      expect(normalizeWebuiDeploymentRole('invalid')).toBe('client');
    });
  });

  describe('resolveDeploymentRole', () => {
    it('defaults to client when pref is unset, even if local enterprise exists', () => {
      expect(resolveDeploymentRole(undefined)).toBe(DEFAULT_WEBUI_DEPLOYMENT_ROLE);
      expect(resolveDeploymentRole(null)).toBe('client');
    });

    it('respects explicit server or client', () => {
      expect(resolveDeploymentRole('server')).toBe('server');
      expect(resolveDeploymentRole('client')).toBe('client');
    });
  });

  describe('server URL history', () => {
    it('normalizes, de-duplicates, and drops junk entries', () => {
      expect(
        normalizeEnterpriseServerUrlHistory([
          '192.168.1.10:25809',
          'http://192.168.1.10:25809',
          'not a url !!!',
          42,
          '10.0.0.5:25809',
        ])
      ).toEqual(['http://192.168.1.10:25809', 'http://10.0.0.5:25809']);
    });

    it('returns an empty list for non-array input', () => {
      expect(normalizeEnterpriseServerUrlHistory(undefined)).toEqual([]);
      expect(normalizeEnterpriseServerUrlHistory('192.168.1.10:25809')).toEqual([]);
    });

    it('moves a re-used address back to the front instead of duplicating it', () => {
      const history = ['http://10.0.0.5:25809', 'http://192.168.1.10:25809'];
      expect(appendEnterpriseServerUrlHistory(history, '192.168.1.10:25809')).toEqual([
        'http://192.168.1.10:25809',
        'http://10.0.0.5:25809',
      ]);
    });

    it('ignores an invalid address and caps the list', () => {
      const history = ['http://10.0.0.5:25809'];
      expect(appendEnterpriseServerUrlHistory(history, '   ')).toEqual(history);

      const many = Array.from({ length: MAX_ENTERPRISE_SERVER_URL_HISTORY + 3 }, (_, i) => `http://10.0.0.${i}:25809`);
      const appended = appendEnterpriseServerUrlHistory(many, '192.168.1.10:25809');
      expect(appended).toHaveLength(MAX_ENTERPRISE_SERVER_URL_HISTORY);
      expect(appended[0]).toBe('http://192.168.1.10:25809');
    });
  });
});
