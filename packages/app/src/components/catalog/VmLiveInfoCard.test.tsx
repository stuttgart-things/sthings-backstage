import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { Entity } from '@backstage/catalog-model';
import {
  formatUptime,
  hasLiveVmInfo,
  liveRows,
  VmLiveInfoCard,
} from './VmLiveInfoCard';

const vm: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'homerun2-proxmox-vm',
    annotations: {
      'backstage.io/managed-by-location': 'sthings-vms:proxmox-labul',
      'proxmox.stuttgart-things.com/vmid': '117',
    },
  },
  spec: { type: 'vm' },
};

const discoveryApi = {
  getBaseUrl: async (id: string) => `http://backstage/api/${id}`,
};

async function renderCard(response: { status: number; body: unknown }) {
  const fetch = jest.fn(async () => ({
    ok: response.status < 400,
    status: response.status,
    statusText: 'x',
    json: async () => response.body,
  }));
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [discoveryApiRef, discoveryApi],
        [fetchApiRef, { fetch: fetch as unknown as typeof globalThis.fetch }],
      ]}
    >
      <EntityProvider entity={vm}>
        <VmLiveInfoCard />
      </EntityProvider>
    </TestApiProvider>,
  );
  return fetch;
}

describe('VmLiveInfoCard', () => {
  it('shows the live state from the vm-info backend', async () => {
    const fetch = await renderCard({
      status: 200,
      body: {
        cloud: 'proxmox',
        status: 'running',
        uptimeSeconds: 93784,
        ipAddresses: ['10.31.103.21', '2001:db8::7'],
        host: 'ul-pve02',
        cpu: { count: 4, usagePercent: 23.5 },
        memory: { totalMiB: 8192, usedMiB: 3072 },
        fetchedAt: '2026-11-23T12:00:00Z',
      },
    });

    expect(await screen.findByText('running')).toBeInTheDocument();
    expect(screen.getByText('1d 2h 3m')).toBeInTheDocument();
    expect(screen.getByText('10.31.103.21, 2001:db8::7')).toBeInTheDocument();
    expect(screen.getByText('23.5 % of 4 vCPU')).toBeInTheDocument();
    expect(screen.getByText('3 GiB of 8 GiB')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      'http://backstage/api/vm-info/entity/default/homerun2-proxmox-vm',
    );
  });

  it('says why when the hypervisor cannot be asked', async () => {
    await renderCard({
      status: 502,
      body: { error: { message: 'Proxmox GET failed: 500' } },
    });
    expect(
      await screen.findByText(/Live state not available: Proxmox GET failed/),
    ).toBeInTheDocument();
  });
});

describe('hasLiveVmInfo', () => {
  it('is true only for provider-made VMs', () => {
    expect(hasLiveVmInfo(vm)).toBe(true);
    expect(hasLiveVmInfo({ ...vm, spec: { type: 'vm-template' } })).toBe(false);
    expect(
      hasLiveVmInfo({
        ...vm,
        metadata: {
          name: 'tf',
          annotations: { 'backstage.io/managed-by-location': 'url:https://x' },
        },
      }),
    ).toBe(false);
  });
});

describe('formatting', () => {
  it('formats uptime', () => {
    expect(formatUptime(30)).toBe('<1m');
    expect(formatUptime(3725)).toBe('1h 2m');
    expect(formatUptime(86400 + 60)).toBe('1d 0h 1m');
  });

  it('leaves out what the source does not report', () => {
    const rows = liveRows({
      cloud: 'harvester',
      status: 'stopped',
      ipAddresses: [],
      cpu: { count: 2 },
      memory: { totalMiB: 4096 },
      fetchedAt: '2026-11-23T12:00:00Z',
    });
    expect(Object.keys(rows)).toEqual(['Status', 'CPU', 'Memory', 'As of']);
    expect(rows.CPU).toBe('of 2 vCPU');
    expect(rows.Memory).toBe('4 GiB');
  });
});
