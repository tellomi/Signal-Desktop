// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useCallback, useRef, useMemo, useState, type JSX } from 'react';
import { useSelector } from 'react-redux';
import { isEqual } from 'lodash';

import { Timeline } from '../../components/conversation/Timeline.dom.tsx';
import { useCallingActions } from '../ducks/calling.preload.ts';
import { useConversationsActions } from '../ducks/conversations.preload.ts';
import { getPreferredBadgeSelector } from '../selectors/badges.preload.ts';
import {
  getConversationMessagesSelector,
  getConversationSelector,
  getHasContactSpoofingReview,
  getInvitedContactsForNewlyCreatedGroup,
  getMessages,
  getTargetedMessage,
} from '../selectors/conversations.dom.ts';
import { getSelectedConversationId } from '../selectors/nav.std.ts';
import { getIntl, getTheme } from '../selectors/user.std.ts';
import { SmartContactSpoofingReviewDialog } from './ContactSpoofingReviewDialog.preload.tsx';
import { SmartHeroRow } from './HeroRow.preload.tsx';
import { SmartTimelineItem } from './TimelineItem.preload.tsx';
import { SmartTypingBubble } from './TypingBubble.preload.tsx';
import { AttachmentDownloadManager } from '../../jobs/AttachmentDownloadManager.preload.ts';
import { getActiveCall, getCallSelector } from '../selectors/calling.std.ts';
import { getMidnight } from '../../types/NotificationProfile.std.ts';

import type { PropsType as SmartContactSpoofingReviewDialogPropsType } from './ContactSpoofingReviewDialog.preload.tsx';
import type { RenderItemProps } from './TimelineItem.preload.tsx';
import { getCallHistorySelector } from '../selectors/callHistory.std.ts';
import { getCallIdFromEra } from '../../util/callDisposition.preload.ts';
import { mapItemsIntoCollapseSets } from '../../util/CollapseSet.std.ts';
import {
  isTellomiPinNoticeHidden,
  withoutTellomiHiddenItems,
} from '../../util/tellomiPinNoticeActions.std.ts';
import type { CollapseSet } from '../../util/CollapseSet.std.ts';
import { isSignalConversation } from '../../util/isSignalConversation.dom.ts';
import { getIsInFullScreenCall } from '../selectors/isInFullScreenCall.std.ts';
import { TellomiJumpToDateContext } from '../../components/conversation/TellomiJumpToDateContext.dom.tsx';
import { TellomiJumpToDateDialog } from '../../components/conversation/TellomiJumpToDateDialog.dom.tsx';
import {
  buildDaysWithMessagesSet,
  jumpLowerBoundMs,
} from '../../util/tellomiJumpToDate.std.ts';
import { loadTellomiCalendarDayThumbnails } from '../../util/tellomiCalendarDayThumbnails.preload.ts';
import { DataReader } from '../../sql/Client.preload.ts';
import { isGroup } from '../../util/whatTypeOfConversation.dom.ts';
import { drop } from '../../util/drop.std.ts';

type ExternalProps = {
  id: string;
};

function renderItem(props: RenderItemProps): JSX.Element {
  return (
    <SmartTimelineItem key={props.item.id} {...props} renderItem={renderItem} />
  );
}

function renderContactSpoofingReviewDialog(
  props: SmartContactSpoofingReviewDialogPropsType
): JSX.Element {
  return <SmartContactSpoofingReviewDialog {...props} />;
}

function renderHeroRow(id: string): JSX.Element {
  return <SmartHeroRow id={id} />;
}
function renderTypingBubble(conversationId: string): JSX.Element {
  return <SmartTypingBubble conversationId={conversationId} />;
}

export const SmartTimeline = memo(function SmartTimeline({
  id,
}: ExternalProps) {
  const conversationMessagesSelector = useSelector(
    getConversationMessagesSelector
  );
  const conversationSelector = useSelector(getConversationSelector);
  const getPreferredBadge = useSelector(getPreferredBadgeSelector);
  const hasContactSpoofingReview = useSelector(getHasContactSpoofingReview);
  const i18n = useSelector(getIntl);
  const invitedContactsForNewlyCreatedGroup = useSelector(
    getInvitedContactsForNewlyCreatedGroup
  );
  const messages = useSelector(getMessages);
  const selectedConversationId = useSelector(getSelectedConversationId);
  const targetedMessage = useSelector(getTargetedMessage);
  const theme = useSelector(getTheme);
  const isInFullScreenCall = useSelector(getIsInFullScreenCall);
  const conversation = conversationSelector(id);
  const conversationMessages = conversationMessagesSelector(id);
  const callHistorySelector = useSelector(getCallHistorySelector);
  const activeCall = useSelector(getActiveCall);
  const callSelector = useSelector(getCallSelector);

  const {
    clearInvitedServiceIdsForNewlyCreatedGroup,
    clearTargetedMessage,
    closeContactSpoofingReview,
    discardMessages,
    loadNewerMessages,
    loadNewestMessages,
    loadOlderMessages,
    markMessageRead,
    scrollToOldestUnreadMention,
    scrollToOldestUnreadReaction,
    jumpToConversationDate,
    markReactionsReadForVisibleMessages,
    setCenterMessage,
    setIsNearBottom,
    targetMessage,
  } = useConversationsActions();
  const { maybePeekGroupCall } = useCallingActions();

  const getTimestampForMessage = useCallback(
    (messageId: string): undefined | number => {
      return messages[messageId]?.timestamp;
    },
    [messages]
  );

  const {
    acceptedMessageRequest,
    isBlocked = false,
    isGroupV1AndDisabled,
    terminated: isGroupTerminated = false,
    removalStage,
    typingContactIdTimestamps = {},
    unreadCount,
    unreadMentionsCount,
    unreadReactionsCount,
    type: conversationType,
  } = conversation ?? {};
  const {
    haveNewest,
    haveOldest,
    isNearBottom,
    items,
    messageChangeCounter,
    messageLoadingState,
    oldestUnseenIndex,
    scrollToIndex,
    scrollToIndexCounter,
    totalUnseen,
  } = conversationMessages;

  const previousCollapseSet = useRef<Array<CollapseSet> | undefined>(undefined);
  // oxlint-disable-next-line react/purity
  const midnightToday = getMidnight(Date.now());
  const { collapseSets, updatedOldestLastSeenIndex, updatedScrollToIndex } =
    useMemo(() => {
      // Tellomi (ADR-0081 §九 P5): a pin's chat event deleted for everyone leaves nothing behind
      const shown = withoutTellomiHiddenItems({
        items,
        isHidden: itemId => {
          const message = messages[itemId];
          return message != null && isTellomiPinNoticeHidden(message);
        },
        oldestUnseenIndex: oldestUnseenIndex ?? null,
        scrollToIndex: scrollToIndex ?? null,
      });
      const result = mapItemsIntoCollapseSets({
        activeCall,
        allowMultidaySets: false,
        callHistorySelector,
        callSelector,
        getCallIdFromEra,
        items: shown.items,
        messages,
        midnightToday,
        oldestUnseenIndex: shown.oldestUnseenIndex,
        scrollToIndex: shown.scrollToIndex,
      });

      const { resultUnseenIndex, resultScrollToIndex } = result;
      let { resultSets } = result;

      // Params messages changes a lot, items less often, call selectors possibly a lot.
      // But we need to massage items based on the values from these params. So, if we
      // generate the same data, we would like to return the same object.
      if (
        // oxlint-disable-next-line react/refs
        previousCollapseSet.current &&
        // oxlint-disable-next-line react/refs
        isEqual(resultSets, previousCollapseSet.current)
      ) {
        // oxlint-disable-next-line react/refs
        resultSets = previousCollapseSet.current;
      }

      // oxlint-disable-next-line react/refs
      previousCollapseSet.current = resultSets;

      return {
        collapseSets: resultSets,
        updatedOldestLastSeenIndex: resultUnseenIndex,
        updatedScrollToIndex: resultScrollToIndex,
      };
    }, [
      activeCall,
      callHistorySelector,
      callSelector,
      items,
      messages,
      midnightToday,
      oldestUnseenIndex,
      scrollToIndex,
    ]);

  const isConversationSelected = selectedConversationId === id;
  const isIncomingMessageRequest =
    !acceptedMessageRequest && removalStage !== 'justNotification';
  const isSomeoneTyping = Object.keys(typingContactIdTimestamps).length > 0;
  const targetedMessageId = targetedMessage?.id;
  const isSignalConvo = isSignalConversation(conversation);

  // Tellomi (desktop audit 7.2 r2): calendar greys out days with no messages.
  const [jumpDialog, setJumpDialog] = useState<{
    timestamp: number;
    daysWithMessages: ReadonlySet<number>;
  } | null>(null);
  const onTapDateHeader = useCallback(
    (timestamp: number, isFloating: boolean) => {
      if (isFloating) {
        jumpToConversationDate(id, jumpLowerBoundMs(timestamp));
        return;
      }
      drop(
        (async () => {
          if (conversation == null) {
            return;
          }
          const dayTimestamps =
            await DataReader.getDaysWithMessagesForConversation(id, {
              includeStoryReplies: !isGroup(conversation),
            });
          setJumpDialog({
            timestamp,
            daysWithMessages: buildDaysWithMessagesSet(dayTimestamps),
          });
        })()
      );
    },
    [id, jumpToConversationDate, conversation]
  );
  const jumpContextValue = useMemo(
    () => ({ onTapDateHeader }),
    [onTapDateHeader]
  );
  const loadMonthThumbnails = useCallback(
    (startMs: number, endMs: number) => {
      const days = jumpDialog?.daysWithMessages;
      if (days == null) {
        return Promise.resolve([]);
      }
      return loadTellomiCalendarDayThumbnails({
        conversationId: id,
        startMs,
        endMs,
        daysWithMessages: days,
      });
    },
    [id, jumpDialog]
  );

  return (
    <TellomiJumpToDateContext.Provider value={jumpContextValue}>
      <Timeline
        clearInvitedServiceIdsForNewlyCreatedGroup={
          clearInvitedServiceIdsForNewlyCreatedGroup
        }
        clearTargetedMessage={clearTargetedMessage}
        closeContactSpoofingReview={closeContactSpoofingReview}
        conversationType={conversationType}
        discardMessages={discardMessages}
        getPreferredBadge={getPreferredBadge}
        getTimestampForMessage={getTimestampForMessage}
        hasContactSpoofingReview={hasContactSpoofingReview}
        haveNewest={haveNewest}
        haveOldest={haveOldest}
        i18n={i18n}
        id={id}
        invitedContactsForNewlyCreatedGroup={
          invitedContactsForNewlyCreatedGroup
        }
        isBlocked={isBlocked}
        isConversationSelected={isConversationSelected}
        isGroupV1AndDisabled={isGroupV1AndDisabled}
        isGroupTerminated={isGroupTerminated}
        isInFullScreenCall={isInFullScreenCall}
        isIncomingMessageRequest={isIncomingMessageRequest}
        isNearBottom={isNearBottom}
        isSignalConversation={isSignalConvo}
        isSomeoneTyping={isSomeoneTyping}
        items={collapseSets}
        loadNewerMessages={loadNewerMessages}
        loadNewestMessages={loadNewestMessages}
        loadOlderMessages={loadOlderMessages}
        markMessageRead={markMessageRead}
        maybePeekGroupCall={maybePeekGroupCall}
        messageChangeCounter={messageChangeCounter}
        messageLoadingState={messageLoadingState}
        updateVisibleMessages={
          AttachmentDownloadManager.updateVisibleTimelineMessages
        }
        oldestUnseenIndex={updatedOldestLastSeenIndex}
        renderContactSpoofingReviewDialog={renderContactSpoofingReviewDialog}
        renderHeroRow={renderHeroRow}
        renderItem={renderItem}
        renderTypingBubble={renderTypingBubble}
        scrollToIndex={updatedScrollToIndex}
        scrollToIndexCounter={scrollToIndexCounter}
        scrollToOldestUnreadMention={scrollToOldestUnreadMention}
        scrollToOldestUnreadReaction={scrollToOldestUnreadReaction}
        markReactionsReadForVisibleMessages={
          markReactionsReadForVisibleMessages
        }
        setCenterMessage={setCenterMessage}
        setIsNearBottom={setIsNearBottom}
        targetedMessageId={targetedMessageId}
        targetMessage={targetMessage}
        theme={theme}
        totalUnseen={totalUnseen}
        unreadCount={unreadCount}
        unreadMentionsCount={unreadMentionsCount}
        unreadReactionsCount={unreadReactionsCount}
      />
      {jumpDialog != null ? (
        <TellomiJumpToDateDialog
          open
          i18n={i18n}
          initialTimestamp={jumpDialog.timestamp}
          daysWithMessages={jumpDialog.daysWithMessages}
          loadMonthThumbnails={loadMonthThumbnails}
          onClose={() => setJumpDialog(null)}
          onJump={dayStartMs => {
            setJumpDialog(null);
            jumpToConversationDate(id, dayStartMs);
          }}
        />
      ) : null}
    </TellomiJumpToDateContext.Provider>
  );
});
