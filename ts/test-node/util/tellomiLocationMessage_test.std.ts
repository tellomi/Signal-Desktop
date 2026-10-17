// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  isTellomiLocationBody,
  isTellomiLocationMessage,
  isTellomiQuotedLocation,
  tellomiCoordinateFromMapsLink,
} from '../../util/tellomiLocationMessage.std.ts';

// Bodies as each client sends them (same as the iOS / Android tests).
const TELLOMI_PLACE =
  '星巴克臻选上海烘焙工坊\n静安区南京西路789号兴业太古汇\nhttps://maps.google.com/maps?q=31.2297%2C121.4560';
const SIGNAL_IOS =
  '中国\n上海市静安区\n南京西路789号\n\nhttps://maps.google.com/maps?q=31.2297%2C121.4560';
const SIGNAL_ANDROID =
  "789 Nanjing West Road, Jing'an, Shanghai\nhttps://maps.google.com/maps?q=31.2297%2C121.4560";

const JPEG = { contentType: 'image/jpeg' };

describe('Tellomi location message', () => {
  it('reads the coordinates from the maps link every client sends', () => {
    assert.deepEqual(
      tellomiCoordinateFromMapsLink(
        'https://maps.google.com/maps?q=31.2297%2C121.4560'
      ),
      { latitude: 31.2297, longitude: 121.456 }
    );
    assert.deepEqual(
      tellomiCoordinateFromMapsLink(
        'https://maps.google.com/maps?q=-33.9,18.4'
      ),
      { latitude: -33.9, longitude: 18.4 }
    );
  });

  it('does not take other links or broken coordinates', () => {
    for (const line of [
      'https://maps.example.com/maps?q=31.2,121.4',
      'https://maps.google.com/search?q=31.2,121.4',
      'https://maps.google.com/maps?q=31.2',
      'https://maps.google.com/maps?q=91,121.4',
      'https://maps.google.com/maps?q=0x1F,121.4',
      'https://maps.google.com/maps?q=,121.4',
      'ftp://maps.google.com/maps?q=31.2,121.4',
      'see https://maps.google.com/maps?q=31.2,121.4',
    ]) {
      assert.isUndefined(tellomiCoordinateFromMapsLink(line), line);
    }
  });

  it('reads all three clients’ bodies as locations', () => {
    assert.isTrue(isTellomiLocationBody(TELLOMI_PLACE));
    assert.isTrue(isTellomiLocationBody(SIGNAL_IOS));
    assert.isTrue(isTellomiLocationBody(SIGNAL_ANDROID));
    assert.isTrue(isTellomiLocationBody(`${SIGNAL_ANDROID}\n\n`));
  });

  it('leaves ordinary text alone, even with the link in it', () => {
    assert.isFalse(isTellomiLocationBody(undefined));
    assert.isFalse(isTellomiLocationBody('hello'));
    assert.isFalse(
      isTellomiLocationBody(
        'meet here https://maps.google.com/maps?q=31.2297%2C121.4560 at 5'
      )
    );
    assert.isFalse(
      isTellomiLocationBody(
        `${'a line\n'.repeat(7)}https://maps.google.com/maps?q=31.2,121.4`
      )
    );
  });

  it('a location message is exactly one still image with a location body', () => {
    assert.isTrue(isTellomiLocationMessage(TELLOMI_PLACE, [JPEG]));
    assert.isTrue(
      isTellomiLocationMessage(SIGNAL_IOS, [{ contentType: 'image/png' }])
    );
    assert.isFalse(isTellomiLocationMessage(TELLOMI_PLACE, []));
    assert.isFalse(isTellomiLocationMessage(TELLOMI_PLACE, [JPEG, JPEG]));
    assert.isFalse(
      isTellomiLocationMessage(TELLOMI_PLACE, [{ contentType: 'image/gif' }])
    );
    assert.isFalse(
      isTellomiLocationMessage(TELLOMI_PLACE, [{ contentType: 'video/mp4' }])
    );
    assert.isFalse(
      isTellomiLocationMessage(TELLOMI_PLACE, [
        { contentType: 'image/jpeg', tellomiLivePhotoVideo: {} },
      ])
    );
    assert.isFalse(isTellomiLocationMessage('Look at this', [JPEG]));
  });

  it('a quote of a location is its body with a still image', () => {
    assert.isTrue(isTellomiQuotedLocation(SIGNAL_ANDROID, JPEG));
    assert.isFalse(isTellomiQuotedLocation(SIGNAL_ANDROID, undefined));
    assert.isFalse(
      isTellomiQuotedLocation(SIGNAL_ANDROID, { contentType: 'video/mp4' })
    );
    assert.isFalse(isTellomiQuotedLocation('a caption', JPEG));
  });
});
