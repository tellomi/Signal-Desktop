// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import sinon from 'sinon';
import type { Net } from '@signalapp/libsignal-client';

import { SocketManager } from '../../textsecure/SocketManager.preload.ts';

// Tellomi (tellomi/tellomi#1399): when the update manifest requires an update, Desktop goes read-only through
// SocketManager.onExpiration('tellomiUpdateRequired'). Unlike a build or remote expiry it can be lifted again (the
// manifest withdraws the requirement) and must not weaken a real expiry.

const CREDENTIALS = {
  username: 'ab12cd34-0000-4000-8000-000000000000.2',
  password: 'correct-horse-battery-staple',
};

describe('SocketManager: Tellomi update-required read-only', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function create() {
    // No socket is ever opened here: authenticate is stubbed and logout has no connection to drop.
    const manager = new SocketManager({} as unknown as Net.Net);
    const authenticate = sandbox.stub(manager, 'authenticate').resolves();
    return { manager, authenticate };
  }

  it('goes offline, then reconnects when lifted', async () => {
    const { manager, authenticate } = create();

    await manager.onExpiration('tellomiUpdateRequired');
    assert.isFalse(manager.isOnline);

    await manager.tellomiLiftUpdateRequired(CREDENTIALS);
    sinon.assert.calledOnceWithExactly(authenticate, CREDENTIALS);
  });

  it('lifting twice reconnects once', async () => {
    const { manager, authenticate } = create();

    await manager.onExpiration('tellomiUpdateRequired');
    await manager.tellomiLiftUpdateRequired(CREDENTIALS);
    await manager.tellomiLiftUpdateRequired(CREDENTIALS);
    sinon.assert.calledOnce(authenticate);
  });

  it('does nothing when it was never read-only', async () => {
    const { manager, authenticate } = create();

    await manager.tellomiLiftUpdateRequired(CREDENTIALS);
    sinon.assert.notCalled(authenticate);
  });

  it('never replaces a build expiry', async () => {
    const { manager, authenticate } = create();

    await manager.onExpiration('build');
    await manager.onExpiration('tellomiUpdateRequired');
    await manager.tellomiLiftUpdateRequired(CREDENTIALS);
    sinon.assert.notCalled(authenticate);
  });

  it('is overridden by a remote expiry, which lifting does not undo', async () => {
    const { manager, authenticate } = create();

    await manager.onExpiration('tellomiUpdateRequired');
    await manager.onExpiration('remote');
    await manager.tellomiLiftUpdateRequired(CREDENTIALS);
    sinon.assert.notCalled(authenticate);
  });
});
