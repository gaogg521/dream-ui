import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';

const mockNetworkInterfaces = vi.fn();

vi.mock('node:os', () => ({
  networkInterfaces: () => mockNetworkInterfaces(),
}));

function iface(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  } as NetworkInterfaceInfo;
}

describe('getLanIP', () => {
  beforeEach(() => {
    vi.resetModules();
    mockNetworkInterfaces.mockReset();
  });

  it('skips virtual adapters (e.g. VMware host-only) in favor of a physical one', async () => {
    mockNetworkInterfaces.mockReturnValue({
      'VMware Network Adapter VMnet1': [iface('192.168.153.1')],
      Ethernet: [iface('192.168.11.177')],
    });
    const { getLanIP } = await import('./static-server.js');
    expect(getLanIP()).toBe('192.168.11.177');
  });

  it('falls back to a virtual adapter address when no physical NIC is present', async () => {
    mockNetworkInterfaces.mockReturnValue({
      'vEthernet (WSL)': [iface('172.20.10.2')],
    });
    const { getLanIP } = await import('./static-server.js');
    expect(getLanIP()).toBe('172.20.10.2');
  });

  it('ignores internal/loopback interfaces', async () => {
    mockNetworkInterfaces.mockReturnValue({
      lo: [iface('127.0.0.1', true)],
      Ethernet: [iface('10.0.0.5')],
    });
    const { getLanIP } = await import('./static-server.js');
    expect(getLanIP()).toBe('10.0.0.5');
  });

  it('returns null when no non-internal IPv4 interface exists', async () => {
    mockNetworkInterfaces.mockReturnValue({
      lo: [iface('127.0.0.1', true)],
    });
    const { getLanIP } = await import('./static-server.js');
    expect(getLanIP()).toBeNull();
  });
});
