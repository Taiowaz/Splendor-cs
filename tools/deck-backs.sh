#!/usr/bin/env bash
# 卡背：assets/decks-raw/deck-back-{A,B,C}.jpg（1024x1536 母图）
#      → client/public/images/decks/crest-{A,B,C}.jpg
#
# 白边照原版：印刷卡画面四周留一圈白纸芯，而且四边等宽（不是按长短边等比）。
# 400x600 留 16px 等宽边 → 内框 368x568，已经不是 2:3 了。这里用 ! 强行压进
# 368x568（竖向缩 2.9%）而不是裁：裁的话左右各吃掉母图 14px，正好把纹章外框
# 到画边的留白削掉，边框就贴到白边上了；缩 2.9% 看不出来，母图一点不损。
# 等宽边在屏上也等宽（400x600 按 6:9 显示，16px 横竖都变 2.6px）。
# 显示宽度最大 ~180px，400x600 留了 2 倍余量。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p client/public/images/decks
for t in A B C; do
  convert "assets/decks-raw/deck-back-$t.jpg" \
    -resize 368x568! \
    -bordercolor '#f6f0e2' -border 16x16 \
    -quality 86 "client/public/images/decks/crest-$t.jpg"
done
