// Tellomi: 对着**打好的包**（app.asar）查 Signal 残留，不看源码——源码 grep 会漏掉 bundle 里拼出来的字符串，也会把注释算进去。
//   node scripts/tellomi/audit-residue.mjs [release/mac-arm64/Tellomi.app]      # 退出码 1 = 有未在白名单里的残留
// 查三样：1) signal.* / signalapp / debuglogs.org 的 URL；2) 文案（_locales 压缩后的 messages.json）里的「Signal」；3) html 的 <title>。
// 白名单是**故意留的**（改了是假话 / 法律问题 / 只在 staging 生效），每条写理由；新残留要么修掉，要么加进来并写理由。
import { extractFile, listPackage } from '@electron/asar';
import { join } from 'node:path';

const app = process.argv[2] ?? 'release/mac-arm64/Tellomi.app';
const asar = join(app, 'Contents/Resources/app.asar');
const ALLOW_URL = [
  /staging\.signal\.org/, // config/default.json 的 staging 档，production.json 覆盖；只在 NODE_ENV=staging 生效
  /sfu\.staging\.voip\.signal\.org/,
  /github\.com\/signalapp\/Signal-Desktop\.git/, // package.json 的 repository 元数据，不是界面
];
const ALLOW_TEXT = [
  /Signal Messenger/, // AGPL 版权署名，必须保留
  /Signal Protocol|Signal 协议/, // 技术名词
  /捐|donat|nonprofit|non-profit|非营利|非牟利|501/i, // 捐赠 / 组织陈述：入口已藏，文案改成 Tellomi 是假话
];
const urlRe =
  /https?:\/\/[A-Za-z0-9.-]*(signal\.(org|me|art|group|link)|debuglogs\.org|signalapp\.org|github\.com\/signalapp)[A-Za-z0-9./_?=#%-]*/g;
// listPackage 给的是带前导 / 的路径，extractFile 却不认（@electron/asar 4.x）：去掉再用
const files = listPackage(asar)
  .map(f => f.replace(/^\//, ''))
  .filter(f => /\.(js|json|html)$/.test(f) && !f.includes('node_modules'));
const bad = [];
for (const f of files) {
  let s;
  try {
    s = extractFile(asar, f).toString('utf8');
  } catch (e) {
    bad.push(`${f}: cannot read (${e.message})`);
    continue;
  }
  for (const m of s.matchAll(urlRe)) {
    if (!ALLOW_URL.some(r => r.test(m[0])))
      bad.push(`${f}: ${m[0].slice(0, 100)}`);
  }
  // 打包后的文案是压缩格式：_locales/keys.json（键数组）+ _locales/<loc>/values.json（同序的值数组）
  if (/^_locales\/(en|zh-CN|zh-HK|zh-Hant|yue)\/values\.json$/.test(f)) {
    const keys = JSON.parse(
      extractFile(asar, '_locales/keys.json').toString('utf8')
    );
    JSON.parse(s).forEach((msg, i) => {
      if (
        typeof msg === 'string' &&
        /(?<![A-Za-z0-9_])Signal(?![A-Za-z0-9_])/.test(msg) &&
        !ALLOW_TEXT.some(r => r.test(msg))
      )
        bad.push(`${f} ${keys[i]}: ${msg.slice(0, 80)}`);
    });
  }
  if (f.endsWith('.html')) {
    const t = /<title>([^<]*)<\/title>/.exec(s);
    if (t && /Signal/.test(t[1])) bad.push(`${f}: <title>${t[1]}`);
  }
}
console.log(
  bad.length
    ? bad.join('\n')
    : `no unlisted Signal residue in ${asar} (${files.length} files)`
);
process.exit(bad.length ? 1 : 0);
