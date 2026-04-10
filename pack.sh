#!/usr/bin/env bash
set -e

python -c "
import json, zipfile, os

exclude = {'.git', 'pack.sh', '.gitignore'}
version = json.load(open('manifest.json'))['version']
out = f'linkbox-{version}.zip'

with zipfile.ZipFile(out, 'w') as z:
    for f in os.listdir('.'):
        if f not in exclude and not f.endswith('.zip'):
            z.write(f)

print(f'Created {out}')
"
