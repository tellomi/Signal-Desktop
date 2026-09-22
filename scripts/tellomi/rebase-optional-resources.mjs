// Tellomi: build/optional-resources.json（emoji 字体 / emoji 搜索索引 / jumbomoji / 通话 DRED 权重，运行时按需下载，sha512 钉死）
// 上游指向 updates2.signal.org；我们镜像到 updates.tellomi.app 同路径（超级仓库 scripts/release/publish-desktop.sh resources 负责下载校验上传），
// 这里只把 host 换掉。幂等；上游每次跑 get-emoji-locales / get-jumbomoji 之后重跑一次。
//   node scripts/tellomi/rebase-optional-resources.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';

const UPSTREAM = 'https://updates2.signal.org/';
const OURS = 'https://updates.tellomi.app/';
const p = new URL('../../build/optional-resources.json', import.meta.url);
const raw = readFileSync(p, 'utf8');
const out = raw.replaceAll(UPSTREAM, OURS);
const left = (out.match(/updates2\.signal\.org/g) ?? []).length;
if (process.argv.includes('--check')) {
  console.log(
    left
      ? `${left} upstream URLs left`
      : 'all optional resources point at updates.tellomi.app'
  );
  process.exit(left ? 1 : 0);
}
writeFileSync(p, out);
console.log(
  `rewrote ${(raw.match(/updates2\.signal\.org/g) ?? []).length} URLs → ${OURS}`
);
