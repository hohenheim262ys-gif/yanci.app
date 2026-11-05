import csv, json, re, sys

wanted = set(json.load(open('data-src/wanted.json', encoding='utf-8')))
out = {}
forms_keys = {'p':'past','d':'done','i':'ing','3':'third','s':'plural','r':'comparative','t':'superlative','0':'lemma','1':'lemma'}

with open('data-src/ecdict.csv', encoding='utf-8', newline='') as f:
    reader = csv.DictReader(f)
    for row in reader:
        w = (row.get('word') or '').strip().lower()
        if not w or w not in wanted or w in out:
            continue
        p = (row.get('phonetic') or '').strip()
        ex = (row.get('exchange') or '').strip()
        forms = []
        for part in ex.split('/'):
            if ':' not in part:
                continue
            k, v = part.split(':', 1)
            if k in ('p','d','i','3','s','r','t','0','1') and v:
                forms.append(v.strip().lower())
        out[w] = {'p': p, 'fm': forms[:8], 'tr': (row.get('translation') or '')[:300]}
        if len(out) >= len(wanted):
            break

json.dump(out, open('data-src/ecdict-subset.json','w',encoding='utf-8'), ensure_ascii=False)
print('matched', len(out), 'of', len(wanted))
missing = [w for w in wanted if w not in out]
print('missing sample', missing[:20])
