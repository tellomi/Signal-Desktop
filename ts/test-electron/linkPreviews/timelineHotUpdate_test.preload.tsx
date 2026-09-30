// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { PrivateKey } from '@signalapp/libsignal-client';
import { ipcRenderer } from 'electron';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Provider } from 'react-redux';

import {
  getLinkRegistryVersion,
  reloadLinkRegistry,
  _setLinkRegistryForTesting,
} from '../../linkPreviews/linkRegistry.preload.ts';
import { createStore } from '../../state/createStore.preload.ts';
import type { TimelineItemType } from '../../components/conversation/TimelineItem.dom.tsx';
import { useTimelineItem } from '../../state/selectors/timeline.preload.ts';
import {
  BUNDLED_VERSION,
  makeBilibiliBrandUpdate,
  makeOldStructuredVideoState,
  setUpHotUpdateEnvironment,
} from '../../test-helpers/linkRegistryHotUpdate.preload.ts';

// ADR-0063 §5.4 row 3, §8.4 third bullet, in a real Chromium: a message that is already on screen
// (a timeline item mounted through the real `useTimelineItem` hook, on a real redux store) is drawn
// again with the new registry when a hot update makes its provider a brand shell. Only the hook, the
// store and the registry are real here; the message component is not needed to see the card.

const key = PrivateKey.generate();
const otherKey = PrivateKey.generate();

function levelOf(item: TimelineItemType | undefined): string {
  if (item?.type !== 'message') {
    return `not a message (${item?.type})`;
  }
  return item.data.previews?.[0]?.card?.level ?? 'no card';
}

// The updates that come from an external store are applied at the end of the current task.
const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// What the main process does after it stored an update (app/linkRegistryUpdater.main.ts): tells every
// window. `ipcRenderer` is the renderer's own event emitter, so emitting the event runs the listener
// the registry module registered for it, the way a message from the main process would.
const tellRendererAboutUpdate = () => ipcRenderer.emit('link-registry-updated');

describe('a hot update of the link registry, on a mounted timeline item', () => {
  let environment: ReturnType<typeof setUpHotUpdateEnvironment>;
  let container: HTMLElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    environment = setUpHotUpdateEnvironment(key);
    _setLinkRegistryForTesting(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    _setLinkRegistryForTesting(undefined);
    environment.restore();
  });

  function mount() {
    const { state, messageId, conversationId } = makeOldStructuredVideoState();
    const store = createStore(state);
    const seen: Array<string> = [];
    function Probe(): JSX.Element | null {
      const item = useTimelineItem(messageId, conversationId);
      seen.push(levelOf(item));
      return null;
    }
    flushSync(() =>
      root.render(
        <Provider store={store}>
          <Probe />
        </Provider>
      )
    );
    return seen;
  }

  it('draws the old message as a structured card, and after the update as the brand shell only', async () => {
    const seen = mount();
    assert.strictEqual(seen.at(-1), 'structured');
    assert.notInclude(seen, 'brand');

    // The registry is in use from the first draw on, and so is the listener for the main process.
    assert.strictEqual(getLinkRegistryVersion(), String(BUNDLED_VERSION));
    environment.install(makeBilibiliBrandUpdate(key));
    tellRendererAboutUpdate();
    await nextTask();

    assert.strictEqual(getLinkRegistryVersion(), String(BUNDLED_VERSION + 1n));
    assert.strictEqual(
      seen.at(-1),
      'brand',
      `the levels drawn: ${seen.join(', ')}`
    );
  });

  it('does not draw it again for an update that does not pass', async () => {
    const seen = mount();
    const drawn = seen.length;

    environment.install(makeBilibiliBrandUpdate(otherKey));
    reloadLinkRegistry();
    await nextTask();

    assert.lengthOf(seen, drawn);
    assert.strictEqual(seen.at(-1), 'structured');
  });

  it('does not draw it again for a check that finds nothing new', async () => {
    const seen = mount();
    environment.install(makeBilibiliBrandUpdate(key));
    reloadLinkRegistry();
    await nextTask();
    const drawn = seen.length;

    // The same registry again: nothing changed, nothing is drawn.
    reloadLinkRegistry();
    await nextTask();
    assert.lengthOf(seen, drawn);
    assert.strictEqual(seen.at(-1), 'brand');
  });
});
