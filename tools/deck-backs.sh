#!/usr/bin/env bash
# 卡背：assets/decks-raw/deck-back-{A,B,C}.jpg（1024x1536 母图）
#      → client/public/images/decks/crest-{A,B,C}.jpg
# 400x600 是 2:3，和 .gb-deck img 的 aspect-ratio 对齐，显示宽度最大 ~180px，留了 2 倍余量。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p client/public/images/decks
for t in A B C; do
  convert "assets/decks-raw/deck-back-$t.jpg" -resize 400x600 -quality 86 \
    "client/public/images/decks/crest-$t.jpg"
done
