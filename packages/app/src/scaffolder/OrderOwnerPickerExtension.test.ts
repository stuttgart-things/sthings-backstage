import { ownerChoices } from './OrderOwnerPickerExtension';

describe('ownerChoices', () => {
  it('offers the user first, then their team groups, without role groups', () => {
    expect(
      ownerChoices('user:default/Biff', [
        'user:default/biff',
        'group:default/beta-vm-machinery',
        'group:default/hill-valley',
        'group:default/guests',
        'group:default/platform-team',
        'group:default/Alpha',
      ]),
    ).toEqual([
      'user:default/biff',
      'group:default/alpha',
      'group:default/hill-valley',
    ]);
  });

  it('offers only the user when they have no team (doc)', () => {
    expect(
      ownerChoices('user:default/doc', [
        'user:default/doc',
        'group:default/beta-vm-machinery',
      ]),
    ).toEqual(['user:default/doc']);
  });

  it('honours configured exclusions', () => {
    expect(
      ownerChoices(
        'user:default/x',
        ['group:default/a', 'group:default/b'],
        ['group:default/a'],
      ),
    ).toEqual(['user:default/x', 'group:default/b']);
  });
});
