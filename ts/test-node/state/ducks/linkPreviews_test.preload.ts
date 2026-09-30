// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  actions,
  getEmptyState,
  reducer,
} from '../../../state/ducks/linkPreviews.preload.ts';
import { LinkPreviewSourceType } from '../../../types/LinkPreview.std.ts';
import type { LinkPreviewForUIType } from '../../../types/message/LinkPreviews.std.ts';

describe('both/state/ducks/linkPreviews', () => {
  function getMockLinkPreview(): LinkPreviewForUIType {
    return {
      title: 'Hello World',
      domain: 'signal.org',
      image: undefined,
      url: 'https://www.signal.org',
      isStickerPack: false,
      isCallLink: false,
    };
  }

  describe('addLinkPreview', () => {
    const { addLinkPreview } = actions;

    it('updates linkPreview', () => {
      const state = getEmptyState();
      const linkPreview = getMockLinkPreview();
      const nextState = reducer(state, addLinkPreview(linkPreview, 1));

      assert.deepEqual(nextState.linkPreview, linkPreview);
    });
  });

  // Tellomi (ADR-0063 §5.1 rule 2, §8.1 row 4): an inactive group link is staged as the URL and
  // the flag, so the composer says so instead of showing a preview (and there is nothing to send).
  describe('showGroupLinkInactive', () => {
    const { showGroupLinkInactive } = actions;
    const url = 'https://tell.cc/g#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    it('stages the URL with the flag and nothing else', () => {
      const nextState = reducer(
        getEmptyState(),
        showGroupLinkInactive(url, LinkPreviewSourceType.Composer, 'convo')
      );

      assert.deepEqual(nextState.linkPreview, {
        url,
        isStickerPack: false,
        isCallLink: false,
        isGroupLinkInactive: true,
      });
      assert.strictEqual(nextState.source, LinkPreviewSourceType.Composer);
    });

    it('replaces the preview that was staged', () => {
      const state = {
        ...getEmptyState(),
        linkPreview: getMockLinkPreview(),
      };
      const nextState = reducer(
        state,
        showGroupLinkInactive(url, LinkPreviewSourceType.ForwardMessageModal)
      );

      assert.isTrue(nextState.linkPreview?.isGroupLinkInactive);
      assert.isUndefined(nextState.linkPreview?.title);
      assert.isUndefined(nextState.linkPreview?.domain);
    });
  });

  describe('removeLinkPreview', () => {
    const { removeLinkPreview } = actions;

    it('removes linkPreview', () => {
      const state = {
        ...getEmptyState(),
        linkPreview: getMockLinkPreview(),
      };
      const nextState = reducer(state, removeLinkPreview());

      assert.isUndefined(nextState.linkPreview);
    });
  });
});
