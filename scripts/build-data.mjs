import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'data-src');
const OUT = path.join(ROOT, 'js', 'data');
await fs.mkdir(SRC, { recursive: true });
await fs.mkdir(OUT, { recursive: true });

const URLS = {
  npeeStats: 'https://raw.githubusercontent.com/yikun-justcai/npee-vocab-statistics/HEAD/reports/stats.json',
  npeeWords: 'https://raw.githubusercontent.com/yikun-justcai/npee-vocab-statistics/HEAD/data/kaoyan_syllabus_verified.txt',
  wordCards: 'https://raw.githubusercontent.com/JTKING27/kaoyan-vocab-context/HEAD/assets/word_cards.json',
  wordRoot: 'https://raw.githubusercontent.com/skywind3000/ECDICT/HEAD/wordroot.txt',
  xiang: 'https://raw.githubusercontent.com/xiangjiawei1234-prog/kaoyan-vocab/HEAD/js/words-data.js',
  essayBase: 'https://raw.githubusercontent.com/IKTNF/kaoyan-english-writing-corpus/HEAD/data/',
};

async function fetchCached(name, url, { optional = false } = {}) {
  const file = path.join(SRC, name);
  try {
    const st = await fs.stat(file);
    if (st.size > 100) return await fs.readFile(file, 'utf8');
  } catch {}
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'yanci-build/1.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      const text = await res.text();
      if (!text || text.length < 50) throw new Error('empty ' + url);
      await fs.writeFile(file, text);
      return text;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 700 * attempt));
    }
  }
  if (optional) {
    console.warn('optional source failed:', name, lastErr?.message);
    return null;
  }
  throw lastErr;
}

function trim(v, n) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function bandOf(yi) {
  if (yi == null) return '扩展';
  if (yi >= 20) return '极高';
  if (yi >= 10) return '高频';
  if (yi >= 5) return '常考';
  if (yi >= 1) return '低频';
  return '未出现';
}

function parseXiang(text) {
  const start = text.indexOf('[', text.indexOf('window.WORDS_RAW'));
  const end = text.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error('cannot locate WORDS_RAW');
  const arr = JSON.parse(text.slice(start, end + 1));
  const map = new Map();
  for (const row of arr) {
    if (!Array.isArray(row) || !row[0]) continue;
    map.set(String(row[0]).toLowerCase(), {
      w: String(row[0]).toLowerCase(),
      ipa: String(row[1] || '').trim(),
      meaning: String(row[2] || '').trim(),
      pos: Number(row[3]) || 0,
      rank: Number(row[4]) || 0,
      count: Number(row[5]) || 0,
      papers: Number(row[6]) || 0,
      example: String(row[7] || '').trim(),
      source: String(row[8] || '').trim(),
      forms: String(row[10] || '').trim(),
    });
  }
  return map;
}

function parseForms(s) {
  const out = new Set();
  if (!s) return [];
  for (const part of String(s).split(/[；;]/)) {
    const m = part.match(/[:：]\s*(.+)$/);
    const raw = (m ? m[1] : part).trim();
    for (const t of raw.split(/[，,、/]/)) {
      const w = t.trim().toLowerCase();
      if (w && w.length > 1 && /^[a-z][a-z' -]*$/.test(w)) out.add(w);
    }
  }
  return [...out].slice(0, 8);
}

function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) || []);
}

const [statsTxt, wordsTxt, cardsTxt, rootsTxt, xiangTxt] = await Promise.all([
  fetchCached('npee-stats.json', URLS.npeeStats),
  fetchCached('npee-words.txt', URLS.npeeWords),
  fetchCached('word-cards.json', URLS.wordCards),
  fetchCached('wordroot.txt', URLS.wordRoot),
  fetchCached('xiang-words.js', URLS.xiang),
]);

const stats = JSON.parse(statsTxt);
const yearcount = stats.yearcount || {};
const syllabus = new Map();
for (const line of wordsTxt.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [w, ...rest] = line.split('\t');
  const word = String(w || '').trim().toLowerCase();
  if (word) syllabus.set(word, rest.join('\t').trim());
}
const cardsRaw = JSON.parse(cardsTxt);
const cards = new Map();
for (const [k, v] of Object.entries(cardsRaw)) cards.set(String(k).toLowerCase(), v);
const rootsRaw = JSON.parse(rootsTxt);
const xiang = parseXiang(xiangTxt);
let ecdict = {};
try { ecdict = JSON.parse(await fs.readFile(path.join(SRC, 'ecdict-subset.json'), 'utf8')); } catch (e) { console.warn('no ecdict subset'); }

const allWords = new Set([...syllabus.keys(), ...xiang.keys()]);

// word -> root refs
const rootWordMap = new Map();
const roots = [];
for (const [key, v] of Object.entries(rootsRaw)) {
  const item = {
    k: key,
    c: String(v.class || ''),
    m: String(v.meaning || ''),
    o: String(v.origin || ''),
    ex: Array.isArray(v.example) ? v.example.map(String).slice(0, 30) : [],
    fn: trim(v.function || '', 700),
  };
  roots.push(item);
  for (const ex of item.ex) {
    const w = String(ex).toLowerCase().trim();
    if (!w) continue;
    if (!rootWordMap.has(w)) rootWordMap.set(w, []);
    const arr = rootWordMap.get(w);
    if (!arr.includes(key)) arr.push(key);
  }
}

// essay files
const essayNames = ['01-quality','02-education','03-technology','04-society','05-environment','06-culture','07-health','08-career','09-family','10-describe','11-argue','12-proverb','13-upgrade','14-letter-general','15-letter-advice','16-letter-apply','17-notice'];
const essays = [];
const essayWordMap = new Map();
for (const name of essayNames) {
  const txt = await fetchCached('essay-' + name + '.json', URLS.essayBase + name + '.json', { optional: name === '16-letter-apply' });
  if (!txt) continue;
  const j = JSON.parse(txt);
  const topic = { id: j.id || name, title: j.title || name, emoji: j.emoji || '', group: j.group || '', desc: j.desc || '', entries: [] };
  for (const e of j.entries || []) {
    const entry = {
      en: String(e.en || '').trim(),
      zh: String(e.zh || '').trim(),
      pos: String(e.pos || ''),
      type: String(e.type || ''),
      example: String(e.example || '').trim(),
      exampleZh: String(e.exampleZh || '').trim(),
      note: trim(e.note || '', 300),
    };
    if (!entry.en) continue;
    topic.entries.push(entry);
    if (entry.example && entry.exampleZh) {
      for (const w of tokenize(entry.example)) {
        if (!allWords.has(w)) continue;
        if (!essayWordMap.has(w)) essayWordMap.set(w, []);
        const arr = essayWordMap.get(w);
        if (arr.length < 2 && !arr.some(x => x[0] === entry.example)) {
          arr.push([entry.example, entry.exampleZh, topic.title, entry.note]);
        }
      }
    }
  }
  essays.push(topic);
}
// full sample essays / templates
const idxTxt = await fetchCached('essay-00-index.json', URLS.essayBase + '00-index.json');
const tplTxt = await fetchCached('essay-18-templates.json', URLS.essayBase + '18-templates.json');
const idx = JSON.parse(idxTxt);
const samples = [];
for (const [partKey, part] of [['partB','B'], ['partA','A']]) {
  const years = idx[partKey]?.years || [];
  for (const y of years) {
    if (!y.model?.en) continue;
    samples.push({
      year: Number(y.year) || 0,
      part,
      chartType: String(y.chartType || ''),
      titleZh: String(y.titleZh || ''),
      topicEn: String(y.topicEn || ''),
      pictureZh: String(y.pictureZh || ''),
      directionsZh: String(y.directionsZh || ''),
      sections: Array.isArray(y.sections) ? y.sections : [],
      tip: String(y.tip || ''),
      model: { en: String(y.model.en || ''), zh: String(y.model.zh || ''), outline: Array.isArray(y.model.outline) ? y.model.outline : [] },
    });
  }
}
samples.sort((a,b) => b.year - a.year || (a.part === 'B' ? -1 : 1));
const tpl = JSON.parse(tplTxt);
const templates = (tpl.templates || []).map(t => ({
  id: t.id, type: t.type, typeEn: t.typeEn || '', stars: t.stars || 0, freq: t.freq || '',
  scene: t.scene || '', wordTarget: t.wordTarget || '',
  blocks: (t.blocks || []).map(b => ({ name: String(b.name || ''), text: String(b.text || ''), zh: String(b.zh || ''), note: trim(b.note || '', 300) })),
}));

// frameworks
const fw = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'frameworks.json'), 'utf8'));

// build words
const words = [];
for (const w of allWords) {
  const xi = xiang.get(w);
  const card = cards.get(w);
  const gloss = syllabus.get(w) || '';
  const isSyl = syllabus.has(w);
  const senses = [];
  if (card && Array.isArray(card.meanings)) {
    const ranked = card.meanings.filter(m => m && m.gloss);
    const core = ranked.filter(m => m.priority === 'core');
    const common = ranked.filter(m => m.priority === 'common');
    const rare = ranked.filter(m => m.priority === 'rare' || !m.priority);
    let chosen;
    if (!isSyl) {
      chosen = ranked.slice(0, 1);
    } else {
      chosen = [...core, ...common];
      if (!chosen.length) chosen = rare.slice(0, 2);
      if (chosen.length < 2) chosen.push(...rare.slice(0, 2 - chosen.length));
      const used = new Set(chosen);
      const extraRare = rare.filter(m => !used.has(m)).slice(0, 3);
      chosen = chosen.concat(extraRare);
    }
    for (const m of chosen.slice(0, isSyl ? 8 : 1)) {
      const zh = trim(m.gloss || '', 120);
      if (!zh) continue;
      const isRare = m.priority === 'rare' || !m.priority;
      senses.push([String(m.pos || '').trim(), zh, isRare ? '' : trim(m.explain || '', 120)]);
    }
  }
  if (!senses.length && gloss) senses.push(['', trim(gloss, 220), '']);
  if (!senses.length && xi?.meaning) senses.push(['', trim(xi.meaning, 220), '']);
  if (!senses.length) senses.push(['', '（暂无释义）', '']);
  const yi = syllabus.has(w) ? Number(yearcount[w] || 0) : null;
  const all = xi ? { count: xi.count, papers: xi.papers } : null;
  const rt = [];
  for (const key of rootWordMap.get(w) || []) {
    const root = roots.find(r => r.k === key);
    if (root) rt.push([root.k, trim(root.m, 80), root.c, root.o]);
    if (rt.length >= 3) break;
  }
  const ex = (essayWordMap.get(w) || []).slice(0, 2);
  const fm = parseForms(xi?.forms || '');
  const ef = ecdict[w]?.fm || [];
  for (const f of ef) if (f && f.length > 1 && !fm.includes(f)) fm.push(f);
  const obj = {
    w,
    p: xi?.ipa || ecdict[w]?.p || '',
    fm: fm.slice(0, 10),
    f: { yi, band: bandOf(yi), all },
    s: senses,
    src: syllabus.has(w) ? '大纲' : '扩展',
  };
  if (isSyl && card?.etymology) obj.et = trim(card.etymology, 360);
  if (isSyl && card?.memory_hook) obj.hk = trim(card.memory_hook, 260);
  if (isSyl && card?.usage) obj.us = trim(card.usage, 240);
  if (rt.length) obj.rt = rt;
  if (ex.length) obj.ex = ex;
  words.push(obj);
}
words.sort((a,b) => (b.f.yi ?? -1) - (a.f.yi ?? -1) || (b.f.all?.count || 0) - (a.f.all?.count || 0) || a.w.localeCompare(b.w));

const meta = {
  builtAt: new Date().toISOString(),
  words: words.length,
  syllabus: words.filter(x => x.src === '大纲').length,
  extra: words.filter(x => x.src === '扩展').length,
  withSenses: words.filter(x => x.s.length && x.s[0][1] !== '（暂无释义）').length,
  withIpa: words.filter(x => x.p).length,
  withEtymology: words.filter(x => x.et).length,
  withRoots: words.filter(x => x.rt?.length).length,
  withExamples: words.filter(x => x.ex?.length).length,
  rootEntries: roots.length,
  essayTopics: essays.length,
  essayEntries: essays.reduce((n,x)=>n+x.entries.length,0),
  templates: templates.length,
  samples: samples.length,
  frameworks: fw.frameworks.length,
  sources: {
    frequency: 'npee-vocab-statistics (MIT)',
    dictionary: 'ECDICT (MIT)',
    wordCards: 'JTKING27/kaoyan-vocab-context (CC BY-SA 4.0)',
    essays: 'IKTNF/kaoyan-english-writing-corpus (MIT)',
    extraFrequency: 'xiangjiawei1234-prog/kaoyan-vocab (MIT)',
  },
};

const header = '/* generated by scripts/build-data.mjs — do not edit by hand */\n';
await fs.writeFile(path.join(OUT, 'words.js'), header + 'window.WORDS_DATA=' + JSON.stringify(words) + ';\n');
await fs.writeFile(path.join(OUT, 'essays.js'), header + 'window.ESSAY_DATA=' + JSON.stringify({ meta: { topics: essays.length, entries: meta.essayEntries, templates: templates.length, samples: samples.length }, topics: essays, templates, samples, frameworks: fw.frameworks }) + ';\n');
await fs.writeFile(path.join(OUT, 'roots.js'), header + 'window.ROOTS_DATA=' + JSON.stringify(roots) + ';\n');
await fs.writeFile(path.join(OUT, 'meta.js'), header + 'window.DATA_META=' + JSON.stringify(meta) + ';\n');

const report = { ...meta, wordBytes: (await fs.stat(path.join(OUT, 'words.js'))).size, essayBytes: (await fs.stat(path.join(OUT, 'essays.js'))).size, rootBytes: (await fs.stat(path.join(OUT, 'roots.js'))).size };
await fs.writeFile(path.join(SRC, 'build-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
