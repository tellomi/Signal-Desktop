// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { createRef, useContext } from 'react';
import type { JSX } from 'react';
import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';

import { StorybookThemeContext } from '../../../.storybook/StorybookThemeContext.std.ts';
import { ConversationColors } from '../../types/Colors.std.ts';
import { ReadStatus } from '../../messages/MessageReadStatus.std.ts';
import { LONG_MESSAGE } from '../../types/MIME.std.ts';
import { ThemeType } from '../../types/Util.std.ts';
import { getDefaultConversation } from '../../test-helpers/getDefaultConversation.std.ts';
import { SHEET_ROWS, SHEET_TINTS } from '../../storybook/linkCardSheet.std.ts';
import type { SheetCellType } from '../../storybook/linkCardSheet.std.ts';
import { WidthBreakpoint } from '../_util.std.ts';
import { MessageInteractivity, TextDirection } from './Message.dom.tsx';
import type { Props } from './TimelineMessage.dom.tsx';
import { TimelineMessage } from './TimelineMessage.dom.tsx';

const { i18n } = window.SignalContext;

// Tellomi (card-visual §3.11, ADR-0063 §8.1 row 6): the acceptance sheet of the link card. Every
// row of the §3.7 table, each in two states, "all fields" and "required fields only", drawn by the
// real message component from card data written out here (`ts/storybook/linkCardSheet.std.ts`;
// nothing is fetched). One story; its colours follow the theme picked in the Storybook toolbar, so
// the light and the dark sheet are the same story opened twice:
//   iframe.html?id=components-conversation-linkcardacceptance--contact-sheet&globals=theme:dark
export default {
  title: 'Components/Conversation/LinkCardAcceptance',
} satisfies Meta;

const createProps = (overrides: Partial<Props>): Props => ({
  attachmentDroppedDueToSize: false,
  author: getDefaultConversation(),
  canCopy: true,
  canEditMessage: true,
  canEndPoll: false,
  canPinMessage: true,
  canReact: true,
  canReply: true,
  canSendPollVote: true,
  canDownload: true,
  canDeleteForEveryone: false,
  canForward: true,
  canRetry: false,
  canRetryDeleteForEveryone: false,
  checkForAccount: action('checkForAccount'),
  clearTargetedMessage: action('clearSelectedMessage'),
  containerElementRef: createRef<HTMLElement | null>(),
  containerWidthBreakpoint: WidthBreakpoint.Wide,
  conversationColor: ConversationColors[0],
  conversationTitle: 'Conversation Title',
  conversationId: '',
  conversationType: 'direct',
  direction: 'incoming',
  showLightboxForViewOnceMedia: action('showLightboxForViewOnceMedia'),
  doubleCheckMissingQuoteReference: action('doubleCheckMissingQuoteReference'),
  expirationLength: 0,
  expirationTimestamp: 0,
  getPreferredBadge: () => undefined,
  handleDebugMessage: action('handleDebugMessage'),
  i18n,
  platform: 'darwin',
  id: 'link-card-sheet',
  interactivity: MessageInteractivity.Normal,
  interactionMode: 'mouse',
  isSticker: false,
  isBlocked: false,
  isMessageRequestAccepted: true,
  isPinned: false,
  isSelected: false,
  isSelectMode: false,
  isSignalConversation: false,
  isSMS: false,
  isSpoilerExpanded: {},
  isVoiceMessagePlayed: false,
  cancelAttachmentDownload: action('cancelAttachmentDownload'),
  kickOffAttachmentDownload: action('kickOffAttachmentDownload'),
  markAttachmentAsCorrupted: action('markAttachmentAsCorrupted'),
  messageExpanded: action('messageExpanded'),
  showConversation: action('showConversation'),
  openGiftBadge: action('openGiftBadge'),
  showPinMessageDialog: action('showPinMessageDialog'),
  onPinnedMessageRemove: action('onPinnedMessageRemove'),
  previews: [],
  endPoll: action('endPoll'),
  reactToMessage: action('reactToMessage'),
  readStatus: ReadStatus.Read,
  renderReactionPicker: () => <div />,
  renderAudioAttachment: () => <div />,
  saveAttachment: action('saveAttachment'),
  saveAttachments: action('saveAttachments'),
  setQuoteByMessageId: action('setQuoteByMessageId'),
  retryMessageSend: action('retryMessageSend'),
  sendPollVote: action('sendPollVote'),
  copyMessageText: action('copyMessageText'),
  retryDeleteForEveryone: action('retryDeleteForEveryone'),
  scrollToQuotedMessage: action('scrollToQuotedMessage'),
  targetMessage: action('targetMessage'),
  toggleSelectMessage: action('toggleSelectMessage'),
  setMessageToEdit: action('setMessageToEdit'),
  shouldCollapseAbove: false,
  shouldCollapseBelow: false,
  shouldHideMetadata: false,
  showSpoiler: action('showSpoiler'),
  pushPanelForConversation: action('pushPanelForConversation'),
  showContactModal: action('showContactModal'),
  showAttachmentDownloadStillInProgressToast: action(
    'showAttachmentDownloadStillInProgressToast'
  ),
  showExpiredIncomingTapToViewToast: action(
    'showExpiredIncomingTapToViewToast'
  ),
  showExpiredOutgoingTapToViewToast: action(
    'showExpiredOutgoingTapToViewToast'
  ),
  showMediaNoLongerAvailableToast: action('showMediaNoLongerAvailableToast'),
  showTapToViewNotAvailableModal: action('showTapToViewNotAvailableModal'),
  toggleDeleteMessagesModal: action('toggleDeleteMessagesModal'),
  toggleForwardMessagesModal: action('toggleForwardMessagesModal'),
  showLightbox: action('showLightbox'),
  startConversation: action('startConversation'),
  status: 'sent',
  text: '',
  textDirection: TextDirection.Default,
  textAttachment: {
    contentType: LONG_MESSAGE,
    size: 123,
    pending: false,
    isPermanentlyUndownloadable: false,
  },
  theme: ThemeType.light,
  timestamp: Date.now(),
  viewStory: action('viewStory'),
  ...overrides,
});

// One card, as a message that is just its link: the card is the bubble (card-visual §3.5).
function Cell({
  cell,
  cellId,
  theme,
}: Readonly<{
  cell: SheetCellType;
  cellId: string;
  theme: ThemeType;
}>): JSX.Element {
  // The answer rust/links gave for the picture the card draws itself with, if it has one.
  const tint = cell.pictureColor ? SHEET_TINTS[cell.pictureColor] : undefined;
  const { preview } = cell;
  return (
    <div>
      <div
        className="module-timeline--width-wide"
        data-cell={cellId}
        style={{ width: 480 }}
      >
        <TimelineMessage
          {...createProps({
            id: cellId,
            previews: [preview],
            text: preview.url,
            isLinkCardOnly: true,
            getLinkCardTint: () => tint,
            theme,
          })}
        />
      </div>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          opacity: 0.65,
          marginTop: 2,
        }}
      >
        {preview.card?.level} · {preview.card?.kind ?? 'no kind'} ·{' '}
        {preview.layout}
      </div>
    </div>
  );
}

export function ContactSheet(): JSX.Element {
  const theme = useContext(StorybookThemeContext);
  const border = `1px solid ${theme === ThemeType.dark ? '#3a3a3a' : '#d8d8d8'}`;
  const cellStyle = { padding: '12px 16px', verticalAlign: 'top', border };
  return (
    <div
      data-sheet={theme}
      style={{
        padding: 16,
        width: 'max-content',
        color: theme === ThemeType.dark ? '#e6e6e6' : '#1b1b1b',
      }}
    >
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cellStyle}>表 3.7 的行</th>
            <th style={cellStyle}>字段全</th>
            <th style={cellStyle}>只有必填</th>
          </tr>
        </thead>
        <tbody>
          {SHEET_ROWS.map(row => (
            <tr key={row.id}>
              <th scope="row" style={{ ...cellStyle, textAlign: 'start' }}>
                <div>{row.title}</div>
                <code style={{ fontSize: 11, opacity: 0.65 }}>{row.kind}</code>
              </th>
              <td style={cellStyle}>
                <Cell cell={row.full} cellId={`${row.id}.full`} theme={theme} />
              </td>
              <td style={cellStyle}>
                <Cell
                  cell={row.required}
                  cellId={`${row.id}.required`}
                  theme={theme}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
