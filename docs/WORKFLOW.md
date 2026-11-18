# 作業の進め方の基本方針（ローカルの PC で作業して、Git と一致させる）

決めた日: 2026-11-18（ユーザーの希望。これまでのクラウドのセッション中心から、ローカルの PC 中心へ）

## 0. なぜ変えるか

- これまでは、複数の PC で作業するため、クラウドのセッション（claude.ai/code）で作業していた。
- これからは、作業する PC を Claude に操作してほしい場面（PC のブラウザで本番の画面を見る・手元の PDF や Excel を使う・PC のアプリを動かす）が増える。
- そこで、**作業は PC の手元のフォルダ（Git の clone）で行い、GitHub を「正（ただ1つの元）」にして、どの PC も GitHub と一致させる**。

## 1. 基本方針（おすすめの組み合わせ。これを標準にする）

1. **GitHub が正**。PC の手元のフォルダは、GitHub の写し。PC どうしで直接ファイルを受け渡さない（USB・共有フォルダ・クラウドドライブの同期は使わない）。
2. **各 PC に Claude Code（Claude デスクトップアプリ、またはターミナルの `claude`）を入れ、手元の clone で作業する**。
3. **始めるとき**: `git fetch` して、本番ブランチ（`claude/intelligent-brahmagupta-qhk963`）の最新から、新しい作業ブランチを作る。
4. **終わるとき**（区切りごと・PC を離れる前）: コミットして、作業ブランチを push する。push すると、これまでどおり自動 PR → CI → 自動マージ → 本番に反映（`docs/HANDOFF.md` の 3）。**手元にだけある変更を残して PC を離れない**。
5. **作業ブランチの名前は `claude/<内容>`**（例: `claude/insp-import-fix`）。自動 PR（`auto-pr.yml`）は `claude/**` だけを見るため。**1つの作業ブランチは、1台の PC だけで触る**（別の PC で続けるときは、先に push して、次の PC で `git fetch` してから同じブランチを取り出す）。
6. **本番ブランチには直接 push しない**（これまでどおり）。
7. **クラウドのセッションは、補助として使ってよい**（PC を閉じている間に任せたい長い作業・スマホからの作業）。そのときも、同じく作業ブランチに push して終える。PC に戻ったら `git fetch` して続ける。
8. 引き継ぎメモ（`docs/HANDOFF.md`）は、これまでどおり区切りごとに更新して push する。**どの PC・どのセッションでも、メモが Git にあるので同じ状態から始められる**。

## 2. 考えられる手段（思いつく限り）と評価

### A. Claude をどこで動かすか

| # | 手段 | よい点 | 気になる点 | 評価 |
|---|---|---|---|---|
| A1 | **各 PC の Claude Code（デスクトップアプリ／CLI）で、手元の clone を直接さわる** | PC のブラウザ・ファイル・アプリを使える。本番のサイトも見られる（クラウドからは見えなかった）。待ち時間が短い | PC ごとに、PHP・Node・Playwright などの準備がいる | ◎ **標準** |
| A2 | クラウドのセッションのまま、Remote Control で PC のフォルダをつなぐ | クラウドの会話のまま、PC のフォルダで動かせる | PC で Claude アプリ（Remote Control）が動いている必要がある。まだ全員に使えるわけではない。1つのセッションは最初につないだ1台の PC に固定 | △ 試す価値はあるが、標準にしない |
| A3 | PC の Claude Code を、スマホや別の PC から Remote Control で操作する | 外出中も、PC の作業を続けられる | PC を起動しておく必要がある | ○ 補助 |
| A4 | ローカル中心＋重い作業だけクラウド（Claude Code の web／`claude --remote`）。結果は作業ブランチ経由で PC に取り込む | PC を閉じていても進む。トークンや PC の負担の調整ができる | 2か所で同じブランチを同時に触らないよう注意 | ○ 補助（方針の 7） |
| A5 | Claude デスクトップの「コンピューター操作」や Claude in Chrome で、PC のアプリ・ブラウザを操作 | 本番の画面の確認・管理画面の操作など、「PC を操作してほしい」ことそのもの | 操作のたびに許可がいる。パスワードの入力は自分で | ○ A1 と組み合わせる |
| A6 | GitHub Codespaces・devcontainer（どの PC でも同じクラウドの開発環境） | 環境の差がなくなる | PC の操作という目的には合わない（クラウドと同じ） | × 今回の目的には不要 |

### B. 手元と GitHub を一致させる方法

| # | 手段 | 評価 |
|---|---|---|
| B1 | **始める前に `git fetch` → 本番ブランチから作業ブランチ、終わりに push（手順の約束）** | ◎ 標準（方針の 3・4） |
| B2 | **Claude Code のフック（リポジトリの `.claude/settings.json`）**: 開始時に自動で fetch して「本番より遅れている・push していないコミットがある・コミットしていない変更がある」を表示。終わるときに push 忘れを知らせる | ◎ 入れるとよい（まだ入れていない。下の 4） |
| B3 | git の設定: `pull.ff only`（勝手にマージしない）・`fetch.prune true`（消えたブランチを片付ける）・`push.autoSetupRemote true`（初めての push を簡単に） | ○ 各 PC で1回設定 |
| B4 | `git worktree` で、作業ごとに別のフォルダ | ○ 2つの作業を並行するときだけ |
| B5 | 本番ブランチの保護（直接 push を禁止） | △ 事故の予防になるが、自動マージの仕組み（`GITHUB_TOKEN` でのマージ）と合うか確かめてから |
| B6 | OneDrive・Dropbox・Google ドライブで、フォルダごと PC 間を同期 | × 使わない（`.git` の中が壊れる・`config.php` やデータベースまで同期されて衝突する） |
| B7 | ファイルの変更を見張って、自動でコミット・push | × 使わない（自動マージなので、途中の壊れた状態が本番に出る） |

### C. Git の外で、PC ごとにそろえるもの

| # | もの | どうするか |
|---|---|---|
| C1 | **ユーザーとの約束**（返事は日本語・「変えたこと／確かめたこと／確かめていないこと」など） | いまは claude.ai の個人設定にある。**PC の Claude Code が同じように読むとは限らない**ので、各 PC の `~/.claude/CLAUDE.md`（どのアプリでも共通の約束）に同じ文を置く。このアプリだけの約束は、これまでどおり `docs/HANDOFF.md`（Git で全 PC にそろう） |
| C2 | 開発の道具 | PHP 7.4 以上（`pdo_sqlite`）・Node.js・Playwright（Chromium）。MariaDB は手元になくてよい（CI の `mariadb` で確かめる）。**Windows では WSL2（Ubuntu）の中に clone する**（画面テストが `bash`・`TZ=Asia/Tokyo` を使うため。`/mnt/c` の下より WSL の中のほうが速い）。Mac は Homebrew |
| C3 | 改行コード | Windows で CRLF にならないよう、リポジトリに `.gitattributes`（`* text=auto eol=lf`）を置くとよい（まだ入れていない。下の 4） |
| C4 | `config.php`・`data/` | Git に入らない（`.gitignore`）。各 PC で `config.sample.php` から作る。本番の設定や鍵は PC に置かない・コミットしない |
| C5 | GitHub へのログイン | 各 PC で `gh auth login` か、Git の資格情報マネージャー。トークンはチャットに貼らない |

## 3. 1回の作業の流れ（ローカル）

```bash
cd schedule-management
git fetch origin
git switch -c claude/<内容> origin/claude/intelligent-brahmagupta-qhk963
```

- Claude に頼む（Claude は、始めに `CLAUDE.md` → `docs/HANDOFF.md` を読む）。
- 確かめる: `php tests/run.php`、`bash tests/e2e/run.sh <関係するテスト>`（全部をまとめて流すのは、`docs/HANDOFF.md` の 2 の約束どおり）。
- 区切りで:

```bash
git push -u origin claude/<内容>
```

- 自動 PR → CI → 自動マージ → 本番に反映。反映できたかは、GitHub の Actions で確かめる（ローカルなら、本番の画面も PC のブラウザで見られる）。
- 別の PC で続けるときは、その PC で:

```bash
git fetch origin
git switch claude/<内容>
```

（すでに本番に取り込まれたあとなら、新しい作業ブランチを本番ブランチから作り直す）

## 4. これから入れるとよいもの（まだ入れていない）

1. `.claude/settings.json` に、開始時の確認のフック（B2）。
2. `.gitattributes`（C3）。
3. 各 PC の準備の手順（C2）を、PC の OS が決まったら、ここに書き足す。

## 5. 移行のときに確かめたこと（2026-11-18）

- 本番ブランチの先頭は、PR #59（v1.115.0）のマージ（`e597630`）。GitHub にある作業ブランチ（`claude/**`）は、PR #49（`claude/elegant-thompson-36amuu`。引き継ぎメモだけで、中身はメモに取り込みずみ）のほかは、すべて本番ブランチに取り込まれている。**クラウドだけにある作業は残っていない**ので、PC では本番ブランチを clone すれば最新から始められる。
