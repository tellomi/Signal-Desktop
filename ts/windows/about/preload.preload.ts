// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { contextBridge, ipcRenderer } from 'electron';
import { MinimalSignalContext } from '../minimalContext.preload.ts';
import { config } from '../../context/config.preload.ts';
import { environment } from '../../context/environment.preload.ts';

const environments: Array<string> = [environment];

if (config.appInstance) {
  environments.push(config.appInstance);
}

const Signal = {
  AboutWindowProps: {
    appEnv: environments.join(' - '),
    arch: process.arch,
    platform: process.platform,
    // Tellomi (tellomi/tellomi#1399): the main process' update tier (app/tellomiUpdateManifest.main.ts).
    getUpdateTier: () => ipcRenderer.invoke('tellomi-update-tier:get'),
  },
};
contextBridge.exposeInMainWorld('Signal', Signal);
contextBridge.exposeInMainWorld('SignalContext', MinimalSignalContext);
