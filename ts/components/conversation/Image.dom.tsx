// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties, JSX, MouseEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { ImageOrBlurhash } from '../ImageOrBlurhash.dom.tsx';
import type { LocalizerType, ThemeType } from '../../types/Util.std.ts';
import type { AttachmentForUIType } from '../../types/Attachment.std.ts';
import {
  defaultBlurHash,
  isIncremental,
  isReadyToView,
  isTellomiSpoilerCovered,
} from '../../util/Attachment.std.ts';
import { SpinnerV2 } from '../SpinnerV2.dom.tsx';
import { useUndownloadableMediaHandler } from '../../hooks/useUndownloadableMediaHandler.dom.tsx';
import type { TellomiSpoilerRevealPoint } from './TellomiSpoilerCover.dom.tsx';
import { TellomiSpoilerCover } from './TellomiSpoilerCover.dom.tsx';
import { drop } from '../../util/drop.std.ts';

export enum CurveType {
  None = 0,
  Tiny = 4,
  Small = 10,
  Normal = 18,
}

export type Props = {
  alt: string;
  attachment: AttachmentForUIType;
  url?: string;

  className?: string;
  height?: number;
  width?: number;
  cropWidth?: number;
  cropHeight?: number;
  tabIndex?: number;

  overlayText?: string;

  noBorder?: boolean;
  noBackground?: boolean;
  bottomOverlay?: boolean;
  closeButton?: boolean;
  curveBottomLeft?: CurveType;
  curveBottomRight?: CurveType;
  curveTopLeft?: CurveType;
  curveTopRight?: CurveType;

  darkOverlay?: boolean;
  playIconOverlay?: boolean;
  blurHash?: string;
  fallbackToBlurhashOnError?: boolean;

  i18n: LocalizerType;
  theme?: ThemeType;
  showMediaNoLongerAvailableToast?: () => void;
  showVisualAttachment?: (attachment: AttachmentForUIType) => void;
  cancelDownload?: () => void;
  startDownload?: () => void;
  onClickClose?: (attachment: AttachmentForUIType) => void;
  onError?: () => void;
  /** Tellomi (spec R-1): called once a covered image / video has been uncovered here. */
  onTellomiSpoilerRevealed?: (attachment: AttachmentForUIType) => void;
  /** Tellomi (spec R-2): a live photo's moving half, as a URL to play (undefined when it can't be had). */
  fetchTellomiLivePhotoVideo?: (
    attachment: AttachmentForUIType
  ) => Promise<string | undefined>;
};

/** Tellomi (spec R-2): back to the still (Telegram: 0.3 s). Same as the CSS transition. */
const TELLOMI_LIVE_FADE_MS = 300;

export function Image({
  alt,
  attachment,
  blurHash,
  bottomOverlay,
  className,
  closeButton,
  curveBottomLeft,
  curveBottomRight,
  curveTopLeft,
  curveTopRight,
  darkOverlay,
  fallbackToBlurhashOnError,
  height = 0,
  i18n,
  noBackground,
  noBorder,
  showMediaNoLongerAvailableToast,
  showVisualAttachment,
  startDownload,
  cancelDownload,
  onClickClose,
  onError,
  onTellomiSpoilerRevealed,
  fetchTellomiLivePhotoVideo,
  overlayText,
  playIconOverlay,
  tabIndex,
  theme,
  url,
  width = 0,
  cropWidth = 0,
  cropHeight = 0,
}: Props): JSX.Element {
  const resolvedBlurHash = blurHash || defaultBlurHash(theme);

  const curveStyles: CSSProperties = {
    borderStartStartRadius: curveTopLeft || CurveType.None,
    borderStartEndRadius: curveTopRight || CurveType.None,
    borderEndStartRadius: curveBottomLeft || CurveType.None,
    borderEndEndRadius: curveBottomRight || CurveType.None,
  };

  // Tellomi (tellomi/tellomi#1263, spec R-1): a covered image / video is uncovered by the first click,
  // from where it was clicked; only the next click opens it. Remembered here once the reveal is done.
  const [tellomiReveal, setTellomiReveal] = useState<
    TellomiSpoilerRevealPoint | 'revealed' | undefined
  >();
  const showTellomiCover =
    isTellomiSpoilerCovered(attachment) && tellomiReveal !== 'revealed';
  const startTellomiReveal = useCallback((point: TellomiSpoilerRevealPoint) => {
    setTellomiReveal(current => current ?? point);
  }, []);
  const handleTellomiRevealed = useCallback(() => {
    setTellomiReveal('revealed');
    onTellomiSpoilerRevealed?.(attachment);
  }, [attachment, onTellomiSpoilerRevealed]);

  // Tellomi (tellomi/tellomi#1263, spec R-2): a live photo has the live badge in its corner and plays its
  // moving half once, muted, every time it comes on screen, then fades back to the still (owner
  // 2026-10-13, as Telegram: `ChatMessageInteractiveMediaNode` plays it whenever the bubble becomes
  // visible; 0.3 s fade). Re-rendering while it is on screen doesn't play it again. Pointing at it plays
  // it again (ADR-0068: Desktop plays on hover). Not while it is covered, not before the still is here:
  // then it plays once uncovered / downloaded, if still on screen.
  const rootRef = useRef<HTMLDivElement>(null);
  const liveKey = attachment.tellomiLivePhotoVideo?.cdnKey;
  const isTellomiLive = liveKey != null && fetchTellomiLivePhotoVideo != null;
  const canPlayTellomiLive =
    isTellomiLive && !showTellomiCover && Boolean(attachment.path);
  const [tellomiLive, setTellomiLive] = useState<
    Readonly<{ url: string; fading: boolean; run: number }> | undefined
  >();
  const tellomiLiveRun = useRef(0);
  const tellomiLiveFadeTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  useEffect(() => () => clearTimeout(tellomiLiveFadeTimer.current), []);
  const playTellomiLive = useCallback(async () => {
    if (!canPlayTellomiLive || fetchTellomiLivePhotoVideo == null) {
      return;
    }
    const videoUrl = await fetchTellomiLivePhotoVideo(attachment);
    if (videoUrl != null) {
      clearTimeout(tellomiLiveFadeTimer.current);
      tellomiLiveRun.current += 1;
      setTellomiLive({
        url: videoUrl,
        fading: false,
        run: tellomiLiveRun.current,
      });
    }
  }, [attachment, canPlayTellomiLive, fetchTellomiLivePhotoVideo]);
  const fadeTellomiLive = useCallback(() => {
    setTellomiLive(current =>
      current ? { ...current, fading: true } : current
    );
    clearTimeout(tellomiLiveFadeTimer.current);
    tellomiLiveFadeTimer.current = setTimeout(() => {
      setTellomiLive(current => (current?.fading ? undefined : current));
    }, TELLOMI_LIVE_FADE_MS);
  }, []);

  const [tellomiLiveOnScreen, setTellomiLiveOnScreen] = useState(false);
  const tellomiLivePlayedThisAppearance = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!isTellomiLive || root == null) {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      setTellomiLiveOnScreen(
        entries[entries.length - 1]?.isIntersecting ?? false
      );
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [isTellomiLive]);
  useEffect(() => {
    if (!tellomiLiveOnScreen) {
      // Gone off screen: the next time it comes back is a new appearance
      tellomiLivePlayedThisAppearance.current = false;
      return;
    }
    if (!canPlayTellomiLive || tellomiLivePlayedThisAppearance.current) {
      return;
    }
    tellomiLivePlayedThisAppearance.current = true;
    drop(playTellomiLive());
  }, [canPlayTellomiLive, tellomiLiveOnScreen, playTellomiLive]);

  const showVisualAttachmentClick = useCallback(
    (event: MouseEvent) => {
      if (showTellomiCover) {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        startTellomiReveal({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        return;
      }
      if (showVisualAttachment) {
        event.preventDefault();
        event.stopPropagation();
        showVisualAttachment(attachment);
      }
    },
    [attachment, showTellomiCover, showVisualAttachment, startTellomiReveal]
  );
  const showVisualAttachmentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'Enter' && event.key !== 'Space') {
        return;
      }
      if (showTellomiCover) {
        event.preventDefault();
        event.stopPropagation();
        startTellomiReveal({
          x: (width - cropWidth) / 2,
          y: (height - cropHeight) / 2,
        });
        return;
      }
      if (showVisualAttachment) {
        event.preventDefault();
        event.stopPropagation();
        showVisualAttachment(attachment);
      }
    },
    [
      attachment,
      cropHeight,
      cropWidth,
      height,
      showTellomiCover,
      showVisualAttachment,
      startTellomiReveal,
      width,
    ]
  );
  const cancelDownloadClick = useCallback(
    (event: MouseEvent) => {
      if (cancelDownload) {
        event.preventDefault();
        event.stopPropagation();
        cancelDownload();
      }
    },
    [cancelDownload]
  );
  const cancelDownloadKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (cancelDownload && (event.key === 'Enter' || event.key === 'Space')) {
        event.preventDefault();
        event.stopPropagation();
        cancelDownload();
      }
    },
    [cancelDownload]
  );
  const startDownloadClick = useCallback(
    (event: MouseEvent) => {
      if (startDownload) {
        event.preventDefault();
        event.stopPropagation();
        startDownload();
      }
    },
    [startDownload]
  );
  const startDownloadKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (startDownload && (event.key === 'Enter' || event.key === 'Space')) {
        event.preventDefault();
        event.stopPropagation();
        startDownload();
      }
    },
    [startDownload]
  );
  const undownloadableClick = useUndownloadableMediaHandler(
    showMediaNoLongerAvailableToast
  );

  const imageOrBlurHash = (
    <ImageOrBlurhash
      className="module-image__image"
      alt={alt}
      height={height}
      width={width}
      intrinsicWidth={attachment.width}
      intrinsicHeight={attachment.height}
      src={url}
      blurHash={noBackground && url ? undefined : resolvedBlurHash}
      fallbackToBlurhashOnError={fallbackToBlurhashOnError}
      onError={onError}
      key={url}
    />
  );

  const startDownloadButton =
    !attachment.path && !attachment.pending && !isIncremental(attachment) ? (
      <button
        type="button"
        className="module-image__border-overlay module-image__border-overlay--with-click-handler"
        aria-label={i18n('icu:startDownload')}
        onClick={startDownloadClick}
        onKeyDown={startDownloadKeyDown}
        style={curveStyles}
        tabIndex={tabIndex}
      >
        <span className="module-image__overlay-circle">
          <span className="module-image__download-icon" />
        </span>
      </button>
    ) : undefined;

  const isUndownloadable = attachment.isPermanentlyUndownloadable;

  // oxlint-disable-next-line no-nested-ternary
  const startDownloadOrUnavailableButton = startDownload ? (
    isUndownloadable ? (
      <button
        type="button"
        className="module-image__overlay-circle module-image__overlay-circle--undownloadable"
        aria-label={i18n('icu:mediaNotAvailable')}
        onClick={undownloadableClick}
        tabIndex={tabIndex}
      >
        <div className="module-image__undownloadable-icon" />
      </button>
    ) : (
      startDownloadButton
    )
  ) : null;

  const spinner =
    isIncremental(attachment) || !cancelDownload
      ? undefined
      : getSpinner({
          attachment,
          i18n,
          cancelDownloadClick,
          cancelDownloadKeyDown,
          tabIndex,
        });

  return (
    <div
      ref={rootRef}
      onMouseEnter={
        canPlayTellomiLive && (tellomiLive == null || tellomiLive.fading)
          ? () => drop(playTellomiLive())
          : undefined
      }
      onMouseLeave={
        tellomiLive != null && !tellomiLive.fading ? fadeTellomiLive : undefined
      }
      className={classNames(
        'module-image',
        className,
        attachment.url ? 'module-image--loaded' : null,
        !noBackground ? 'module-image--with-background' : null,
        cropWidth || cropHeight ? 'module-image--cropped' : null
      )}
      style={{
        width: width - cropWidth,
        height: height - cropHeight,
        ...curveStyles,
      }}
    >
      {imageOrBlurHash}
      {tellomiLive != null && canPlayTellomiLive ? (
        <video
          className={classNames('module-image__tellomi-live-video', {
            'module-image__tellomi-live-video--fading': tellomiLive.fading,
          })}
          key={tellomiLive.run}
          src={tellomiLive.url}
          style={curveStyles}
          muted
          autoPlay
          playsInline
          onEnded={fadeTellomiLive}
        />
      ) : null}
      {isTellomiLive && !showTellomiCover ? (
        <span
          className="module-image__tellomi-live-badge"
          role="img"
          aria-label={i18n('icu:Image--tellomi-live-photo-badge')}
        />
      ) : null}
      {showTellomiCover ? (
        <TellomiSpoilerCover
          url={url}
          style={curveStyles}
          revealFrom={
            typeof tellomiReveal === 'object' ? tellomiReveal : undefined
          }
          onRevealed={handleTellomiRevealed}
        />
      ) : null}
      {startDownloadOrUnavailableButton}
      {spinner}

      {attachment.caption ? (
        <img
          className="module-image__caption-icon"
          src="images/caption-shadow.svg"
          alt={i18n('icu:imageCaptionIconAlt')}
        />
      ) : null}
      {bottomOverlay ? (
        <div
          className="module-image__bottom-overlay"
          style={{
            borderBottomLeftRadius: curveBottomLeft || CurveType.None,
            borderBottomRightRadius: curveBottomRight || CurveType.None,
          }}
        />
      ) : null}
      {(attachment.path || isIncremental(attachment)) &&
      !isUndownloadable &&
      !showTellomiCover &&
      playIconOverlay ? (
        <div className="module-image__overlay-circle">
          <div className="module-image__play-icon" />
        </div>
      ) : null}
      {overlayText ? (
        <div
          className="module-image__text-container"
          style={{ lineHeight: `${height}px` }}
        >
          {overlayText}
        </div>
      ) : null}
      {darkOverlay || !noBorder ? (
        <div
          className={classNames('module-image__border-overlay', {
            'module-image__border-overlay--with-border': !noBorder,
            'module-image__border-overlay--dark': darkOverlay,
          })}
          style={curveStyles}
        />
      ) : null}
      {(showVisualAttachment || showTellomiCover) &&
      isReadyToView(attachment) ? (
        <button
          type="button"
          className={classNames('module-image__border-overlay', {
            'module-image__border-overlay--with-click-handler': true,
          })}
          aria-label={i18n('icu:imageOpenAlt')}
          style={curveStyles}
          onClick={showVisualAttachmentClick}
          onKeyDown={showVisualAttachmentKeyDown}
          tabIndex={tabIndex}
        />
      ) : null}
      {closeButton ? (
        <button
          type="button"
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            e.stopPropagation();

            if (onClickClose) {
              onClickClose(attachment);
            }
          }}
          className="module-image__close-button"
          title={i18n('icu:remove-attachment')}
          aria-label={i18n('icu:remove-attachment')}
        />
      ) : null}
    </div>
  );
}

export function getSpinner({
  attachment,
  cancelDownloadClick,
  cancelDownloadKeyDown,
  i18n,
  tabIndex,
}: {
  attachment: AttachmentForUIType;
  cancelDownloadClick: (event: MouseEvent) => void;
  cancelDownloadKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  i18n: LocalizerType;
  tabIndex: number | undefined;
}): JSX.Element | undefined {
  if (!attachment.pending) {
    return undefined;
  }

  const spinnerValue =
    (!isIncremental(attachment) &&
      attachment.size &&
      attachment.totalDownloaded) ||
    undefined;

  return (
    <button
      type="button"
      className="module-image__overlay-circle"
      aria-label={i18n('icu:cancelDownload')}
      onClick={cancelDownloadClick}
      onKeyDown={cancelDownloadKeyDown}
      tabIndex={tabIndex}
    >
      <div className="module-image__stop-icon" />
      <div className="module-image__progress-circle-wrapper">
        <SpinnerV2
          min={0}
          max={attachment.size}
          value={spinnerValue}
          size={44}
          strokeWidth={2}
          marginRatio={1}
        />
      </div>
    </button>
  );
}
