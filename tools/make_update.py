#!/usr/bin/env python3
"""更新用の zip を作る。管理者メニューの「システム更新」で、この zip を選ぶだけで更新できる。

  python3 tools/make_update.py          → dist/update-v<バージョン>.zip

入れるもの: public / src / sql / bin
入れないもの: config.php、install.php、app_path.php、.htaccess、tests、docs（サーバー固有・不要なもの）
"""
import os
import re
import sys
import zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = re.search(r"APP_VERSION = '([^']+)'", open(os.path.join(root, 'src/version.php'), encoding='utf-8').read()).group(1)
exclude = {'public/install.php', 'public/app_path.php'}
allowed_ext = {'.php', '.js', '.css', '.sql', '.png', '.svg', '.ico', '.json', '.txt'}
out_dir = os.path.join(root, 'dist')
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, f'update-v{version}.zip')
count = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for top in ('public', 'src', 'sql', 'bin'):
        for d, _, files in os.walk(os.path.join(root, top)):
            for f in sorted(files):
                path = os.path.join(d, f)
                rel = os.path.relpath(path, root).replace(os.sep, '/')
                if rel in exclude or f.startswith('.') or os.path.splitext(f)[1].lower() not in allowed_ext or f == 'config.php':
                    continue
                z.write(path, rel)
                count += 1
    z.writestr('README_update.txt', f'''更新用ファイル  v{version}

■ いつもの更新（管理者の画面から）
  1. 管理者でログイン → 右上の名前 → 「システム更新」
  2. この zip を選び、管理者のパスワードを入れて「更新する」
  3. 「画面を開き直す」を押す（表示が古いときは Ctrl + F5）

■ 「システム更新」がまだ無い版からの、最初の1回だけ（FTP）
  1. この zip を展開する
  2. 中の public / src / sql / bin の4つのフォルダを、サーバーのアプリのフォルダ
     （config.php と同じ場所）へ、まとめてドラッグして「上書き」する
     ※ config.php はこの zip に入っていないので、そのままです
  3. ブラウザで画面を開き直す（Ctrl + F5）。データベースの変更は自動で行われます
  次回からは、上の「いつもの更新」だけで済みます。
''')
print(f'{out}  ({count} files, v{version})')
