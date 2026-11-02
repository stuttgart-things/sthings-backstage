import { MachineryResource, ownedBy } from './MachineryClaimPickerExtension';

const claim = (annotations: Record<string, string>): MachineryResource => ({
  kind: 'NativeVsphereVM',
  apiVersion: 'resources.stuttgart-things.com/v1alpha1',
  name: 'x',
  ready: true,
  annotations,
});

describe('ownedBy', () => {
  const biff = [
    'user:default/biff',
    'group:default/beta-vm-machinery',
    'group:default/hill-valley',
  ];

  it('offers claims ordered by the user', () => {
    expect(
      ownedBy(claim({ 'stuttgart-things.com/requested-by': 'biff' }), biff),
    ).toBe(true);
  });

  it('offers claims owned by one of their groups, case-insensitively', () => {
    expect(
      ownedBy(
        claim({
          'stuttgart-things.com/requested-by': 'user:default/doc',
          'stuttgart-things.com/owner': 'group:default/Hill-Valley',
        }),
        biff,
      ),
    ).toBe(true);
  });

  it("hides other people's claims and claims without owner or requester", () => {
    expect(
      ownedBy(
        claim({
          'stuttgart-things.com/requested-by': 'user:default/doc',
          'stuttgart-things.com/owner': 'user:default/doc',
        }),
        biff,
      ),
    ).toBe(false);
    expect(ownedBy(claim({}), biff)).toBe(false);
  });
});
