import os, zipfile, sys

root = os.getcwd()
out_dir = os.path.join(root, 'release')
os.makedirs(out_dir, exist_ok=True)
zip_path = os.path.join(out_dir, 'yanci-app.zip')

include_dirs = ['css', 'js', 'icons', 'data', 'scripts']
include_files = ['index.html', '404.html', 'manifest.webmanifest', 'sw.js', '.nojekyll', '.gitignore', 'README.md', 'LICENSE', 'NOTICE.md']
exclude_dirs = {'data-src', '.chrome-test', '.chrome-test2', 'release', 'tests', '.git'}

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in include_files:
        p = os.path.join(root, f)
        if os.path.isfile(p):
            z.write(p, f)
    for d in include_dirs:
        base = os.path.join(root, d)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in exclude_dirs]
            for fn in filenames:
                if fn.startswith('.') and fn not in ('.nojekyll', '.gitignore'):
                    continue
                p = os.path.join(dirpath, fn)
                rel = os.path.relpath(p, root).replace(os.sep, '/')
                z.write(p, rel)

size = os.path.getsize(zip_path)
print('zip', zip_path, 'bytes', size, 'MB', round(size/1048576, 2))
with zipfile.ZipFile(zip_path) as z:
    names = z.namelist()
    print('files', len(names))
    for n in names[:20]:
        print(' ', n)
