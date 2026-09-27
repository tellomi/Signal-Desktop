// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ThunkAction } from 'redux-thunk';
import type { ReadonlyDeep } from 'type-fest';
import type { StateType as RootStateType } from '../reducer.preload.ts';
import { createLogger } from '../../logging/log.std.ts';
import { AppViewType } from '../../types/app.std.ts';
import { getEnvironment, Environment } from '../../environment.std.ts';
import {
  START_INSTALLER,
  type StartInstallerActionType,
  SHOW_BACKUP_IMPORT,
  type ShowBackupImportActionType,
  cancelInstall,
} from './installer.preload.ts';
import { startRegistration } from './standaloneInstaller.preload.ts';
import {
  decideTellomiOpenInbox,
  isTellomiLoggedOut,
} from '../../util/tellomiLoggedOut.std.ts';

const log = createLogger('app');

// State

export type AppStateType = ReadonlyDeep<{
  hasInitialLoadCompleted: boolean;
  appView: AppViewType;
}>;

// Actions

const INITIAL_LOAD_COMPLETE = 'app/INITIAL_LOAD_COMPLETE';
const OPEN_INBOX = 'app/OPEN_INBOX';
const OPEN_STANDALONE = 'app/OPEN_STANDALONE';

type InitialLoadCompleteActionType = ReadonlyDeep<{
  type: typeof INITIAL_LOAD_COMPLETE;
}>;

export type OpenInboxActionType = ReadonlyDeep<{
  type: typeof OPEN_INBOX;
}>;

type OpenStandaloneActionType = ReadonlyDeep<{
  type: typeof OPEN_STANDALONE;
}>;

export type AppActionType = ReadonlyDeep<
  InitialLoadCompleteActionType | OpenInboxActionType | OpenStandaloneActionType
>;

export const actions = {
  initialLoadComplete,
  openInbox,
  openStandalone,
};

function initialLoadComplete(): InitialLoadCompleteActionType {
  return {
    type: INITIAL_LOAD_COMPLETE,
  };
}

export function openInbox(): ThunkAction<
  Promise<void>,
  RootStateType,
  unknown,
  OpenInboxActionType
> {
  return async (dispatch, getState) => {
    // Tellomi（tellomi/tellomi#1414，需求 §3.2 安全要求）：这里是进聊天列表的唯一一道门。本机「已退出登录」时不开：
    // 不在关联页就去关联页（和左栏「重新关联」同一条路），已经在关联页（包括正在关联中）就不动。
    const state = getState();
    const decision = decideTellomiOpenInbox({
      isLoggedOut: isTellomiLoggedOut(state.items),
      appView: state.app.appView,
    });
    if (decision === 'stay') {
      log.warn('open inbox: logged out (Tellomi); staying on the link screen');
      return;
    }
    if (decision === 'open-relink') {
      log.warn('open inbox: logged out (Tellomi); opening the link screen');
      window.Whisper.events.emit('setupAsNewDevice');
      return;
    }

    log.info('open inbox');

    await window.ConversationController.load();

    dispatch({
      type: OPEN_INBOX,
    });
  };
}

function openStandalone(
  startFromBeginning = true
): ThunkAction<
  Promise<void>,
  RootStateType,
  unknown,
  OpenStandaloneActionType
> {
  return async (dispatch, getState) => {
    if (!window.SignalCI && getEnvironment() === Environment.PackagedApp) {
      log.warn(
        `openStandalone: refusing because environment is ${getEnvironment()}`
      );
      return;
    }

    cancelInstall()(dispatch, getState, undefined);

    window.IPC.addSetupMenuItems();

    if (startFromBeginning) {
      await startRegistration()(dispatch, getState, undefined);
    }

    dispatch({
      type: OPEN_STANDALONE,
    });
  };
}

// Reducer

export function getEmptyState(): AppStateType {
  return {
    appView: AppViewType.Blank,
    hasInitialLoadCompleted: false,
  };
}

export function reducer(
  state: Readonly<AppStateType> = getEmptyState(),
  action: Readonly<
    AppActionType | StartInstallerActionType | ShowBackupImportActionType
  >
): AppStateType {
  if (action.type === OPEN_INBOX) {
    return {
      ...state,
      appView: AppViewType.Inbox,
    };
  }

  if (action.type === INITIAL_LOAD_COMPLETE) {
    return {
      ...state,
      hasInitialLoadCompleted: true,
    };
  }

  if (action.type === OPEN_STANDALONE) {
    return {
      ...state,
      appView: AppViewType.Standalone,
    };
  }

  // Foreign action
  if (action.type === START_INSTALLER || action.type === SHOW_BACKUP_IMPORT) {
    return {
      ...state,
      appView: AppViewType.Installer,
    };
  }

  return state;
}
