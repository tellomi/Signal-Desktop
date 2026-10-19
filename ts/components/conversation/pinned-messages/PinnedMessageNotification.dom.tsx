// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, type JSX } from 'react';
import type { ConversationType } from '../../../state/ducks/conversations.preload.ts';
import type { LocalizerType } from '../../../types/Util.std.ts';
import { I18n } from '../../I18n.dom.tsx';
import { SystemMessage } from '../SystemMessage.dom.tsx';
import { UserText } from '../../UserText.dom.tsx';
import { Button, ButtonSize, ButtonVariant } from '../../Button.dom.tsx';
import type { PinMessageData } from '../../../model-types.d.ts';
import type { DurationInSeconds } from '../../../util/durations/duration-in-seconds.std.ts';
import type { TellomiPinSubject } from '../../../util/tellomiPinNotice.std.ts';
import { getTellomiPinSubjectText } from '../../../util/tellomiPinNotice.std.ts';

export type PinnedMessageNotificationData = Readonly<{
  sender: ConversationType;
  pinMessage: PinMessageData;
  // Tellomi (ADR-0081 §4.4): what the pinned message is; null = "a message".
  tellomiSubject: TellomiPinSubject | null;
  expireTimer: DurationInSeconds | null;
  expirationStartTimestamp: number | null;
}>;

export type PinnedMessageNotificationProps = PinnedMessageNotificationData &
  Readonly<{
    i18n: LocalizerType;
    onScrollToPinnedMessage: (pinMessage: PinMessageData) => void;
  }>;

export function PinnedMessageNotification(
  props: PinnedMessageNotificationProps
): JSX.Element {
  const { i18n, sender, pinMessage, onScrollToPinnedMessage, tellomiSubject } =
    props;
  // Tellomi (ADR-0081 §4.4, pinned-messages.md 3.2): "×× pinned “first 15 characters…”", "You pinned a photo", or
  // "×× pinned a message" when it is gone — the same line as the left pane, notifications and the phones.
  const subject = (
    <UserText
      text={getTellomiPinSubjectText(i18n, tellomiSubject ?? undefined)}
    />
  );

  const onClick = useCallback(() => {
    onScrollToPinnedMessage(pinMessage);
  }, [onScrollToPinnedMessage, pinMessage]);

  return (
    <SystemMessage
      symbol="pin"
      expireTimer={props.expireTimer}
      expirationStartTimestamp={props.expirationStartTimestamp}
      contents={
        sender.isMe ? (
          <I18n
            id="icu:TellomiPinNotice__YouPinned"
            components={{ subject }}
            i18n={i18n}
          />
        ) : (
          <I18n
            id="icu:TellomiPinNotice__SomeonePinned"
            components={{
              sender: <UserText text={sender.title} />,
              subject,
            }}
            i18n={i18n}
          />
        )
      }
      button={
        <Button
          onClick={onClick}
          size={ButtonSize.Small}
          variant={ButtonVariant.SystemMessage}
        >
          {i18n('icu:PinnedMessageNotification__Button')}
        </Button>
      }
    />
  );
}
