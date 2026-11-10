# 素材清单 · 位置、命名、来源

> 手工维护。加素材请顺手更新本文件；数字对不上时以
> `ls -1 client/public/images/<目录> | wc -l` 和 `du -sh` 为准。
> 截至 2026-11-10：`client/public/images` 共 110 个文件 / 9.6 MB。

## 放哪

```
assets/nobles-raw/            会士徽标原始图（10 张，从官网/Wikimedia 抓的，未加工）
assets/decks-raw/             卡背母图（3 张 1024x1536，ImageGen 出的学院纹章）
tools/noble-logos.py          原始图 → public/images/nobles 的压章脚本
tools/deck-backs.sh           母图 → public/images/decks 的缩放脚本
tools/vc-matrix.js            VC 成本/产出矩阵生成器 → docs/VC-MATRIX.md
tools/asset-check.js          素材自检（断链 / 孤儿 / 体积 / 缺字段）
shared/venues.js              90 张会议卡的索引（art.src / tone / aspect 在这里）
shared/nobles.js              10+3 张会士卡的索引（logo 字段在这里）
client/public/images/
  venues/                     会议 logo，90 张，8.2 MB
  tokens/                     筹码，6 色 1 套 = 6 张，412 KB
  nobles/                     会士徽标，10 张，164 KB
  decks/                      卡背（学院纹章 + 白边），3 张（A/B/C 各 1），196 KB
  bluebackground.jpg          牌桌桌布，580 KB
```

`client/public` 下的东西 vite 原样拷进 `client/dist`，路径去掉 `client/public` 就是运行时 URL。
`assets/` 在 public 之外，不会进包，只放未加工的源图。

## 每类素材

| 类别 | 数量 | 体积 | 命名 | 源文件 | 加工脚本 | 引用方 |
| --- | --- | --- | --- | --- | --- | --- |
| 会议 logo | 90（82 png + 8 svg） | 8.2 MB | 会议名小写 = `id` | ❌ 没留 | ❌ 手工下载 | `shared/venues.js` 的 `art.src` |
| 筹码 | 6 | 412 KB | `<颜色>Token.png` | ❌ 底图是官方素材，没留 | ❌ 外部 P 图，没留脚本 | 三处共用：`GameBoard.jsx`（筹码池 + 我的资源）、`PaperCard.jsx`（VC 圆圈）、`NobleTile.jsx`（FC 需求圈） |
| 会士徽标 | 10 | 164 KB | `<学会 id>.png` | ✅ `assets/nobles-raw/` | ✅ `tools/noble-logos.py` | `shared/nobles.js` 的 `logo` |
| 卡背 | 3 | 196 KB | `crest-<档>.jpg` | ✅ `assets/decks-raw/` | ✅ `tools/deck-backs.sh` | `GameBoard.jsx` 的 `TIER_DECK` |
| 桌布 | 1 | 568 KB | `bluebackground.jpg` | ❌ 官方素材 | ❌ | `GameBoard.css` |

颜色 → 资源（筹码文件名里的 `<颜色>` 是官方宝石色名，不是我们的资源名）：

| 文件名 | 资源 | 中文 |
| --- | --- | --- |
| WhiteToken | data | 数据 |
| BlueToken | compute | 算力 |
| GreenToken | citation | 引用 |
| BrownToken | collaborator | 合作 |
| RedToken | funding | 经费 |
| GoldToken | coffee | 咖啡（万能牌，不是 AR） |

## 索引入口

素材没有独立 manifest，**注册表就是索引**：

- 会议卡：`shared/venues.js` 每条的 `art: { type, src, tone, aspect }`。
  `tone` 决定卡面上要不要加暗底衬（dark 31 / light 5 / color 54），
  `aspect` 决定横竖（wide 63 / square 27）。90 条 `art.type` 目前全是 `logo`，
  `wordmark` 排印兜底那条路还没用上。
- 会士卡：`shared/nobles.js` 每条的 `logo` 字段，缺该字段时卡面自动降级为纯文字。

校验跑这个（引用断链会退出码 1，其它只警告）：

```bash
node tools/asset-check.js
```

它检查：`art.src` / `logo` 有没有断链、有没有孤儿图、文件名和英文名对不对得上、
筹码是不是还两套并存、超 100 KB 的 logo、`cost`/`bonus` 写没写进注册表、有没有本地字体文件。

## 命名约定

一条规则：**`id` = 文件名 = 会议名小写去符号，不带年份/届数**。
`USENIX Sec` → id `usenixsec` / `usenixsec.png`，`IEEE ICC` → `ieeeicc` / `ieeeicc.png`。
年份只存在于图里（很多主视觉自带 "2026"），不进文件名；换届重下时同名覆盖即可。
这条由 `tools/asset-check.js` 当硬约束检查，不合规直接退出码 1。

2026-11-10 按这条清过一次：重命名 24 个文件（`interrobot.png`→`iros.png`、`iiix.png`→`doceng.png`、
`infocomc.png`→`msn.png`、`sec26.png`→`usenixsec.png` 等），改 13 个 id，去掉 15 个文件名里的年份。
图的内容当时逐张开过，都是对应会议自己的徽标，只是文件名沿用早期候选会议没跟着换。

## 已知缺口

`node tools/asset-check.js` 报出来的 + 人工核对，按"必须补 / 该补 / 可拖"分：

**必须补**

1. VC 的 `cost` / `bonus` 只在 `docs/VC-MATRIX.md`，还没 `--write` 进 `shared/venues.js`。
2. 中文字体素材未定稿，且全仓库 0 个本地字体文件（`index.html` 只挂 Google Fonts CDN，
   预览页用的 Noto Serif SC / Ma Shan Zheng / ZCOOL KuaiLe 从没进过正式页面）。

**该补**

3. 会议 logo 体积失控：`iswc/naacl/cscw26` 三张占 3.8 MB，另有 17 张 > 100 KB；桌布 580 KB。
4. VC 卡面的纸纹贴图不存在（`PaperCard` 目前是纯 CSS 渐变，#8/#9）。
5. TWAS / AAAS / Fake Fellow 三张 bench 会士卡没有徽标。

**可拖，但会硌脚**

6. 90 条会议卡里 0 条期刊，但 `gameLogic.js` tier2 注释仍写"期刊论文"，
   且 server 还在发 `Workshop Paper N` 这类占位名，真名和 logo 一张都没上桌。
7. 会议 logo 的**下载来源没有任何记录** —— 官网链接、版本、许可一律没留（本项目不商用，
   但没来源就没法复现，换图时只能重新满网找）。

## 加素材的规矩

1. 会议 logo 进 `client/public/images/venues/`，文件名 = 会议名小写去符号 = `id`，不带年份；
   `art.src` 指到这个文件，改完跑 `node tools/asset-check.js`（命名不合规会直接报错）。
2. 会士徽标先扔 `assets/nobles-raw/`，再 `python3 tools/noble-logos.py`，不要手改产物。
3. 筹码六色保持 `<颜色>Token` 命名和现有尺寸，换一套就六张一起换（FC 卡的圆圈直接贴这张图）。
4. 新素材的来路写进本文件的"每类素材"表，别只写在 commit message 里。

## 改动记录

- 2026-11-10 筹码并成一套：牌桌的筹码池 + 我的资源改指 `*Token.png`，6 张官方 `*Token.jpg` 删掉。
  没按原计划把 png 回写成 jpg —— png 本来就无损、6 张才 412 KB，再压一道只会糊掉线稿符号。
- 2026-11-10 筹码定稿：6 张 P 过的 `*Token.png` 进 `images/tokens/`，FC 卡和预览页改指 PNG；
  牌桌仍指旧 `.jpg`，等回写（#27）。
- 2026-11-10 命名统一：24 个 venue 文件重命名 + 13 个 id 归一 + 去掉 15 个文件名里的年份。
- 2026-11-10 会议 logo 来源仍无记录 —— 之后新下的图请把官网 URL 写进 commit 或本文件。
