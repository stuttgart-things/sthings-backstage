import { ProxmoxVmSource } from './proxmox';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

function json(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    json: async () => ({ data }),
  } as Response;
}

const resources = [
  {
    type: 'qemu',
    vmid: 254,
    name: 'homerun2-test1',
    node: 'ul-pve11',
    pool: 'stuttgart-things',
    status: 'running',
    template: 0,
    tags: 'se-phermann;stuttgart-things',
    maxcpu: 4,
    maxmem: 8 * 1024 * 1024 * 1024,
  },
  {
    type: 'qemu',
    vmid: 9000,
    name: 'ubuntu26-base-os',
    node: 'ul-pve01',
    pool: 'stuttgart-things',
    status: 'stopped',
    template: 1,
  },
  // Not ours: other pool, and a container.
  {
    type: 'qemu',
    vmid: 300,
    name: 'other',
    node: 'ul-pve01',
    pool: 'someone-else',
  },
  {
    type: 'lxc',
    vmid: 301,
    name: 'ct',
    node: 'ul-pve01',
    pool: 'stuttgart-things',
  },
];

function source(fetchImpl: jest.Mock) {
  return new ProxmoxVmSource({
    endpoint: 'https://pve.example:8006/',
    pool: 'stuttgart-things',
    tokenId: 'backstage@pve!catalog',
    tokenSecret: 's3cret',
    logger: logger as any,
    fetch: fetchImpl as unknown as typeof fetch,
  });
}

describe('ProxmoxVmSource', () => {
  it('lists the qemu VMs of the pool and reads the IP from the guest agent', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/cluster/resources?type=vm')
        ? json(resources)
        : json({
            result: [
              {
                name: 'lo',
                'ip-addresses': [
                  { 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1' },
                ],
              },
              {
                name: 'eth0',
                'ip-addresses': [
                  { 'ip-address-type': 'ipv6', 'ip-address': 'fe80::1' },
                  { 'ip-address-type': 'ipv4', 'ip-address': '10.31.102.114' },
                ],
              },
            ],
          }),
    );

    const vms = await source(fetchImpl).listVms();

    expect(vms.map(v => v.name)).toEqual([
      'homerun2-test1',
      'ubuntu26-base-os',
    ]);
    expect(vms[0]).toMatchObject({
      cloud: 'proxmox',
      template: false,
      status: 'running',
      cpus: 4,
      memoryMiB: 8192,
      ipv4: '10.31.102.114',
      tags: ['se-phermann', 'stuttgart-things'],
      url: 'https://pve.example:8006/#v1:0:=qemu%2F254',
      annotations: {
        'proxmox.stuttgart-things.com/vmid': '254',
        'proxmox.stuttgart-things.com/node': 'ul-pve11',
        'proxmox.stuttgart-things.com/pool': 'stuttgart-things',
        'proxmox.stuttgart-things.com/ipv4': '10.31.102.114',
      },
    });
    // Templates and stopped VMs have no agent to ask.
    expect(vms[1]).toMatchObject({ template: true, ipv4: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pve.example:8006/api2/json/cluster/resources?type=vm',
      {
        headers: { Authorization: 'PVEAPIToken=backstage@pve!catalog=s3cret' },
      },
    );
  });

  it('still returns the VM when the guest agent is unavailable', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/cluster/resources?type=vm')
        ? json([resources[0]])
        : json(null, 500),
    );

    const [vm] = await source(fetchImpl).listVms();

    expect(vm.ipv4).toBeUndefined();
    expect(vm.annotations).not.toHaveProperty(
      'proxmox.stuttgart-things.com/ipv4',
    );
  });

  it('fails when the inventory call fails', async () => {
    const fetchImpl = jest.fn(async () => json(null, 401));
    await expect(source(fetchImpl).listVms()).rejects.toThrow(/401/);
  });
});
