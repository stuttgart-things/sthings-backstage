import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { VmDetailsCard } from './VmDetailsCard';

describe('VmDetailsCard', () => {
  it('shows the field names as they are (#249)', async () => {
    await renderInTestApp(
      <EntityProvider
        entity={{
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Resource',
          metadata: {
            name: 'vm1',
            annotations: {
              'vm.stuttgart-things.com/cpus': '4',
              'vm.stuttgart-things.com/memory-mib': '8192',
              'harvester.stuttgart-things.com/ipv4': '192.0.2.10',
              'proxmox.stuttgart-things.com/vmid': '101',
            },
          },
          spec: { type: 'vm' },
        }}
      >
        <VmDetailsCard />
      </EntityProvider>,
    );
    for (const label of ['vCPU', 'Memory', 'IPv4', 'VMID']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('V CPU')).not.toBeInTheDocument();
    expect(screen.getByText('8 GiB')).toBeInTheDocument();
  });
});
