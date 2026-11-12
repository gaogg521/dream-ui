import { describe, expect, it } from 'vitest';
import { headersFromHead, resolveClientIp } from '../../packages/web-host/src/client-ip';

const TOKEN = 'relay-secret-token';

describe('resolveClientIp', () => {
  it('uses X-Real-IP only for a loopback peer that presents the relay token', () => {
    expect(resolveClientIp('127.0.0.1', { 'x-onework-relay-token': TOKEN, 'x-real-ip': '203.0.113.9' }, TOKEN)).toBe(
      '203.0.113.9'
    );
  });

  it('accepts an IPv6 visitor and an IPv4-mapped one', () => {
    expect(resolveClientIp('127.0.0.1', { 'x-onework-relay-token': TOKEN, 'x-real-ip': '2001:db8::5' }, TOKEN)).toBe(
      '2001:db8::5'
    );
    expect(
      resolveClientIp('127.0.0.1', { 'x-onework-relay-token': TOKEN, 'x-real-ip': '::ffff:198.51.100.7' }, TOKEN)
    ).toBe('198.51.100.7');
  });

  it('ignores a forged X-Real-IP that arrives without the token (another tunnel passes it through)', () => {
    expect(resolveClientIp('127.0.0.1', { 'x-real-ip': '9.9.9.9' }, TOKEN)).toBe('127.0.0.1');
  });

  it('ignores a wrong token', () => {
    expect(resolveClientIp('127.0.0.1', { 'x-onework-relay-token': 'guess', 'x-real-ip': '9.9.9.9' }, TOKEN)).toBe(
      '127.0.0.1'
    );
  });

  it('never trusts headers from a non-loopback peer, even with the right token', () => {
    expect(resolveClientIp('192.168.1.20', { 'x-onework-relay-token': TOKEN, 'x-real-ip': '9.9.9.9' }, TOKEN)).toBe(
      '192.168.1.20'
    );
  });

  it('falls back to the peer when the claimed address is not an IP', () => {
    expect(resolveClientIp('127.0.0.1', { 'x-onework-relay-token': TOKEN, 'x-real-ip': 'not-an-ip' }, TOKEN)).toBe(
      '127.0.0.1'
    );
    expect(resolveClientIp('127.0.0.1', { 'x-onework-relay-token': TOKEN }, TOKEN)).toBe('127.0.0.1');
  });

  it('trusts nothing when no relay token is configured', () => {
    expect(resolveClientIp('127.0.0.1', { 'x-onework-relay-token': TOKEN, 'x-real-ip': '9.9.9.9' })).toBe('127.0.0.1');
  });
});

describe('headersFromHead', () => {
  it('lower-cases names, keeps the first occurrence, and stops at the end of the head', () => {
    const head = Buffer.from(
      'GET /ws HTTP/1.1\r\nHost: x\r\nX-Real-IP: 1.2.3.4\r\nx-real-ip: 5.6.7.8\r\n\r\nX-Onework-Relay-Token: sneaky-body\r\n'
    );
    const headers = headersFromHead(head);
    expect(headers['x-real-ip']).toBe('1.2.3.4');
    expect(headers['host']).toBe('x');
    expect(headers['x-onework-relay-token']).toBeUndefined();
  });
});
