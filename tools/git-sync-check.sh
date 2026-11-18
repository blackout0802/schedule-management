#!/usr/bin/env bash
# Claude Code の SessionStart フックから呼ぶ。手元のフォルダと GitHub が一致しているかを短く知らせる。
# 何があっても終了コード 0（セッションの開始を止めない）。Mac（bash 3.2）・Windows（Git Bash）・Linux・WSL で動く書き方にする。
PROD=claude/intelligent-brahmagupta-qhk963
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

echo "【Git の同期の確認】（tools/git-sync-check.sh。方針は docs/WORKFLOW.md）"
if GIT_TERMINAL_PROMPT=0 git fetch --quiet --prune origin 2>/dev/null; then :; else
  echo "- GitHub から取得できませんでした（ネットワーク・ログインを確かめる）。下は前回取得した時点の比較です。"
fi

BR=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(ブランチなし)")
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "- いまのブランチ: $BR"

if [ "$BR" = "$PROD" ]; then
  echo "- 注意: 本番ブランチの上にいます。直接 push しないで、作業ブランチを作ってください: git switch -c claude/<内容> origin/$PROD"
fi

if git rev-parse --verify --quiet "origin/$PROD" >/dev/null; then
  BEHIND=$(git rev-list --count "HEAD..origin/$PROD" 2>/dev/null || echo 0)
  [ "$BEHIND" != "0" ] && echo "- 本番ブランチに、まだ手元にないコミットが $BEHIND 件あります（ほかの PC やクラウドの作業）。"
  if [ "$BR" != "$PROD" ] && [ "$DIRTY" = "0" ] && git merge-base --is-ancestor HEAD "origin/$PROD" 2>/dev/null; then
    echo "- このブランチの中身は、すべて本番に取り込みずみです。新しい作業は、本番の最新から作業ブランチを作って始める。"
  fi
fi

if git rev-parse --verify --quiet '@{u}' >/dev/null 2>&1; then
  set -- $(git rev-list --left-right --count '@{u}...HEAD' 2>/dev/null)
  [ "${1:-0}" != "0" ] && echo "- GitHub の $BR に、手元にないコミットが $1 件あります（git pull --ff-only で取り込む）。"
  [ "${2:-0}" != "0" ] && echo "- まだ push していないコミットが $2 件あります。"
else
  UNPUSHED=$(git rev-list --count HEAD --not --remotes=origin 2>/dev/null || echo 0)
  [ "$UNPUSHED" != "0" ] && echo "- このブランチは GitHub にまだありません（push していないコミット $UNPUSHED 件）。"
fi

[ "$DIRTY" != "0" ] && echo "- コミットしていない変更が $DIRTY 件あります（前の作業の続きか、確かめる）。"
exit 0
