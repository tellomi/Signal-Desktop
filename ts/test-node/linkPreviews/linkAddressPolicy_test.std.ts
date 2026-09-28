// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { isBlockedLinkAddress } from '../../linkPreviews/linkAddressPolicy.std.ts';

// ADR-0063 §6.2 (tellomi/tellomi#1421): addresses a link-preview fetch never connects to.

describe('isBlockedLinkAddress', () => {
  it('blocks the private and local IPv4 ranges', () => {
    for (const address of [
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.1',
      '10.255.255.255',
      '100.64.1.1',
      '100.127.255.255',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      assert.isTrue(isBlockedLinkAddress(address), address);
    }
  });

  it('allows public IPv4, the edges just outside each range, and fake-ip 198.18/15', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '100.63.255.255',
      '100.128.0.1',
      '172.15.255.255',
      '172.32.0.1',
      '169.253.0.1',
      '192.167.0.1',
      '198.18.0.5',
      '198.19.255.255',
      '203.0.113.10',
    ]) {
      assert.isFalse(isBlockedLinkAddress(address), address);
    }
  });

  it('blocks local IPv6 and private IPv4 hidden inside IPv6', () => {
    for (const address of [
      '::',
      '::1',
      '[::1]',
      'fc00::1',
      'fd00::2',
      'fe80::1',
      'fe80::1%en0',
      'fec0::1',
      'ff02::1',
      '::ffff:192.168.0.1',
      '[::ffff:192.168.0.1]',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::10.0.0.1',
    ]) {
      assert.isTrue(isBlockedLinkAddress(address), address);
    }
  });

  it('allows public IPv6', () => {
    for (const address of [
      '2001:4860:4860::8888',
      '2400:3200::1',
      '::ffff:8.8.8.8',
      '64:ff9b::8.8.8.8',
    ]) {
      assert.isFalse(isBlockedLinkAddress(address), address);
    }
  });

  it('treats anything unparseable as blocked', () => {
    for (const address of [
      '',
      'example.com',
      '1.2.3',
      '1.2.3.256',
      '1::2::3',
      '12345::',
      '1:2:3:4:5:6:7:8:9',
    ]) {
      assert.isTrue(isBlockedLinkAddress(address), address);
    }
  });
});
