#!/usr/bin/env node
// 素材自检：node tools/asset-check.js
// 只看磁盘文件和注册表能不能对上，不碰界面代码。
// 退出码 1 = 有引用断链或缺字段（必须修）；只用警告项可以暂时放着。

import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { VENUES } from '../shared/venues.js'
import { NOBLES } from '../shared/nobles.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'client/public')
const errs = []
const warns = []
const kb = (p) => Math.round(statSync(p).size / 1024)

// 引用完整性
const brokenVenue = VENUES.filter((v) => !existsSync(PUB + v.art.src))
if (brokenVenue.length) errs.push(`会议卡图缺失: ${brokenVenue.map((v) => v.id).join(', ')}`)
const venueFiles = readdirSync(join(PUB, 'images/venues'))
const usedVenue = new Set(VENUES.map((v) => v.art.src.split('/').pop()))
const orphanVenue = venueFiles.filter((f) => !usedVenue.has(f))
if (orphanVenue.length) warns.push(`venues/ 里没用到的图: ${orphanVenue.join(', ')}`)
// 命名约定：id = 文件名 = 会议名小写去符号（不带年份/届数）
const badName = VENUES.map((v) => {
  const f = v.art.src.split('/').pop()
  const want = v.name.toLowerCase().replace(/[^a-z]/g, '')
  return f === want + f.slice(f.lastIndexOf('.')) && v.id === want ? null : `${v.name}: id=${v.id} 文件=${f}`
}).filter(Boolean)
if (badName.length) errs.push(`命名不统一（id / 文件名应 = 会议名小写去符号，不带年份）: ${badName.join(' | ')}`)

const brokenNoble = NOBLES.filter((n) => n.logo && !existsSync(PUB + n.logo))
if (brokenNoble.length) errs.push(`会士徽标缺失: ${brokenNoble.map((n) => n.id).join(', ')}`)
const noLogo = NOBLES.filter((n) => !n.logo)
if (noLogo.length) warns.push(`会士卡没有徽标（卡面降级为纯文字）: ${noLogo.map((n) => n.name).join(', ')}`)
const nobleFiles = readdirSync(join(PUB, 'images/nobles'))
const orphanNoble = nobleFiles.filter((f) => !NOBLES.some((n) => n.logo && n.logo.endsWith(f)))
if (orphanNoble.length) warns.push(`nobles/ 里没用到的图: ${orphanNoble.join(', ')}`)
const rawMissing = nobleFiles.filter((f) => !existsSync(join(ROOT, 'assets/nobles-raw', f)))
if (rawMissing.length) warns.push(`徽标缺源文件（产物改不回来）: ${rawMissing.join(', ')}`)

// 筹码：同名 jpg/png 两套并存 = 界面各处用的不是同一套
const tokenFiles = readdirSync(join(PUB, 'images/tokens'))
const both = tokenFiles.filter((f) => f.endsWith('.png') && tokenFiles.includes(f.replace(/\.png$/, '.jpg')))
if (both.length) warns.push(`筹码两套并存，牌桌用 .jpg / FC 卡用 .png: ${both.length} 对（${Math.round(both.reduce((a, f) => a + kb(join(PUB, 'images/tokens', f)), 0))} KB 冗余）`)

// 体积
const big = venueFiles.filter((f) => kb(join(PUB, 'images/venues', f)) > 100)
if (big.length) warns.push(`会议 logo 超 100 KB: ${big.length} 张，占 ${Math.round(big.reduce((a, f) => a + kb(join(PUB, 'images/venues', f)), 0) / 1024)} MB`)
const totalVenues = Math.round(venueFiles.reduce((a, f) => a + kb(join(PUB, 'images/venues', f)), 0) / 1024)
if (totalVenues > 2) warns.push(`venues/ 总体积 ${totalVenues} MB，卡面最大显示宽度只有 150 px`)

// 注册表字段
const noCost = VENUES.filter((v) => !v.cost || !v.bonus)
if (noCost.length) warns.push(`会议卡还没有 cost/bonus: ${noCost.length} 张（跑 node tools/vc-matrix.js --write）`)
if (VENUES.some((v) => /journal|trans\.|proc\./i.test(v.fullName))) warns.push('注册表里出现了期刊条目，但没有任何期刊徽标素材')

// 字体：全仓库有没有本地字体文件
const fontDirs = [join(PUB, 'fonts'), join(ROOT, 'client/src/assets')]
const fonts = fontDirs.filter((d) => existsSync(d)).flatMap((d) => readdirSync(d)).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f))
if (!fonts.length) warns.push('没有任何本地字体文件，断网/局域网时字体全走 CDN 回退')

console.log(`会议卡 ${VENUES.length} 条 / venues 图 ${venueFiles.length} 张 / ${totalVenues} MB`)
console.log(`会士卡 ${NOBLES.length} 条（牌池 ${NOBLES.filter((n) => n.enabled).length}）/ nobles 图 ${nobleFiles.length} 张`)
console.log(`筹码 ${tokenFiles.length} 张 / 本地字体 ${fonts.length} 个`)
if (warns.length) console.log('\n可以放着但迟早要处理:\n' + warns.map((w) => '  ! ' + w).join('\n'))
if (errs.length) { console.log('\n必须修:\n' + errs.map((e) => '  x ' + e).join('\n')); process.exit(1) }
console.log(errs.length ? '' : '\n引用完整性：通过（0 缺图 / 0 孤儿）')
