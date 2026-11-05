import fs from 'node:fs';
import vm from 'node:vm';

function load(file, name) {
  const code = fs.readFileSync(file, 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  if (!ctx.window[name]) throw new Error('missing ' + name + ' in ' + file);
  return ctx.window[name];
}

const words = load('js/data/words.js', 'WORDS_DATA');
const essays = load('js/data/essays.js', 'ESSAY_DATA');
const roots = load('js/data/roots.js', 'ROOTS_DATA');
const meta = load('js/data/meta.js', 'DATA_META');
const errors = [];

if (words.length < 5500) errors.push('words too few: ' + words.length);
if (roots.length < 600) errors.push('roots too few: ' + roots.length);
if (!essays.templates || essays.templates.length < 16) errors.push('templates < 16');
if (!essays.samples || essays.samples.length < 45) errors.push('samples < 45');
if (!essays.frameworks || essays.frameworks.length < 3) errors.push('frameworks < 3');
if (!essays.topics || essays.topics.length < 17) errors.push('topics < 17');

const seen = new Set();
let noSense = 0, noIpa = 0, badFreq = 0, noEt = 0;
for (const x of words) {
  if (seen.has(x.w)) errors.push('duplicate word: ' + x.w);
  seen.add(x.w);
  if (!Array.isArray(x.s) || !x.s.length) noSense++;
  if (!x.p) noIpa++;
  if (!x.f || (x.f.yi !== null && (typeof x.f.yi !== 'number' || x.f.yi < 0 || x.f.yi > 25))) badFreq++;
  if (!x.et) noEt++;
  if (x.f && x.f.yi !== null && !x.f.band) errors.push('missing band: ' + x.w);
}
if (noSense) errors.push('words without senses: ' + noSense);
if (badFreq) errors.push('bad freq: ' + badFreq);
if (!essays.templates.every(t => t.id && t.type && Array.isArray(t.blocks) && t.blocks.length)) errors.push('bad template');
if (!essays.frameworks.every(f => f.id && Array.isArray(f.paragraphs) && f.paragraphs.length === 3)) errors.push('bad framework');
if (!essays.samples.every(s => s.model && s.model.en && s.model.zh)) errors.push('bad sample');

console.log(JSON.stringify({
  words: words.length,
  syllabus: words.filter(x => x.src === '大纲').length,
  extra: words.filter(x => x.src === '扩展').length,
  noSense, noIpa, noEt,
  roots: roots.length,
  templates: essays.templates.length,
  frameworks: essays.frameworks.length,
  samples: essays.samples.length,
  topics: essays.topics.length,
  entries: essays.topics.reduce((n,t)=>n+t.entries.length,0),
  metaWords: meta.words,
  errors: errors.slice(0, 20)
}, null, 2));
if (errors.length) process.exit(1);
console.log('OK');
