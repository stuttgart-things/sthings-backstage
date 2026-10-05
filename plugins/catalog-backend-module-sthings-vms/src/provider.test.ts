import { SthingsVmEntityProvider } from './provider';
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

  it('refuses to refresh before it is connected', async () => {
    const provider = new SthingsVmEntityProvider(
      { listVms: async () => [] },
      defaults,
      logger as any,
    );
    await expect(provider.refresh()).rejects.toThrow(/not connected/);
  });
});
