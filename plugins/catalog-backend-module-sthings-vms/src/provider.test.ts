import { excludeMatcher, SthingsVmEntityProvider } from './provider';
import { VmSource } from './types';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

const defaults = {
  providerId: 'proxmox-labul',
  system: 'labul',
  owner: 'team-infrastructure',
  lifecycle: 'production',
};

describe('SthingsVmEntityProvider', () => {
  it('applies a full mutation with one entity per VM', async () => {
    const source: VmSource = {
      listVms: async () => [
        {
          name: 'a',
          cloud: 'proxmox',
          template: false,
          tags: [],
          annotations: {},
        },
        {
          name: 'b',
          cloud: 'proxmox',
          template: true,
          tags: [],
          annotations: {},
        },
      ],
    };
    const connection = { applyMutation: jest.fn(), refresh: jest.fn() };
    const provider = new SthingsVmEntityProvider(
      source,
      defaults,
      logger as any,
    );
    await provider.connect(connection);

    await provider.refresh();

    expect(provider.getProviderName()).toBe('sthings-vms:proxmox-labul');
    const mutation = connection.applyMutation.mock.calls[0][0];
    expect(mutation.type).toBe('full');
    expect(
      mutation.entities.map((e: any) => [
        e.entity.metadata.name,
        e.locationKey,
      ]),
    ).toEqual([
      ['a-proxmox-vm', 'sthings-vms:proxmox-labul'],
      ['b-proxmox-vm', 'sthings-vms:proxmox-labul'],
    ]);
  });

  it('keeps the existing entities when the source fails', async () => {
    const source: VmSource = {
      listVms: async () => {
        throw new Error('proxmox down');
      },
    };
    const connection = { applyMutation: jest.fn(), refresh: jest.fn() };
    const provider = new SthingsVmEntityProvider(
      source,
      defaults,
      logger as any,
    );
    await provider.connect(connection);

    await expect(provider.refresh()).rejects.toThrow('proxmox down');
    expect(connection.applyMutation).not.toHaveBeenCalled();
  });

  it('leaves out excluded VMs', async () => {
    const vm = (name: string) => ({
      name,
      cloud: 'vsphere',
      template: false,
      tags: [],
      annotations: {},
    });
    const source: VmSource = {
      listVms: async () =>
        ['machinery', 'machinery-2', 'ubuntu26-base-20261002', 'vault'].map(vm),
    };
    const connection = { applyMutation: jest.fn(), refresh: jest.fn() };
    const provider = new SthingsVmEntityProvider(
      source,
      { ...defaults, providerId: 'vsphere-labda', system: 'labda' },
      logger as any,
      { exclude: ['machinery', 'ubuntu26-base-*'] },
    );
    await provider.connect(connection);

    await provider.refresh();

    const mutation = connection.applyMutation.mock.calls[0][0];
    expect(mutation.entities.map((e: any) => e.entity.metadata.name)).toEqual([
      'machinery-2-vsphere-vm',
      'vault-vsphere-vm',
    ]);
    expect(logger.info).toHaveBeenLastCalledWith(
      'sthings-vms:vsphere-labda: synced 2 VMs, excluded 2',
    );
  });

  it('refuses to refresh before it is connected', async () => {
    const provider = new SthingsVmEntityProvider(
      { listVms: async () => [] },
      defaults,
      logger as any,
    );
    await expect(provider.refresh()).rejects.toThrow(/not connected/);
  });
});

describe('excludeMatcher', () => {
  it('matches whole names, with * as the only wildcard', () => {
    const m = excludeMatcher(['machinery', 'ubuntu26-base-*', 'a.b', '*-old']);
    expect(m('machinery')).toBe(true);
    expect(m('machinery-2')).toBe(false); // whole name, not a prefix
    expect(m('my-machinery')).toBe(false);
    expect(m('ubuntu26-base-20261002-0725')).toBe(true);
    expect(m('ubuntu26-base-')).toBe(true);
    expect(m('a.b')).toBe(true);
    expect(m('axb')).toBe(false); // '.' is literal
    expect(m('vault-old')).toBe(true);
  });

  it('matches nothing without patterns', () => {
    expect(excludeMatcher([])('anything')).toBe(false);
  });
});
