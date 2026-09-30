// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { memoize } from '@indutny/sneequals';
import { PrivateKey } from '@signalapp/libsignal-client';

import {
  getLinkRegistryVersion,
  reloadLinkRegistry,
  _setLinkRegistryForTesting,
  subscribeToLinkRegistry,
} from '../../linkPreviews/linkRegistry.preload.ts';
import type { StateType } from '../../state/reducer.preload.ts';
import type { MessagePropsType } from '../../state/selectors/message.preload.ts';
import { getTimelineItem } from '../../state/selectors/timeline.preload.ts';
import {
  BUNDLED_VERSION,
  makeBilibiliBrandUpdate,
  makeOldStructuredVideoState,
  OLD_PREVIEW_TITLE,
  setUpHotUpdateEnvironment,
} from '../../test-helpers/linkRegistryHotUpdate.preload.ts';
import type { ContactNameColorType } from '../../types/Colors.std.ts';

// ADR-0063 §5.4 row 3, §8.1 row 3, §8.4 third bullet: on Desktop a hot update that drops a provider to
// a brand shell takes effect without a release: the sender stops fetching, and the receiver draws the
// old messages as the brand shell only. The level is decided at display time (§5.1 rule 4), but a
// message that is already on screen is a memoized timeline item (`useProxySelector` only looks at the
// parts of the state that were read, and the registry is not in the state), so it has to be told.
// These run the real store, the real rust/links and the real selector the timeline calls, over the
// registry that ships with the app and a really signed update. (The same thing in a real DOM, with the
// real hook, is ts/test-electron/linkPreviews/timelineHotUpdate_test.preload.tsx.)

const key = PrivateKey.generate();
const otherKey = PrivateKey.generate();
const COLORS = new Map<string, ContactNameColorType>();

function cardOf(item: ReturnType<typeof getTimelineItem>) {
  if (item?.type !== 'message') {
    throw new Error(`expected a message, got ${item?.type}`);
  }
  const data: MessagePropsType = item.data;
  const [preview] = data.previews ?? [];
  if (!preview?.card) {
    throw new Error('the message has no card');
  }
  return { card: preview.card, preview };
}

describe('a hot update of the link registry, on the timeline', () => {
  let environment: ReturnType<typeof setUpHotUpdateEnvironment>;
  let savedConversationController: typeof window.ConversationController;

  beforeEach(() => {
    environment = setUpHotUpdateEnvironment(key);
    savedConversationController = window.ConversationController;
    window.ConversationController = {
      getOurConversationId: () => 'us',
      isSignalConversationId: () => false,
    } as unknown as typeof window.ConversationController;
    _setLinkRegistryForTesting(undefined);
  });

  afterEach(() => {
    window.ConversationController = savedConversationController;
    _setLinkRegistryForTesting(undefined);
    environment.restore();
  });

  describe('the item as the hook drew it before: nothing about the registry in its arguments', () => {
    it('stays as it was after the update: the old card on screen', () => {
      const { state, messageId } = makeOldStructuredVideoState();
      const memoized = memoize((s: StateType, id: string) =>
        getTimelineItem(s, id, COLORS, '')
      );

      const first = memoized(state, messageId);
      assert.strictEqual(cardOf(first).card.level, 'structured');

      environment.install(makeBilibiliBrandUpdate(key));
      reloadLinkRegistry();
      assert.strictEqual(
        getLinkRegistryVersion(),
        String(BUNDLED_VERSION + 1n)
      );

      // Same state, same arguments: the memoized item is handed back, the bilibili card is still full.
      const second = memoized(state, messageId);
      assert.strictEqual(second, first);
      assert.strictEqual(cardOf(second).card.level, 'structured');
    });
  });

  describe('the item with the registry version among its arguments', () => {
    it('is drawn again after the update, as the brand shell only', () => {
      const { state, messageId } = makeOldStructuredVideoState();
      const memoized = memoize(getTimelineItem);

      const versionBefore = getLinkRegistryVersion();
      assert.strictEqual(versionBefore, String(BUNDLED_VERSION));
      const first = memoized(state, messageId, COLORS, versionBefore);
      const full = cardOf(first);
      assert.strictEqual(full.card.level, 'structured');
      assert.strictEqual(full.preview.title, OLD_PREVIEW_TITLE);
      assert.isDefined(full.preview.image);

      environment.install(makeBilibiliBrandUpdate(key));
      reloadLinkRegistry();

      const versionAfter = getLinkRegistryVersion();
      assert.strictEqual(versionAfter, String(BUNDLED_VERSION + 1n));
      const second = memoized(state, messageId, COLORS, versionAfter);
      assert.notStrictEqual(second, first);
      const brand = cardOf(second);
      assert.strictEqual(brand.card.level, 'brand');
      assert.strictEqual(brand.card.provider, 'bilibili');
      assert.strictEqual(brand.card.kind, 'video');
      assert.isNull(brand.card.title);
      assert.deepEqual(brand.card.attrs, []);
      assert.isFalse(brand.card.show_image);
      // The sender's own picture is not passed on any more.
      assert.isUndefined(brand.preview.image);

      // Nothing changed since: the same item again, no needless work.
      assert.strictEqual(
        memoized(state, messageId, COLORS, versionAfter),
        second
      );
    });

    it('is not drawn again for an update that does not pass', () => {
      const { state, messageId } = makeOldStructuredVideoState();
      const memoized = memoize(getTimelineItem);
      const version = getLinkRegistryVersion();
      const first = memoized(state, messageId, COLORS, version);

      environment.install(makeBilibiliBrandUpdate(otherKey));
      reloadLinkRegistry();

      assert.strictEqual(getLinkRegistryVersion(), version);
      const second = memoized(
        state,
        messageId,
        COLORS,
        getLinkRegistryVersion()
      );
      assert.strictEqual(second, first);
      assert.strictEqual(cardOf(second).card.level, 'structured');
    });
  });

  describe('the timeline is told', () => {
    it('once for an update that is taken, with the new version already in use', () => {
      getLinkRegistryVersion();
      const seen: Array<string> = [];
      const unsubscribe = subscribeToLinkRegistry(() => {
        seen.push(getLinkRegistryVersion());
      });
      try {
        environment.install(makeBilibiliBrandUpdate(key));
        reloadLinkRegistry();
        assert.deepEqual(seen, [String(BUNDLED_VERSION + 1n)]);

        // Asked again with nothing new: not told again.
        reloadLinkRegistry();
        assert.lengthOf(seen, 1);
      } finally {
        unsubscribe();
      }
    });

    it('not for an update that does not pass', () => {
      getLinkRegistryVersion();
      let told = 0;
      const unsubscribe = subscribeToLinkRegistry(() => {
        told += 1;
      });
      try {
        environment.install(makeBilibiliBrandUpdate(otherKey));
        reloadLinkRegistry();
        assert.strictEqual(told, 0);
        assert.strictEqual(getLinkRegistryVersion(), String(BUNDLED_VERSION));
      } finally {
        unsubscribe();
      }
    });

    it('not after it stopped listening', () => {
      getLinkRegistryVersion();
      let told = 0;
      subscribeToLinkRegistry(() => {
        told += 1;
      })();
      environment.install(makeBilibiliBrandUpdate(key));
      reloadLinkRegistry();
      assert.strictEqual(told, 0);
    });

    it('with the version as text, empty while there is no registry', () => {
      // Nothing to load from: no bundled file, so no registry and no version.
      const { installPath } = window.SignalContext.config as {
        installPath?: string;
      };
      (window.SignalContext.config as { installPath?: string }).installPath =
        `${environment.userDataPath}/nowhere`;
      try {
        _setLinkRegistryForTesting(undefined);
        assert.strictEqual(getLinkRegistryVersion(), '');
      } finally {
        (window.SignalContext.config as { installPath?: string }).installPath =
          installPath;
      }
    });
  });
});
