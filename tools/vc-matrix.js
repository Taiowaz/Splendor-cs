#!/usr/bin/env node
// VC（会议卡）/ FC（会士卡）成本 · 产出矩阵生成器
//   node tools/vc-matrix.js          校验 + 重新生成 docs/VC-MATRIX.md
//   node tools/vc-matrix.js --write  把 cost/bonus/prestige 写回 shared/venues.js
//
// ── 产出 AR（bonus）：这个领域主要对外贡献什么 ─────────────────────────
//   各档每类固定张数 A 4 / B 6 / C 8 → 五类各 18 张，
//   和 server/gameLogic.js 现在的牌库分布一致，落地时不用改发牌逻辑。
//
// ── 所需 AR（cost）：这个领域主要吃什么 ───────────────────────────────
//   INPUTS[name] 按"典型程度"从高到低列出这个领域会消耗的资源，
//   具体取前几类、各几个由本脚本在同一档内配平：优先挑当前需求最低的类，
//   避免某种 AR 全场没人要。权重见 SHAPE。
//   CVPR 排在 A 档第一张、五类需求都是 0，正好还原成 3 数据 3 算力 2 合作。
//
// ── 声誉 ──────────────────────────────────────────────────────────────
//   C 4→0 / 5→1，B 6→2 / 7→3，A 8→4 / 9→5（tier1/2/3 现有声望区间不变）。
//   高总成本张数对齐官方：A 4 张、B 9 张、C 16 张。
//   单项成本 ≤ 3，2 人局每色只有 4 枚筹码也不会卡死。
//   咖啡（万能牌）不是 AR，既不作产出也不进成本。
//
// ── FC（会士卡）───────────────────────────────────────────────────────
//   成本形状和声誉直接读 shared/nobles.js（注册表就是唯一事实来源），
//   本脚本只负责把牌池 10 张列成表，并校验五种资源的总需求是否配平。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { NOBLES } from '../shared/nobles.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const AR = { data: '数据', compute: '算力', citation: '引用', collaborator: '合作', funding: '经费' }
const TYPES = Object.keys(AR)
const LETTER = { d: 'data', c: 'compute', i: 'citation', o: 'collaborator', f: 'funding' }
const TIER_CCF = { 3: 'A', 2: 'B', 1: 'C' }
const QUOTA = { 3: 4, 2: 6, 1: 8 }      // 每档每种产出 AR 的张数
const HI_TARGET = { 3: 4, 2: 9, 1: 16 } // 每档高声誉（高总成本）张数
const TOTAL = { 3: [8, 9], 2: [6, 7], 1: [4, 5] }
// 总成本 → [成本类数, 各类个数（按典型程度从高到低）]
const SHAPE = {
  4: [2, [2, 2]], 5: [3, [2, 2, 1]], 6: [3, [2, 2, 2]],
  7: [3, [3, 2, 2]], 8: [3, [3, 3, 2]], 9: [4, [3, 2, 2, 2]]
}
const PRESTIGE = { 4: 0, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5 }

// 产出 AR
const BONUS = {
  // ---------- CCF-A · tier 3 ----------
  'CVPR': 'data', 'ICCV': 'data', 'ACL': 'data', 'SIGMOD': 'data',
  'NeurIPS': 'compute', 'ICML': 'compute', 'SIGGRAPH': 'compute', 'OSDI': 'compute',
  'AAAI': 'citation', 'FOCS': 'citation', 'KDD': 'citation', 'ICDE': 'citation',
  'CHI': 'collaborator', 'SOSP': 'collaborator', 'NSDI': 'collaborator', 'ACM MM': 'collaborator',
  'ISCA': 'funding', 'MICRO': 'funding', 'USENIX Sec': 'funding', 'NDSS': 'funding',
  // ---------- CCF-B · tier 2 ----------
  'EMNLP': 'data', 'NAACL': 'data', 'ACCV': 'data', 'ICDM': 'data', 'ASE': 'data', 'RAID': 'data',
  'ICAPS': 'compute', 'ICASSP': 'compute', 'HPDC': 'compute', 'IPDPS': 'compute', 'USENIX ATC': 'compute', 'ISSTA': 'compute',
  'COLING': 'citation', 'AISTATS': 'citation', 'UAI': 'citation', 'KR': 'citation', 'SIGIR': 'citation', 'WSDM': 'citation',
  'CIKM': 'collaborator', 'DASFAA': 'collaborator', 'EuroSys': 'collaborator', 'ESORICS': 'collaborator', 'CSCW': 'collaborator', 'GROUP': 'collaborator',
  'IROS': 'funding', 'FAST': 'funding', 'ICS': 'funding', 'DATE': 'funding', 'ISMAR': 'funding', 'ACSAC': 'funding',
  // ---------- CCF-C · tier 1 ----------
  'EAACL': 'data', 'WACV': 'data', 'ISWC': 'data', 'ICPR': 'data', 'FG': 'data', 'DocEng': 'data', 'BMVC': 'data', 'ICDAR': 'data',
  'ICNP': 'compute', 'PRDC': 'compute', 'SAT': 'compute', 'COMPSAC': 'compute', 'IJCNN': 'compute', 'ICONIP': 'compute', 'ICPP': 'compute', 'VMV': 'compute',
  'ECIR': 'citation', 'SSE': 'citation', 'SEMANTiCS': 'citation', 'ICANN': 'citation', 'GECCO': 'citation', 'FSTTCS': 'citation', 'ICTAI': 'citation', 'SIAM MM': 'citation',
  'APWeb': 'collaborator', 'ADC': 'collaborator', 'JIST': 'collaborator', 'ICALT': 'collaborator', 'CHI PLAY': 'collaborator', 'DIS': 'collaborator', 'DIMVA': 'collaborator', 'PADS': 'collaborator',
  'HotChips': 'funding', 'ISVLSI': 'funding', 'WiMob': 'funding', 'DSN': 'funding', 'ICCC': 'funding', 'IEEE ICC': 'funding', 'GLOBECOM': 'funding', 'MSN': 'funding'
}

// 所需 AR 偏好（按典型程度降序）
const INPUTS = {
  'CVPR': 'd,c,o,f', 'ICCV': 'd,c,f,i', 'NeurIPS': 'd,c,i,f', 'ICML': 'd,c,i,o',
  'AAAI': 'd,c,i,o', 'ACL': 'd,c,i,o', 'SIGGRAPH': 'c,f,d,o', 'CHI': 'o,i,d,f',
  'SIGMOD': 'd,c,i,f', 'ICDE': 'd,c,o,f', 'OSDI': 'c,d,i,f', 'SOSP': 'c,d,o,i',
  'ISCA': 'f,c,d,i', 'MICRO': 'f,c,d,o', 'NSDI': 'c,o,d,f', 'USENIX Sec': 'f,d,c,i',
  'NDSS': 'f,d,c,o', 'FOCS': 'i,c,d,o', 'KDD': 'd,i,c,f', 'ACM MM': 'd,c,o,f',

  'EMNLP': 'd,c,i,o', 'COLING': 'd,i,o,c', 'NAACL': 'd,c,o,i', 'AISTATS': 'i,c,d,f',
  'UAI': 'i,c,d,o', 'KR': 'i,c,d,o', 'ICAPS': 'c,d,i,f', 'ACCV': 'd,c,f,o',
  'ICASSP': 'c,d,f,i', 'IROS': 'c,f,d,o', 'SIGIR': 'd,i,c,o', 'WSDM': 'd,i,c,o',
  'CIKM': 'd,o,i,c', 'ICDM': 'd,c,i,f', 'DASFAA': 'd,o,c,f', 'HPDC': 'c,f,d,i',
  'IPDPS': 'c,f,d,o', 'FAST': 'f,c,d,i', 'USENIX ATC': 'c,d,f,i', 'EuroSys': 'c,o,d,f',
  'ICS': 'c,f,d,i', 'DATE': 'f,c,d,o', 'ISMAR': 'f,d,c,o', 'ISSTA': 'c,d,i,f',
  'ASE': 'd,c,o,i', 'RAID': 'd,c,f,i', 'ACSAC': 'f,d,c,i', 'ESORICS': 'f,o,d,i',
  'CSCW': 'o,i,d,f', 'GROUP': 'o,i,d,f',

  'EAACL': 'd,o,c,i', 'ICNP': 'c,f,d,i', 'WACV': 'd,c,f,o', 'HotChips': 'f,c,d,i',
  'ISWC': 'd,i,c,o', 'ECIR': 'd,i,c,o', 'APWeb': 'd,o,c,i', 'ADC': 'd,o,i,c',
  'JIST': 'd,i,o,c', 'SSE': 'i,o,d,c', 'ICALT': 'o,i,d,f', 'ISVLSI': 'f,c,d,i',
  'PRDC': 'c,f,d,i', 'ICPR': 'd,c,i,f', 'SAT': 'c,i,d,f', 'GECCO': 'i,c,d,f',
  'FSTTCS': 'i,c,d,o', 'FG': 'd,c,f,i', 'COMPSAC': 'c,d,f,i', 'IJCNN': 'c,d,f,o',
  'SEMANTiCS': 'i,d,c,o', 'DocEng': 'd,c,i,f', 'CHI PLAY': 'o,d,i,f', 'DIS': 'o,i,d,f',
  'BMVC': 'd,c,f,i', 'ICANN': 'i,c,d,f', 'DIMVA': 'd,o,c,f', 'WiMob': 'f,c,d,o',
  'ICDAR': 'd,c,f,i', 'ICONIP': 'c,d,i,f', 'DSN': 'f,c,d,i', 'ICPP': 'c,f,d,o',
  'PADS': 'c,o,d,f', 'VMV': 'c,d,f,i', 'ICTAI': 'i,d,c,o', 'SIAM MM': 'i,c,d,f',
  'ICCC': 'f,c,d,i', 'IEEE ICC': 'f,c,o,d', 'GLOBECOM': 'f,c,d,i', 'MSN': 'f,c,d,i'
}

// 高总成本（→ 高声誉）的会议，其余取该档低总成本
const HI = new Set([
  'NeurIPS', 'SIGGRAPH', 'CHI', 'ACM MM',
  'EMNLP', 'UAI', 'IROS', 'SIGIR', 'EuroSys', 'DATE', 'ASE', 'ESORICS', 'CSCW',
  'WACV', 'ISWC', 'ECIR', 'APWeb', 'SSE', 'ICALT', 'PRDC', 'ICPR', 'FG', 'IJCNN',
  'CHI PLAY', 'BMVC', 'WiMob', 'DSN', 'ICTAI', 'GLOBECOM'
])

const src = readFileSync(join(ROOT, 'shared/venues.js'), 'utf8')
const ids = [...src.matchAll(/^\s*\{ id: '([^']+)',\s*name: '([^']+)',.*?cn: '([^']+)'.*?tier: (\d)/gm)]
  .map((m) => ({ id: m[1], name: m[2], cn: m[3], tier: Number(m[4]) }))

const errors = []
if (ids.length !== 90) errors.push(`venues.js 解析到 ${ids.length} 条，应为 90`)
for (const v of ids) {
  if (!BONUS[v.name]) errors.push(`BONUS 缺 ${v.name}`)
  if (!INPUTS[v.name]) errors.push(`INPUTS 缺 ${v.name}`)
}
for (const n of [...Object.keys(BONUS), ...Object.keys(INPUTS)]) {
  if (!ids.some((v) => v.name === n)) errors.push(`表里多了 venues.js 没有的 ${n}`)
}
if (errors.length) {
  console.error('数据不完整:\n' + errors.map((e) => '  - ' + e).join('\n'))
  process.exit(1)
}

const usage = Object.fromEntries([3, 2, 1].map((t) => [t, Object.fromEntries(TYPES.map((x) => [x, 0]))]))

const rows = ids.map((v) => {
  const total = TOTAL[v.tier][HI.has(v.name) ? 1 : 0]
  const [kinds, weights] = SHAPE[total]
  const cands = INPUTS[v.name].split(',').map((s) => LETTER[s.trim()])
  if (cands.length < kinds) errors.push(`${v.name}: 候选资源 ${cands.length} 类，需 ${kinds}`)
  const picked = cands
    .map((t, rank) => ({ t, rank }))
    .sort((a, b) => usage[v.tier][a.t] - usage[v.tier][b.t] || a.rank - b.rank)
    .slice(0, kinds)
    .sort((a, b) => a.rank - b.rank)
  const cost = {}
  picked.forEach((p, i) => {
    cost[p.t] = weights[i]
    usage[v.tier][p.t] += weights[i]
  })
  return { ...v, bonus: BONUS[v.name], cost, total, kinds, prestige: PRESTIGE[total] }
})

for (const tier of [3, 2, 1]) {
  const t = rows.filter((r) => r.tier === tier)
  for (const type of TYPES) {
    const n = t.filter((r) => r.bonus === type).length
    if (n !== QUOTA[tier]) errors.push(`${TIER_CCF[tier]} 档产出 ${AR[type]} ${n} 张，配额 ${QUOTA[tier]}`)
  }
  const hi = t.filter((r) => r.total % 2 === 1).length
  if (hi !== HI_TARGET[tier]) errors.push(`${TIER_CCF[tier]} 档高声誉卡 ${hi} 张，应为 ${HI_TARGET[tier]}`)
  for (const r of t) {
    for (const [k, n] of Object.entries(r.cost)) if (n > 3) errors.push(`${r.name}: ${AR[k]} 单项 ${n} > 3`)
  }
}

const fmt = (cost) => Object.entries(cost).map(([k, n]) => `${n} ${AR[k]}`).join(' ')
const tally = (u) => TYPES.map((t) => `${AR[t]} ${u[t]}`).join(' / ')
const grand = Object.fromEntries(TYPES.map((t) => [t, usage[3][t] + usage[2][t] + usage[1][t]]))
console.log('所需 AR 总需求:', tally(grand))
for (const tier of [3, 2, 1]) console.log(`  ${TIER_CCF[tier]} 档:`, tally(usage[tier]))

const lines = [
  '# VC / FC 表 · 会议卡 90 张 + 会士卡牌池 10 张',
  '',
  '> 由 `node tools/vc-matrix.js` 生成。会议卡改 `BONUS` / `INPUTS` / `HI`，会士卡改 `shared/nobles.js`，不要手改本文件。',
  '',
  '## VC（会议卡）',
  '',
  '规则：',
  '- **产出 AR**：这个领域主要对外贡献的资源。各档每类张数固定（A 4 / B 6 / C 8），五类各 18 张，沿用现有牌库分布。',
  '- **产出结算**：买卡**不发筹码**，只把 `player.bonus[产出色]` 永久 +1 —— 既是该色折价（买卡时 `cost - bonus`），也是会士卡的判分口径。筹码只能靠「拿取」动作进手，和 splendor-chinese 的 `BuyCardAction.addBonus` 同一口径。界面上已买论文用一枚卡牌图标 + 右上角计数单独表示（`client` 的 `.vc-mark`）。',
  '- **所需 AR**：这个领域主要消耗的资源。总成本随档位递增 —— C 4~5、B 6~7、A 8~9；成本类数 C 2~3、B 3、A 3~4；单项 ≤ 3（2 人局每色只有 4 枚筹码）。',
  '- 用哪几类由脚本在"领域输入偏好表"内按档位自动配平，保证五种 AR 的总需求相当，不出现没人要的废色。',
  '- **声誉**：C 4→0 / 5→1，B 6→2 / 7→3，A 8→4 / 9→5。高总成本张数对齐官方（A 4 / B 9 / C 16）。',
  '- 咖啡（万能牌）不属于 AR：不作任何卡的产出，也不写进成本。',
  '',
  '| 档 | 英文名 | 中文 | 所需 AR | 产出 AR | 声誉 |',
  '| --- | --- | --- | --- | --- | --- |'
]
for (const tier of [3, 2, 1]) {
  for (const r of rows.filter((x) => x.tier === tier)) {
    lines.push(`| ${TIER_CCF[tier]} | ${r.name} | ${r.cn} | ${fmt(r.cost)} | ${AR[r.bonus]} | ${r.prestige} |`)
  }
}

// FC（会士卡）直接读 shared/nobles.js，注册表就是唯一事实来源
const pool = NOBLES.filter((n) => n.enabled)
const bench = NOBLES.filter((n) => !n.enabled)
const nobleCost = Object.fromEntries(TYPES.map((t) => [t, 0]))
for (const n of pool) {
  for (const [k, v] of Object.entries(n.requirement)) {
    if (!(k in nobleCost)) errors.push(`${n.name}: 需要未知资源 ${k}`)
    else nobleCost[k] += v
  }
}
const nobleTotals = Object.values(nobleCost)
if (nobleTotals.some((v) => v !== nobleTotals[0])) {
  errors.push(`会士牌池五种资源需求不等: ${tally(nobleCost)}`)
}
lines.push(
  '',
  '## FC（会士卡）',
  '',
  '判分口径和 VC 不同：会士不看手上筹码，看**已发表论文累计的产出 AR**（`checkNobleVisit` 比的是 `player.bonus`），所以成本一律是 4 或 3 个整资源，不折价。',
  '',
  `- **声誉一律 ${pool[0]?.prestige} 分**，对齐官方 10 张贵族都值 3 分；卡与卡之间只靠成本形状拉开差别。`,
  '- 双色卡走 4+4，三色卡走 3+3+3，两种形状总数相等（都 8 个资源），没有"更贵"的那一档。卡名里的 Fellow/Member 跟各机构自己的正式头衔走，不表示形状——所以 RS Fellow 是三个 3（英国皇家学会的成员正式称谓就是 Fellow，FRS，没有 "RS Member" 这个头衔）。',
  `- 牌池按"人数 + 1"翻 5 张，${pool.length} 张够 4 人局轮换；bench 不进牌池，想换卡改 \`enabled\` 即可。`,
  `- 五种资源在牌池里的总需求各 ${nobleTotals[0]} 点（合计 ${nobleTotals.reduce((a, b) => a + b, 0)}），没有废色。`,
  '',
  '| 英文名 | 费用 Cost | 声誉 |',
  '| --- | --- | --- |'
)
console.log('FC 牌池资源需求:', tally(nobleCost))
for (const n of pool) lines.push(`| ${n.name} | ${fmt(n.requirement)} | ${n.prestige} |`)
lines.push('', 'bench（不进牌池）：', '', '| 英文名 | 费用 Cost | 声誉 |', '| --- | --- | --- |')
for (const n of bench) lines.push(`| ${n.name} | ${fmt(n.requirement)} | ${n.prestige} |`)
mkdirSync(join(ROOT, 'docs'), { recursive: true })
writeFileSync(join(ROOT, 'docs/VC-MATRIX.md'), lines.join('\n') + '\n')

if (process.argv.includes('--write')) {
  // bonus 写字符串（运行时 player.bonus[card.bonus]++）；cost 保持领域典型程度顺序
  const keyCost = (cost) => `{ ${Object.entries(cost).map(([k, n]) => `${k}: ${n}`).join(', ')} }`
  let out = src
  for (const r of rows) {
    const entry = new RegExp(
      `(\\{ id: '${r.id}',[^\\n]*?)(?:cost: \\{[^}]*\\}, bonus: '[^']*', prestige: \\d+, )?(art: \\{[^}]*\\} \\})`
    )
    if (!entry.test(out)) { errors.push(`写回定位不到 ${r.id}`); continue }
    out = out.replace(entry, `$1cost: ${keyCost(r.cost)}, bonus: '${r.bonus}', prestige: ${r.prestige}, $2`)
  }
  writeFileSync(join(ROOT, 'shared/venues.js'), out)
  console.log('已写回 shared/venues.js')
}

console.log(errors.length
  ? '\n校验未通过:\n' + errors.map((e) => '  - ' + e).join('\n')
  : `\n校验通过：VC ${rows.length} 行产出配额 / 成本档位 / 声誉张数合规，FC 牌池 ${NOBLES.filter((n) => n.enabled).length} 张五种资源需求等量。`)
console.log('已写出 docs/VC-MATRIX.md')
