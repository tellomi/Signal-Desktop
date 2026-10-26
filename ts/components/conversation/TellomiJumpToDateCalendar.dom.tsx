// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
  type DateValue,
} from 'react-aria-components';
import type { CalendarDate } from '@internationalized/date';
import { getLocalTimeZone, toCalendarDate } from '@internationalized/date';

import type { LocalizerType } from '../../types/Util.std.ts';
import { AxoSymbol } from '../../axo/AxoSymbol.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';
import { ImageOrBlurhash } from '../ImageOrBlurhash.dom.tsx';
import { createLogger } from '../../logging/log.std.ts';
import * as Errors from '../../types/errors.std.ts';
import { drop } from '../../util/drop.std.ts';
import { startOfLocalDayMs } from '../../util/tellomiJumpToDate.std.ts';
import {
  calendarFetchIntervalMs,
  type TellomiCalendarDayThumbnail,
} from '../../util/tellomiConversationDayThumbnails.std.ts';

const log = createLogger('TellomiJumpToDateCalendar');

export type PropsType = Readonly<{
  i18n: LocalizerType;
  value: CalendarDate | null;
  onChange: (value: CalendarDate) => void;
  isDateUnavailable: (date: DateValue) => boolean;
  initialFocused: CalendarDate;
  loadMonthThumbnails: (
    startMs: number,
    endMs: number
  ) => Promise<ReadonlyArray<TellomiCalendarDayThumbnail>>;
}>;

/**
 * Tellomi (desktop audit 7.2 / F03b): month grid for jump-to-date.
 * Days with no messages stay unavailable. Days with a photo or video show
 * that day's first gallery thumbnail behind the date.
 */
export function TellomiJumpToDateCalendar({
  i18n,
  value,
  onChange,
  isDateUnavailable,
  initialFocused,
  loadMonthThumbnails,
}: PropsType): JSX.Element {
  const [focused, setFocused] = useState(initialFocused);
  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<number, TellomiCalendarDayThumbnail>
  >(() => new Map());
  const requestedMonths = useRef(new Set<string>());

  useEffect(() => {
    const key = `${focused.year}-${focused.month}`;
    const requested = requestedMonths.current;
    if (requested.has(key)) {
      return undefined;
    }
    requested.add(key);
    const { startMs, endMs } = calendarFetchIntervalMs(
      focused.year,
      focused.month
    );
    let finished = false;
    let cancelled = false;
    drop(
      (async () => {
        try {
          const rows = await loadMonthThumbnails(startMs, endMs);
          if (cancelled) {
            return;
          }
          finished = true;
          setThumbnails(prev => {
            const next = new Map(prev);
            for (const row of rows) {
              next.set(row.dayStartMs, row);
            }
            return next;
          });
        } catch (error) {
          if (!cancelled) {
            requested.delete(key);
            log.error(
              'Failed to load jump-to-date day thumbnails',
              Errors.toLogFormat(error)
            );
          }
        }
      })()
    );
    return () => {
      cancelled = true;
      if (!finished) {
        requested.delete(key);
      }
    };
  }, [focused.year, focused.month, loadMonthThumbnails]);

  return (
    <Calendar
      className={tw('flex flex-col gap-2')}
      aria-label={i18n('icu:TellomiJumpToDateDialog__dateLabel')}
      value={value}
      focusedValue={focused}
      onFocusChange={next => {
        setFocused(toCalendarDate(next));
      }}
      onChange={next => {
        onChange(toCalendarDate(next));
      }}
      isDateUnavailable={isDateUnavailable}
    >
      <header
        className={tw(
          'flex items-center justify-between gap-2 border-b border-primary pb-2'
        )}
      >
        <MonthArrow slot="previous" />
        <Heading className={tw('type-body-medium font-medium text-primary')} />
        <MonthArrow slot="next" />
      </header>
      <CalendarGrid
        className={tw('w-full table-fixed border-separate border-spacing-0.5')}
        weekdayStyle="short"
      >
        <CalendarGridHeader>
          {day => (
            <CalendarHeaderCell
              className={tw('type-body-small font-medium text-secondary')}
            >
              {day}
            </CalendarHeaderCell>
          )}
        </CalendarGridHeader>
        <CalendarGridBody>
          {date => (
            <DayCell date={date} thumbnail={thumbnails.get(dayStartMs(date))} />
          )}
        </CalendarGridBody>
      </CalendarGrid>
    </Calendar>
  );
}

function dayStartMs(date: CalendarDate): number {
  return startOfLocalDayMs(date.toDate(getLocalTimeZone()).getTime());
}

function hasVisual(
  thumbnail: TellomiCalendarDayThumbnail | undefined
): thumbnail is TellomiCalendarDayThumbnail {
  return (
    thumbnail != null && (thumbnail.url != null || thumbnail.blurHash != null)
  );
}

type DayCellProps = Readonly<{
  date: CalendarDate;
  thumbnail: TellomiCalendarDayThumbnail | undefined;
}>;

function DayCell({ date, thumbnail }: DayCellProps): JSX.Element {
  const showSlot = hasVisual(thumbnail);
  return (
    <CalendarCell
      date={date}
      className={tw(
        'relative flex h-11 w-full items-center justify-center overflow-hidden rounded-lg p-0',
        'type-body-medium text-primary',
        'data-disabled:text-disabled',
        'data-unavailable:text-disabled',
        'data-hovered:bg-primary',
        'data-focused:bg-primary',
        'data-today:font-semibold',
        'data-selected:shadow-[inset_0_0_0_2px_var(--axo-color-border-selected)]',
        'outline-none keyboard-mode:data-focus-visible:axo-focus-ring'
      )}
    >
      {({ formattedDate, isUnavailable, isDisabled, isSelected }) => {
        // Outside-month cells are disabled. A thumbnail belongs on the
        // selectable in-month day, where the date can be jumped to.
        const showMedia =
          showSlot && !isUnavailable && !isDisabled && thumbnail != null;
        return (
          <>
            {showMedia ? (
              <>
                <ImageOrBlurhash
                  alt=""
                  aria-hidden
                  draggable={false}
                  className={tw(
                    'pointer-events-none absolute inset-0 object-cover'
                  )}
                  src={thumbnail.url}
                  blurHash={thumbnail.blurHash}
                  intrinsicWidth={44}
                  intrinsicHeight={44}
                />
                <span
                  aria-hidden
                  className={tw('pointer-events-none absolute inset-0')}
                  style={{ backgroundColor: 'rgba(0, 0, 0, 0.28)' }}
                />
                {isSelected ? (
                  <span
                    aria-hidden
                    className={tw('pointer-events-none absolute inset-0')}
                    style={{
                      boxShadow:
                        'inset 0 0 0 2px var(--axo-color-border-selected)',
                    }}
                  />
                ) : null}
              </>
            ) : null}
            <span
              className={tw(
                'relative',
                showMedia ? 'font-semibold text-primary-oncolor' : undefined
              )}
              style={
                showMedia
                  ? { textShadow: '0 1px 2px rgba(0, 0, 0, 0.65)' }
                  : undefined
              }
            >
              {formattedDate}
            </span>
          </>
        );
      }}
    </CalendarCell>
  );
}

type MonthArrowProps = Readonly<{
  slot: 'previous' | 'next';
}>;

function MonthArrow({ slot }: MonthArrowProps): JSX.Element {
  return (
    <Button
      slot={slot}
      className={tw(
        'flex items-center justify-center',
        'rounded-full p-1 type-body-medium font-medium text-primary',
        'data-disabled:text-disabled',
        'data-hovered:bg-primary',
        'data-focused:bg-primary',
        'outline-none keyboard-mode:data-focus-visible:axo-focus-ring'
      )}
    >
      <AxoSymbol.Icon
        size={14}
        symbol={slot === 'previous' ? 'chevron-[start]' : 'chevron-[end]'}
        label={null}
      />
    </Button>
  );
}
