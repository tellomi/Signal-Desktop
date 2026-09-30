// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import { useEscapeHandling } from '../hooks/useEscapeHandling.dom.ts';
import { I18n } from './I18n.dom.tsx';
import {
  ABOUT_CONTACTS,
  ABOUT_SOURCE_URL,
  ABOUT_TERMS_URL,
  ABOUT_PRIVACY_URL,
  ABOUT_WEBSITE_URL,
} from '../util/tellomiAbout.std.ts';

const COPIED_MS = 2000;

export type AboutProps = Readonly<{
  closeAbout: () => unknown;
  appEnv: string;
  arch: string;
  platform: string;
  i18n: LocalizerType;
  version: string;
  // Tellomi (about-page.md §3.3): clicking an address copies it.
  copyText: (text: string) => Promise<void>;
}>;

export function About({
  closeAbout,
  appEnv,
  arch,
  platform,
  i18n,
  version,
  copyText,
}: AboutProps): JSX.Element {
  useEscapeHandling(closeAbout);

  const [copied, setCopied] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (address: string): Promise<void> => {
    try {
      await copyText(address);
    } catch {
      return;
    }
    setCopied(address);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(undefined), COPIED_MS);
  };

  let env: string;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      env = i18n('icu:About__AppEnvironment--AppleSilicon', { appEnv });
    } else {
      env = i18n('icu:About__AppEnvironment--AppleIntel', { appEnv });
    }
  } else {
    env = i18n('icu:About__AppEnvironment', { appEnv });
  }

  return (
    <div className="About">
      <div className="module-splash-screen">
        <div className="module-splash-screen__logo module-splash-screen__logo--128" />

        <h1 className="About__Title">{i18n('icu:signalDesktop')}</h1>
        <div className="About__Body version">{version}</div>
        <div className="About__Body environment">{env}</div>
        <br />
        <div className="About__Links">
          <div>
            <span className="About__ContactLabel">
              {i18n('icu:About__Website')}
            </span>{' '}
            <a className="website" href={ABOUT_WEBSITE_URL.href}>
              {ABOUT_WEBSITE_URL.host}
            </a>
          </div>
          {ABOUT_CONTACTS.map(contact => (
            <div key={contact.address} className="About__Contact">
              <span className="About__ContactLabel">{i18n(contact.label)}</span>{' '}
              <button
                type="button"
                className="About__CopyAddress"
                onClick={() => {
                  void copy(contact.address);
                }}
              >
                {contact.address}
              </button>
              {copied === contact.address ? (
                <span className="About__Copied" role="status">
                  {i18n('icu:About__Copied')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <br />
        <div className="About__Links">
          <div>
            <a className="terms" href={ABOUT_TERMS_URL}>
              {i18n('icu:About__Terms')}
            </a>
          </div>
          <div>
            <a className="privacy" href={ABOUT_PRIVACY_URL}>
              {i18n('icu:privacyPolicy')}
            </a>
          </div>
          <div>
            <a
              className="acknowledgments"
              href="https://github.com/tellomi/Signal-Desktop/blob/tellomi/ACKNOWLEDGMENTS.md"
            >
              {i18n('icu:softwareAcknowledgments')}
            </a>
          </div>
        </div>
        <br />
        <div className="About__Source">
          <I18n
            i18n={i18n}
            id="icu:About__SourceCode"
            components={{
              sourceLink: (
                <a className="source" href={ABOUT_SOURCE_URL}>
                  {ABOUT_SOURCE_URL.replace('https://', '')}
                </a>
              ),
            }}
          />
        </div>
      </div>
    </div>
  );
}
