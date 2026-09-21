// 给更新包签名（= ts/updater/signature.node.ts 的 writeSignature：sha256(file)-hex + "-" + version → libsignal Curve25519 签名 → <file>.sig 十六进制）。
//   node --import=tsx scripts/tellomi/sign-update.mjs <更新包路径> <版本> [私钥路径=~/.config/nexi/signal/desktop-updater.key]
// 公钥在 config/default.json 的 updatesPublicKey；客户端下载后按同一算法验（ts/updater/common.main.ts verifySignature）。
import os from 'node:os';
import path from 'node:path';
import { writeSignature, verifySignature } from '../../ts/updater/signature.node.ts';
import { readFile } from 'node:fs/promises';
const [file, version, key = path.join(os.homedir(), '.config/nexi/signal/desktop-updater.key')] = process.argv.slice(2);
if (!file || !version) { console.error('用法见文件头'); process.exit(2); }
const sig = await writeSignature(file, version, key);
const pub = Buffer.from(JSON.parse(await readFile(new URL('../../config/default.json', import.meta.url), 'utf8')).updatesPublicKey, 'hex');
console.log(`${path.basename(file)}.sig 已写；自验（config/default.json 公钥）：${await verifySignature(file, version, sig, pub)}`);
