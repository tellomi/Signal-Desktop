// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useMemo, useState, type JSX } from 'react';
import type { CalendarDate } from '@internationalized/date';
import type { DateValue } from 'react-aria-components';
import {
  fromDateToLocal,
  getLocalTimeZone,
  toCalendarDate,
} from '@internationalized/date';

import type { LocalizerType } from '../../types/Util.std.ts';
import { AxoDialog } from '../../axo/AxoDialog.dom.tsx';
import {
  isJumpDayAvailable,
  jumpLowerBoundMs,
} from '../../util/tellomiJumpToDate.std.ts';
import type { TellomiCalendarDayThumbnail } from '../../util/tellomiConversationDayThumbnails.std.ts';
import { TellomiJumpToDateCalendar } from './TellomiJumpToDateCalendar.dom.tsx';

export type PropsType = Readonly<{
  open: boolean;
  i18n: LocalizerType;
  initialTimestamp: number;
  /** Local-midnight ms for days that have messages in this conversation. */
  daysWithMessages: ReadonlySet<number>;
  /**
   * Lazy per visible month: first gallery photo/video for days in the range.
   * The calendar asks again when the user changes months.
   */
  loadMonthThumbnails: (
    startMs: number,
    endMs: number
  ) => Promise<ReadonlyArray<TellomiCalendarDayThumbnail>>;
  onJump: (dayStartMs: number) => void;
  onClose: () => void;
}>;

/**
 * Tellomi (desktop audit 7.2): pick a day and jump to its first message.
 * Days with no messages are grey and not tappable. Days with a photo or
 * video show that day's first gallery thumbnail in the cell.
 */
export function TellomiJumpToDateDialog({
  open,
  i18n,
  initialTimestamp,
  daysWithMessages,
  loadMonthThumbnails,
  onJump,
  onClose,
}: PropsType): JSX.Element {
  const initialDate = useMemo(
    () => toCalendarDate(fromDateToLocal(new Date(initialTimestamp))),
    [initialTimestamp]
  );
  const [date, setDate] = useState<CalendarDate | null>(initialDate);

  const isDateUnavailable = useCallback(
    (d: DateValue) => {
      const ms = d.toDate(getLocalTimeZone()).getTime();
      return !isJumpDayAvailable(ms, daysWithMessages);
    },
    [daysWithMessages]
  );

  const selectedAvailable = useMemo(() => {
    if (date == null) {
      return false;
    }
    return isJumpDayAvailable(
      date.toDate(getLocalTimeZone()).getTime(),
      daysWithMessages
    );
  }, [date, daysWithMessages]);

  const handleJump = useCallback(() => {
    if (date == null || !selectedAvailable) {
      return;
    }
    const dayStart = jumpLowerBoundMs(
      date.toDate(getLocalTimeZone()).getTime()
    );
    onJump(dayStart);
  }, [date, onJump, selectedAvailable]);

  return (
    <AxoDialog.Root
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <AxoDialog.Content
        size="sm"
        escape="cancel-is-noop"
        disableMissingAriaDescriptionWarning
      >
        <AxoDialog.Header>
          <AxoDialog.Title>
            {i18n('icu:TellomiJumpToDateDialog__title')}
          </AxoDialog.Title>
          <AxoDialog.Close />
        </AxoDialog.Header>
        <AxoDialog.Body padding="md">
          <TellomiJumpToDateCalendar
            i18n={i18n}
            value={date}
            onChange={setDate}
            isDateUnavailable={isDateUnavailable}
            initialFocused={initialDate}
            loadMonthThumbnails={loadMonthThumbnails}
          />
        </AxoDialog.Body>
        <AxoDialog.Footer>
          <AxoDialog.Actions>
            <AxoDialog.Action variant="strong-secondary" onClick={onClose}>
              {i18n('icu:cancel')}
            </AxoDialog.Action>
            <AxoDialog.Action
              variant="strong-primary"
              disabled={!selectedAvailable}
              onClick={handleJump}
            >
              {i18n('icu:TellomiJumpToDateDialog__jump')}
            </AxoDialog.Action>
          </AxoDialog.Actions>
        </AxoDialog.Footer>
      </AxoDialog.Content>
    </AxoDialog.Root>
  );
}
