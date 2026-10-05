import { toEntityName, toTag, vmToEntity } from './entity';
import { VmRecord } from './types';

const defaults = {
  providerId: 'proxmox-labul',
  system: 'labul',
  owner: 'team-infrastructure',
  lifecycle: 'production',
};

const homerun2: VmRecord = {
  name: 'homerun2-test1',
  cloud: 'proxmox',
  template: false,
  status: 'running',
  cpus: 4,
  memoryMiB: 8192,
  ipv4: '10.31.102.114',
  tags: ['stuttgart-things', 'se-phermann'],
  annotations: {
    'proxmox.stuttgart-things.com/vmid': '254',
    'proxmox.stuttgart-things.com/node': 'ul-pve11',
    'proxmox.stuttgart-things.com/pool': 'stuttgart-things',
    'proxmox.stuttgart-things.com/ipv4': '10.31.102.114',
  },
  url: 'https://ul-pve01.labul.sva.de:8006/#v1:0:=qemu%2F254',
};

describe('vmToEntity', () => {
  it('produces the same ref and spec as the hand-maintained catalog/vms entities', () => {
    const entity = vmToEntity(homerun2, defaults);

    expect(entity.kind).toBe('Resource');
    expect(entity.metadata.name).toBe('homerun2-test1-proxmox-vm');
    expect(entity.spec).toEqual({
      type: 'vm',
      lifecycle: 'production',
      owner: 'team-infrastructure',
      system: 'labul',
    });
    expect(entity.metadata.annotations).toMatchObject({
      'backstage.io/managed-by-location': 'sthings-vms:proxmox-labul',
      'backstage.io/managed-by-origin-location': 'sthings-vms:proxmox-labul',
      'proxmox.stuttgart-things.com/vmid': '254',
      'proxmox.stuttgart-things.com/node': 'ul-pve11',
      'proxmox.stuttgart-things.com/ipv4': '10.31.102.114',
      'vm.stuttgart-things.com/status': 'running',
      'vm.stuttgart-things.com/cpus': '4',
      'vm.stuttgart-things.com/memory-mib': '8192',
    });
    expect(entity.metadata.tags).toEqual([
      'proxmox',
      'labul',
      'vm',
      'stuttgart-things',
      'se-phermann',
    ]);
    expect(entity.metadata.links).toEqual([
      { url: homerun2.url, title: 'Proxmox', icon: 'dashboard' },
    ]);
  });

  it('marks templates as vm-template', () => {
    const entity = vmToEntity(
      { ...homerun2, name: 'ubuntu26-base-os', template: true, tags: [] },
      defaults,
    );
    expect(entity.spec?.type).toBe('vm-template');
    expect(entity.metadata.tags).toEqual(['proxmox', 'labul', 'vm-template']);
  });

  it('leaves out live fields the source did not report', () => {
    const entity = vmToEntity(
      {
        name: 'x',
        cloud: 'proxmox',
        template: false,
        tags: [],
        annotations: {},
      },
      defaults,
    );
    expect(Object.keys(entity.metadata.annotations ?? {})).toEqual([
      'backstage.io/managed-by-location',
      'backstage.io/managed-by-origin-location',
    ]);
    expect(entity.metadata.links).toBeUndefined();
  });
});

describe('sanitizers', () => {
  it('makes names valid', () => {
    expect(toEntityName('my vm/01-proxmox-vm')).toBe('my-vm-01-proxmox-vm');
    expect(toEntityName(`${'a'.repeat(62)}--b`)).toBe('a'.repeat(62));
  });

  it('makes tags valid and drops empty ones', () => {
    expect(toTag('Team_Infra')).toBe('team-infra');
    expect(toTag('k8s:prod')).toBe('k8s:prod');
    expect(toTag('___')).toBe('');
  });
});
