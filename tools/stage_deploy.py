#!/usr/bin/env python3
"""サーバーへ反映するファイルを、フォルダにそろえる（GitHub Actions の自動反映が使う）。

  python3 tools/stage_deploy.py DIR      → public / src / sql / bin のアプリのファイルを、フォルダ DIR にコピーする

入れるもの: public / src / sql / bin
入れないもの: config.php、install.php、app_path.php、.htaccess（ドットで始まるファイル）、tests、docs（サーバー固有・不要なもの）
"""
import os
import re
import shutil
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = re.search(r"APP_VERSION = '([^']+)'", open(os.path.join(root, 'src/version.php'), encoding='utf-8').read()).group(1)
exclude = {'public/install.php', 'public/app_path.php'}
allowed_ext = {'.php', '.js', '.css', '.sql', '.png', '.svg', '.ico', '.json', '.txt'}

if len(sys.argv) != 2:
    sys.exit(__doc__)
stage = os.path.abspath(sys.argv[1])


def targets():
    """反映に入れるファイル（サーバーのアプリのフォルダからの相対パス）"""
    for top in ('public', 'src', 'sql', 'bin'):
        for d, _, files in os.walk(os.path.join(root, top)):
            for f in sorted(files):
                path = os.path.join(d, f)
                rel = os.path.relpath(path, root).replace(os.sep, '/')
                if rel in exclude or f.startswith('.') or os.path.splitext(f)[1].lower() not in allowed_ext or f == 'config.php':
                    continue
                yield path, rel


if os.path.isdir(stage):
    shutil.rmtree(stage)
count = 0
for path, rel in targets():
    dst = os.path.join(stage, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(path, dst)
    count += 1
print(f'{stage}  ({count} files, v{version})')
