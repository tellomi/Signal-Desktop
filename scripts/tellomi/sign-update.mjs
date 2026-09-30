// Copyright 2026 重庆半格智能科技有限公司
// SPDX-License-Identifier: AGPL-3.0-only
// 给更新包签名（= ts/updater/signature.node.ts 的 writeSignature：sha256(file)-hex + "-" + version → libsignal Curve25519 签名 → <file>.sig 十六进制）。
//   node --import=tsx scripts/tellomi/sign-update.mjs <更新包路径> <版本> [私钥路径=~/.config/nexi/signal/desktop-updater.key]
// 公钥在 config/default.json 的 updatesPublicKey；客户端下载后按同一算法验（ts/updater/common.main.ts verifySignature）。
import os from 'node:os';
import path from 'node:path';
// 签名必须走客户端验签的同一份代码（ts/updater/signature.node.ts）：复制一份算法，日后一边改了另一边没改，就会「签得出、验不过」。
// 所以只在这一行豁免「scripts 不许 import ts/**」（.oxlintrc.json 的 no-restricted-paths）。
// oxlint-disable-next-line signal-desktop/no-restricted-paths
import { writeSignature, verifySignature } from '../../ts/updater/signature.node.ts';
import { readFile } from 'node:fs/promises';
const [file, version, key = path.join(os.homedir(), '.config/nexi/signal/desktop-updater.key')] = process.argv.slice(2);
if (!file || !version) { console.error('用法见文件头'); process.exit(2); }
const sig = await writeSignature(file, version, key);
const pub = Buffer.from(JSON.parse(await readFile(new URL('../../config/default.json', import.meta.url), 'utf8')).updatesPublicKey, 'hex');
console.log(`${path.basename(file)}.sig 已写；自验（config/default.json 公钥）：${await verifySignature(file, version, sig, pub)}`);
