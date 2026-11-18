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
| B2 | **Claude Code のフック（リポジトリの `.claude/settings.json`）**: 開始時に自動で fetch して「本番より遅れている・push していないコミットがある・コミットしていない変更がある」を表示。終わるときに push 忘れを知らせる | ◎ **入れた**（2026-11-18。`tools/git-sync-check.sh`。下の 4） |
| B3 | git の設定: `pull.ff only`（勝手にマージしない）・`fetch.prune true`（消えたブランチを片付ける）・`push.autoSetupRemote true`（初めての push を簡単に） | ○ 各 PC で1回設定 |
| B4 | `git worktree` で、作業ごとに別のフォルダ | ○ 2つの作業を並行するときだけ |
| B5 | 本番ブランチの保護（直接 push を禁止） | △ 事故の予防になるが、自動マージの仕組み（`GITHUB_TOKEN` でのマージ）と合うか確かめてから |
| B6 | OneDrive・Dropbox・Google ドライブで、フォルダごと PC 間を同期 | × 使わない（`.git` の中が壊れる・`config.php` やデータベースまで同期されて衝突する） |
| B7 | ファイルの変更を見張って、自動でコミット・push | × 使わない（自動マージなので、途中の壊れた状態が本番に出る） |

### C. Git の外で、PC ごとにそろえるもの

| # | もの | どうするか |
|---|---|---|
| C1 | **ユーザーとの約束**（返事は日本語・「変えたこと／確かめたこと／確かめていないこと」など） | いまは claude.ai の個人設定にある。**PC の Claude Code が同じように読むとは限らない**ので、各 PC の `~/.claude/CLAUDE.md`（どのアプリでも共通の約束）に同じ文を置く。このアプリだけの約束は、これまでどおり `docs/HANDOFF.md`（Git で全 PC にそろう） |
| C2 | 開発の道具 | PHP 7.4 以上（`pdo_sqlite`・`gd`）・Node.js・Playwright（Chromium）・`timeout` コマンド。MariaDB は手元になくてよい（CI の `mariadb` で確かめる）。**Windows では WSL2（Ubuntu）の中に clone する**（画面テストが `bash`・`TZ=Asia/Tokyo` を使うため。`/mnt/c` の下より WSL の中のほうが速い）。Mac は Homebrew。手順は下の 6 |
| C3 | 改行コード | Windows で CRLF にならないよう、リポジトリに `.gitattributes`（`* text=auto eol=lf`）を置いた（2026-11-18。いまのファイルは、すべて LF で、変わったファイルはない） |
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

## 4. 入れたもの（2026-11-18）

- **開始時の確認**（B2）: `.claude/settings.json` の SessionStart フック（`startup|resume`）が `tools/git-sync-check.sh` を動かす。GitHub から取得して（取得できなくても、セッションは止めない）、次のときだけ知らせる。知らせは Claude にも届くので、Claude は先にそれを片付ける。
  - 本番ブランチの上にいる（作業ブランチを作るよう案内）
  - 本番ブランチに、手元にないコミットがある（ほかの PC・クラウドの作業）
  - このブランチは、すべて本番に取り込みずみ（新しい作業ブランチで始める）
  - GitHub の同じブランチに、手元にないコミットがある／push していないコミットがある
  - コミットしていない変更がある
- 終わるときの「push 忘れ」の知らせ（Stop フック）は、**入れていない**（Claude の返事のたびに動き、作業の途中でも毎回出てうるさいため）。代わりに、上の開始時の確認と、方針の 4（PC を離れる前に push）で防ぐ。
- 初めてそのフォルダで Claude Code を開くと、フォルダを信頼するかを聞かれる。信頼したあとから、このフックが動く。止めたいときは、Claude Code の `/hooks` で見られる。
- **改行コード**（C3）: `.gitattributes`（`* text=auto eol=lf`。画像・PDF・`.bcmap`・`.whl` はバイナリ）。

## 5. 移行のときに確かめたこと（2026-11-18）

- 本番ブランチの先頭は、PR #59（v1.115.0）のマージ（`e597630`）。GitHub にある作業ブランチ（`claude/**`）は、PR #49（`claude/elegant-thompson-36amuu`。引き継ぎメモだけで、中身はメモに取り込みずみ）のほかは、すべて本番ブランチに取り込まれている。**クラウドだけにある作業は残っていない**ので、PC では本番ブランチを clone すれば最新から始められる。

## 6. PC ごとの準備（1回だけ）

PC は3台: **個人用の Mac**・**会社用の Windows 11**・**個人用の Windows 11**。どの PC でも、最後に「確かめ」を流して、全部が通ることを見る。

### 6-1. Mac（個人用）

1. ターミナルで、道具を入れる。Homebrew がなければ、先に https://brew.sh の1行で入れ、終わりに表示される「Next steps」の2行（`brew shellenv` を `~/.zprofile` に足す行）も実行する。

```bash
xcode-select --install
```

```bash
brew install git gh php node coreutils
```

2. `coreutils` の `timeout` を使えるようにする（画面テストの `run.sh` が使う。Mac には標準で無い）。

```bash
echo 'export PATH="$(brew --prefix)/opt/coreutils/libexec/gnubin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

3. Playwright（CI と同じ版）と Chromium。

```bash
npm install -g playwright@1.56.1 && playwright install chromium
```

4. Claude Code: **Claude デスクトップアプリ**（Code のタブ）を入れて、ログインする。ターミナルで使うなら、公式の手順（https://code.claude.com/docs/en/setup）で `claude` も入れる。コンピューター操作は、デスクトップアプリの設定で入れる（macOS 14 以上。アクセシビリティと画面収録の許可がいる）。

### 6-2. Windows 11（会社用・個人用。同じ手順）

**おすすめ: WSL2（Ubuntu）の中で作業する**。Mac・CI（Ubuntu）と同じ作りになり、テストがそのまま動く。

1. PowerShell（管理者）で WSL2 と Ubuntu を入れて、再起動する。

```powershell
wsl --install -d Ubuntu
```

2. Ubuntu のターミナルで、道具を入れる。

```bash
sudo apt-get update && sudo apt-get install -y git gh php-cli php-sqlite3 php-gd php-mbstring php-curl curl
```

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
```

```bash
sudo npm install -g playwright@1.56.1 && sudo npx playwright install --with-deps chromium
```

3. Claude Code: **Ubuntu のターミナルの中で** `claude` を入れる（公式の手順の Linux 用。PowerShell では入れない）。Claude デスクトップアプリの Code のタブからも、WSL2 の中のフォルダを開ける（`\\wsl.localhost\Ubuntu\home\<名前>\dev\schedule-management`）。ただし WSL のセッションでは、プラグインが使えない・ファイルの欄が見るだけ、などの制限がある。
4. Windows のアプリ・ブラウザを Claude に操作してもらうとき（コンピューター操作）は、Windows 側の Claude デスクトップアプリで行う（Pro・Max・Ultra のプランだけ。Team・Enterprise では使えない）。
5. **会社用の PC で WSL2 を入れられない**（会社の決まり・管理者の権限がない）ときの代わり: Windows に Git for Windows（Git Bash 付き）・PHP・Node.js を入れて、ふつうのフォルダに clone する。PHP 単体テスト（`php tests/run.php`）は手元で、画面テストは CI に任せる。**先に会社の IT の決まりを確かめる**。

### 6-3. どの PC でも（Mac・Windows の WSL の中）

1. GitHub にログイン（ブラウザで認証。トークンをチャットに貼らない）。

```bash
gh auth login
```

```bash
gh auth setup-git
```

2. git の設定（名前とメールは、コミットに付く。メールは GitHub の設定 › Emails にある `…@users.noreply.github.com` を使うと、本当のアドレスが公開されない）。

```bash
git config --global user.name "<名前>" && git config --global user.email "<メール>"
```

```bash
git config --global pull.ff only && git config --global fetch.prune true && git config --global push.autoSetupRemote true && git config --global init.defaultBranch main
```

3. clone する（場所は `~/dev` にそろえる。Windows では WSL の中の `~/dev`。`/mnt/c` の下には置かない）。

```bash
mkdir -p ~/dev && cd ~/dev && git clone https://github.com/blackout0802/schedule-management.git
```

4. 共通の約束を、`~/.claude/CLAUDE.md` に置く（C1）。claude.ai の個人設定（返事は日本語・3つの見出し・テストは全部 など）と同じ文を貼る。**3台とも同じ文にする**（変えたら、3台ともそろえる）。
5. 確かめ（全部が通れば、準備できた）。

```bash
cd ~/dev/schedule-management && php tests/run.php
```

```bash
bash tests/e2e/run.sh agenda insp
```

- **Mac の注意（2026-11-18、個人用 Mac で確かめた）**: Homebrew の `php` は最新（8.5）で、画面テストが落ちる。`brew install php@8.3` を足し、確かめの前に `export PATH=/opt/homebrew/opt/php@8.3/bin:$PATH`（`~/.zshrc` に書いてもよい）。また、この GD では単体テスト「画像: 長辺2000pxまで縮める」が1件落ちる（アプリ側の話。`docs/HANDOFF.md` の 6）。
- clone は iCloud・OneDrive など、クラウド同期されるフォルダの外（`~/dev`）に置く（Mac の「書類」「デスクトップ」は、iCloud の同期をオンにしていると対象になる）。

6. Claude Code でフォルダを開き、初めの知らせ（【Git の同期の確認】）が出ることを見る。
