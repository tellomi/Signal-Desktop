// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { assert } from 'chai';
import type { ParsedSignalRoute } from '../../util/signalRoutes.std.ts';
import {
  isSignalRoute,
  parseSignalRoute,
  toSignalRouteAppUrl,
  toSignalRouteUrl,
  toSignalRouteWebUrl,
} from '../../util/signalRoutes.std.ts';

describe('signalRoutes', () => {
  type CheckConfig = {
    hasAppUrl: boolean;
    hasWebUrl: boolean;
    isRoute: boolean;
  };

  function createCheck(options: Partial<CheckConfig> = {}) {
    const config: CheckConfig = {
      hasAppUrl: true,
      hasWebUrl: true,
      isRoute: true,
      ...options,
    };
    // Different than `isRoute` because of normalization
    const hasRouteUrl = config.hasAppUrl || config.hasWebUrl;
    return function check(input: string, expected: ParsedSignalRoute | null) {
      const url = new URL(input);
      assert.deepEqual(parseSignalRoute(url), expected);
      assert.deepEqual(isSignalRoute(url), config.isRoute);
      assert.deepEqual(toSignalRouteUrl(url) != null, hasRouteUrl);
      assert.deepEqual(toSignalRouteAppUrl(url) != null, config.hasAppUrl);
      assert.deepEqual(toSignalRouteWebUrl(url) != null, config.hasWebUrl);
    };
  }

  const foo = 'FoO.bAr-BaZ_123/456';
  const fooNoSlash = 'FoO.bAr-BaZ_123';

  it('nonsense', () => {
    const check = createCheck({
      isRoute: false,
      hasAppUrl: false,
      hasWebUrl: false,
    });
    // Charles Entertainment Cheese, what are you doing here?
    check('https://www.chuckecheese.com/#p/+1234567890', null);
    // Non-route signal urls
    check('https://tell.cc', null);
    check('tellomi://tell.cc/#p', null);
    check('tellomi://tell.cc/#p/', null);
    check('tellomi://tell.cc/u/p/+1234567890', null);
    check('https://tell.cc/u?p/+1234567890', null);
    check('https://tell.cc/#p/+1234567890', null);
  });

  it('normalize', () => {
    const check = createCheck({ isRoute: false, hasAppUrl: true });
    check('http://username:password@tell.cc:8888/u#p/+1234567890', null);
  });

  it('contactByPhoneNumber', () => {
    const result: ParsedSignalRoute = {
      key: 'contactByPhoneNumber',
      args: { phoneNumber: '+1234567890' },
    };
    const check = createCheck();
    check('https://tell.cc/u#p/+1234567890', result);
    check('https://tell.cc/u/#p/+1234567890', result);
    check('tellomi://tell.cc/u#p/+1234567890', result);
    check('tellomi://tell.cc/u/#p/+1234567890', result);
  });

  it('contactByEncryptedUsername', () => {
    const result: ParsedSignalRoute = {
      key: 'contactByEncryptedUsername',
      args: { encryptedUsername: foo },
    };
    const check = createCheck();
    check(`https://tell.cc/u#eu/${foo}`, result);
    check(`https://tell.cc/u/#eu/${foo}`, result);
    check(`tellomi://tell.cc/u#eu/${foo}`, result);
    check(`tellomi://tell.cc/u/#eu/${foo}`, result);
  });

  it('contactByUsername', () => {
    const result: ParsedSignalRoute = {
      key: 'contactByUsername',
      args: { username: 'ceshi.57' },
    };
    const check = createCheck();
    check('https://tell.cc/u#u/ceshi.57', result);
    check('https://tell.cc/u/#u/ceshi.57', result);
    check('tellomi://tell.cc/u#u/ceshi.57', result);
    const invalid = createCheck({ isRoute: false, hasAppUrl: false, hasWebUrl: false });
    invalid('https://tell.cc/u#u/nope', null);   // 用户名必须带 .数字 后缀
    invalid('https://tell.cc/u#u/', null);
  });

  it('legacy Signal forms still parse (per-client migration)', () => {
    const check = createCheck();
    check('https://signal.me/#p/+1234567890', { key: 'contactByPhoneNumber', args: { phoneNumber: '+1234567890' } });
    check('sgnl://signal.me/#p/+1234567890', { key: 'contactByPhoneNumber', args: { phoneNumber: '+1234567890' } });
    check(`https://signal.me/#eu/${foo}`, { key: 'contactByEncryptedUsername', args: { encryptedUsername: foo } });
    check(`https://signal.group/#${fooNoSlash}`, { key: 'groupInvites', args: { inviteCode: fooNoSlash } });
    check(`sgnl://signal.group/#${fooNoSlash}`, { key: 'groupInvites', args: { inviteCode: fooNoSlash } });
    const appOnly = createCheck({ hasWebUrl: false });
    appOnly(`sgnl://linkdevice?uuid=${foo}&pub_key=${foo}`, { key: 'linkDevice', args: { uuid: foo, pubKey: foo, capabilities: [] } });
    check(`https://signal.link/call/#key=${foo}`, { key: 'linkCall', args: { key: foo } });
    check(`https://signal.art/addstickers/#pack_id=${foo}&pack_key=${foo}`, { key: 'artAddStickers', args: { packId: foo, packKey: foo } });
    appOnly('signalcaptcha://123', { key: 'captcha', args: { captchaId: '123' } });
  });

  it('groupInvites', () => {
    const result: ParsedSignalRoute = {
      key: 'groupInvites',
      args: { inviteCode: fooNoSlash },
    };
    const check = createCheck();
    check(`https://tell.cc/g#${fooNoSlash}`, result);
    check(`https://tell.cc/g#${fooNoSlash}`, result);
    check(`tellomi://tell.cc/g#${fooNoSlash}`, result);
    check(`tellomi://tell.cc/g#${fooNoSlash}`, result);
    check(`tellomi://joingroup/#${fooNoSlash}`, result);
    check(`tellomi://joingroup#${fooNoSlash}`, result);
  });

  it('linkDevice without capabilities', () => {
    const result: ParsedSignalRoute = {
      key: 'linkDevice',
      args: { uuid: foo, pubKey: foo, capabilities: [] },
    };
    const check = createCheck({ hasWebUrl: false });
    check(`tellomi://linkdevice/?uuid=${foo}&pub_key=${foo}`, result);
    check(`tellomi://linkdevice?uuid=${foo}&pub_key=${foo}`, result);
  });

  it('linkDevice with one capability', () => {
    const result: ParsedSignalRoute = {
      key: 'linkDevice',
      args: { uuid: foo, pubKey: foo, capabilities: ['backup'] },
    };
    const check = createCheck({ hasWebUrl: false });
    check(
      `tellomi://linkdevice/?uuid=${foo}&pub_key=${foo}&capabilities=backup`,
      result
    );
  });

  it('linkDevice with multiple capabilities', () => {
    const result: ParsedSignalRoute = {
      key: 'linkDevice',
      args: { uuid: foo, pubKey: foo, capabilities: ['a', 'b'] },
    };
    const check = createCheck({ hasWebUrl: false });
    check(
      `tellomi://linkdevice/?uuid=${foo}&pub_key=${foo}&capabilities=a%2Cb`,
      result
    );
  });

  it('captcha', () => {
    const captchaId =
      'signal-hcaptcha.Foo-bAr_baz.challenge.fOo-bAR_baZ.fOO-BaR_baz';
    const result: ParsedSignalRoute = {
      key: 'captcha',
      args: { captchaId },
    };
    const check = createCheck({ hasWebUrl: false });
    check(`tellomicaptcha://${captchaId}`, result);
  });

  it('captcha with a trailing slash', () => {
    const captchaId =
      'signal-hcaptcha.Foo-bAr_baz.challenge.fOo-bAR_baZ.fOO-BaR_baz';
    const result: ParsedSignalRoute = {
      key: 'captcha',
      args: { captchaId },
    };
    const check = createCheck({ hasWebUrl: false });
    check(`tellomicaptcha://${captchaId}/`, result);
  });

  it('linkCall', () => {
    const result: ParsedSignalRoute = {
      key: 'linkCall',
      args: { key: foo },
    };
    const check = createCheck();
    check(`https://tell.cc/call/#key=${foo}`, result);
    check(`https://tell.cc/call#key=${foo}`, result);
    check(`tellomi://tell.cc/call/#key=${foo}`, result);
    check(`tellomi://tell.cc/call#key=${foo}`, result);
  });

  it('artAddStickers', () => {
    const result: ParsedSignalRoute = {
      key: 'artAddStickers',
      args: { packId: foo, packKey: foo },
    };
    const check = createCheck();
    check(
      `https://tell.cc/s/#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    check(
      `https://tell.cc/s#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    check(`tellomi://addstickers/?pack_id=${foo}&pack_key=${foo}`, result);
    check(`tellomi://addstickers?pack_id=${foo}&pack_key=${foo}`, result);
  });

  it('showConversation', () => {
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    const args1 = `token=${foo}`;
    const result1: ParsedSignalRoute = {
      key: 'showConversation',
      args: { token: foo },
    };
    check(`tellomi://show-conversation/?${args1}`, result1);
    check(`tellomi://show-conversation?${args1}`, result1);
  });

  it('startCallLobby', () => {
    const result: ParsedSignalRoute = {
      key: 'startCallLobby',
      args: { token: foo },
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check(`tellomi://start-call-lobby/?token=${foo}`, result);
    check(`tellomi://start-call-lobby?token=${foo}`, result);
  });

  it('showWindow', () => {
    const result: ParsedSignalRoute = {
      key: 'showWindow',
      args: {},
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check('tellomi://show-window/', result);
    check('tellomi://show-window', result);
  });

  it('cancelPresenting', () => {
    const result: ParsedSignalRoute = {
      key: 'cancelPresenting',
      args: {},
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check('tellomi://cancel-presenting/', result);
    check('tellomi://cancel-presenting', result);
  });
});
