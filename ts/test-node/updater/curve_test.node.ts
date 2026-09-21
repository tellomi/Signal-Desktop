// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import config from 'config';
import { sign, verify } from '../../updater/curve.node.ts';
import { keyPair } from '../../test-helpers/keyPair.node.ts';

describe('updater/curve', () => {
  it('roundtrips', () => {
    const message = Buffer.from('message');
    const { publicKey, privateKey } = keyPair();
    const signature = sign(privateKey, message);
    const verified = verify(publicKey, message, signature);

    assert.strictEqual(verified, true);
  });

  // Tellomi：签名用我们自己的更新密钥（scripts/tellomi/sign-update.mjs 同一把）重算，公钥 = config updatesPublicKey
  it('verifies with our own key', () => {
    const message = Buffer.from(
      '7761a7761eccc0af7ab67546ec044e40dd1e9762f03d0c504d53fb40ceba5738-1.40.0-beta.3'
    );
    const signature = Buffer.from(
      '993d6582ad3d4713e9f0ad2b65123abd131a014a5e0472beef22fe8368d001f20bdc33956bfccd74a2a4f7ef585c175d5bc26091ecdf4ec26b3842e199fb6005',
      'hex'
    );
    const publicKey = Buffer.from(
      config.get<string>('updatesPublicKey'),
      'hex'
    );

    const verified = verify(publicKey, message, signature);

    assert.strictEqual(verified, true);
  });
});
