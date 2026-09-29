// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import i18n from '../util/i18n.node.ts';
import type { LinkCardType } from '../../linkPreviews/linkCard.std.ts';
import {
  getFirstPartyCardDisplay,
  getFirstPartyLookupKeys,
} from '../../linkPreviews/firstPartyCard.std.ts';

// card-visual §5.2 / §3.9 / §3.10 (tellomi/tellomi#1421): a Tellomi object's card has an avatar
// or cover, a title, a subtitle and one action button; what this device already knows changes
// the subtitle and the button, never the sender.

const BASE: LinkCardType = {
  level: 'first_party',
  provider: 'tellomi',
  provider_name: null,
  kind: null,
  route: null,
  title: null,
  description: null,
  attrs: [],
  domain: 'tell.cc',
  official_badge: false,
  first_party: null,
  lookalike: null,
  show_image: false,
  tintable: false,
  payment: false,
  reason: null,
};

function card(firstParty: LinkCardType['first_party']): LinkCardType {
  return { ...BASE, first_party: firstParty };
}

const USER = card({ type: 'user', display: '@kefu.57', username: 'kefu.57' });
const GROUP = card({ type: 'group', title: '周末爬山群', member_count: 12 });
const STICKER = card({ type: 'sticker', title: 'Bandit', sticker_count: 24 });

describe('getFirstPartyCardDisplay', () => {
  it('names a user from the URL, and says what the button does', () => {
    assert.deepEqual(getFirstPartyCardDisplay(USER, undefined, i18n), {
      type: 'user',
      title: '@kefu.57',
      subtitle: 'Tellomi user',
      action: 'Message',
      officialBadge: false,
    });
  });

  it('uses the name this device already has for a user it knows', () => {
    const display = getFirstPartyCardDisplay(
      USER,
      { knownUser: { title: 'Kai Xin' } },
      i18n
    );
    assert.strictEqual(display?.title, 'Kai Xin');
    assert.strictEqual(display?.subtitle, 'Tellomi user');
  });

  it('calls a user with no name in the URL a Tellomi user, once', () => {
    const display = getFirstPartyCardDisplay(
      card({ type: 'user', display: null, username: null }),
      undefined,
      i18n
    );
    assert.strictEqual(display?.title, 'Tellomi user');
    assert.isUndefined(display?.subtitle);
  });

  it('counts the members of a group to join', () => {
    assert.deepEqual(getFirstPartyCardDisplay(GROUP, undefined, i18n), {
      type: 'group',
      title: '周末爬山群',
      subtitle: '12 members',
      action: 'Join Group',
      officialBadge: false,
    });
    assert.strictEqual(
      getFirstPartyCardDisplay(
        card({ type: 'group', title: 'Two', member_count: 1 }),
        undefined,
        i18n
      )?.subtitle,
      '1 member'
    );
    for (const memberCount of [null, 0, -3]) {
      assert.isUndefined(
        getFirstPartyCardDisplay(
          card({ type: 'group', title: 'G', member_count: memberCount }),
          undefined,
          i18n
        )?.subtitle,
        String(memberCount)
      );
    }
  });

  it('opens a group this account is already in', () => {
    const display = getFirstPartyCardDisplay(
      GROUP,
      { isGroupMember: true },
      i18n
    );
    assert.strictEqual(display?.subtitle, 'You’re a member');
    assert.strictEqual(display?.action, 'Open');
  });

  it('names a call by its room, or calls it a Tellomi call', () => {
    assert.deepEqual(
      getFirstPartyCardDisplay(
        card({ type: 'call', title: 'Camping Prep' }),
        undefined,
        i18n
      ),
      {
        type: 'call',
        title: 'Camping Prep',
        subtitle: undefined,
        action: 'Join Call',
        officialBadge: false,
      }
    );
    assert.strictEqual(
      getFirstPartyCardDisplay(
        card({ type: 'call', title: null }),
        undefined,
        i18n
      )?.title,
      'Tellomi call'
    );
  });

  it('counts the stickers of a pack to add, and views one already added', () => {
    assert.deepEqual(getFirstPartyCardDisplay(STICKER, undefined, i18n), {
      type: 'sticker',
      title: 'Bandit',
      subtitle: '24 stickers',
      action: 'Add',
      officialBadge: false,
    });
    const installed = getFirstPartyCardDisplay(
      STICKER,
      { isStickerPackInstalled: true },
      i18n
    );
    assert.strictEqual(installed?.subtitle, 'Added');
    assert.strictEqual(installed?.action, 'View');
    assert.strictEqual(
      getFirstPartyCardDisplay(
        card({ type: 'sticker', title: 'One', sticker_count: 1 }),
        undefined,
        i18n
      )?.subtitle,
      '1 sticker'
    );
  });

  it('shows fixed text, the path and the badge on the official site card', () => {
    assert.deepEqual(
      getFirstPartyCardDisplay(
        {
          ...card({ type: 'official', path: '/download' }),
          domain: 'tellomi.app',
          official_badge: true,
        },
        undefined,
        i18n
      ),
      {
        type: 'official',
        title: 'Tellomi website',
        subtitle: '/download',
        action: 'Open',
        officialBadge: true,
      }
    );
  });

  it('is not a first-party card at any other level', () => {
    assert.isUndefined(
      getFirstPartyCardDisplay({ ...GROUP, level: 'generic' }, undefined, i18n)
    );
    assert.isUndefined(getFirstPartyCardDisplay(BASE, undefined, i18n));
  });
});

describe('getFirstPartyLookupKeys', () => {
  it('looks a user up by the username the URL names', () => {
    assert.deepEqual(
      getFirstPartyLookupKeys(
        'https://tell.cc/Kefu.57',
        card({ type: 'user', display: '@Kefu.57', username: 'Kefu.57' })
      ),
      { username: 'kefu.57' }
    );
    assert.deepEqual(
      getFirstPartyLookupKeys(
        'https://tell.cc/u#eu/abc',
        card({ type: 'user', display: null, username: null })
      ),
      {}
    );
  });

  it('looks a group up by its invite link', () => {
    assert.deepEqual(
      getFirstPartyLookupKeys('https://tell.cc/g#CjQKIA-invite_code', GROUP),
      { groupInviteCode: 'CjQKIA-invite_code' }
    );
    assert.deepEqual(
      getFirstPartyLookupKeys('https://signal.group/#CjQKIA', GROUP),
      { groupInviteCode: 'CjQKIA' }
    );
    assert.deepEqual(getFirstPartyLookupKeys('https://tell.cc/g', GROUP), {});
  });

  it('looks a sticker pack up by its id', () => {
    const packId = '0123456789abcdef0123456789abcdef';
    assert.deepEqual(
      getFirstPartyLookupKeys(
        `https://tell.cc/s#pack_id=${packId}&pack_key=${'ab'.repeat(32)}`,
        STICKER
      ),
      { stickerPackId: packId }
    );
    assert.deepEqual(
      getFirstPartyLookupKeys(
        'https://tell.cc/s#pack_id=not-hex&pack_key=00',
        STICKER
      ),
      {}
    );
  });

  it('has nothing to look up for calls, the official site or other cards', () => {
    assert.deepEqual(
      getFirstPartyLookupKeys(
        'https://tell.cc/call#key=bcdf-ghkm',
        card({ type: 'call', title: null })
      ),
      {}
    );
    assert.deepEqual(
      getFirstPartyLookupKeys('https://tell.cc/g#abc', {
        ...GROUP,
        level: 'generic',
      }),
      {}
    );
  });
});
