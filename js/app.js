'use strict';

/* ================= 数据 ================= */
var WORDS = window.WORDS_DATA || [];
var ESSAYS = window.ESSAY_DATA || { topics: [], templates: [], samples: [], frameworks: [] };
var ROOTS = window.ROOTS_DATA || [];
var META = window.DATA_META || {};
var WORD_MAP = new Map();
var FORM_MAP = new Map();
var WORD_LIST = [];

function buildMaps() {
  for (var i = 0; i < WORDS.length; i++) {
    var x = WORDS[i];
    WORD_MAP.set(x.w, x);
    FORM_MAP.set(x.w, x.w);
    if (x.fm) {
      for (var j = 0; j < x.fm.length; j++) {
        var f = x.fm[j];
        if (f && !FORM_MAP.has(f)) FORM_MAP.set(f, x.w);
      }
    }
  }
  WORD_LIST = WORDS.map(function (x) { return x.w; });
}

/* ================= 存储 ================= */
var LS = {
  book: 'yc_book_v1',
  settings: 'yc_settings_v1',
  daily: 'yc_daily_v1',
  history: 'yc_history_v1',
  custom: 'yc_custom_v1',
  recent: 'yc_recent_v1',
  theme: 'yc_theme_v1'
};
var DEFAULTS = {
  examDate: '2026-12-19',
  dailyCount: 4,
  dailyPart: 'B',
  key: '',
  model: 'deepseek-flash',
  theme: 'auto',
  autoAdd: true,
  pdfFilterStop: true
};
var settings = readJSON(LS.settings, {});
Object.keys(DEFAULTS).forEach(function (k) {
  if (settings[k] === undefined || settings[k] === null || settings[k] === '') settings[k] = DEFAULTS[k];
});
var book = readJSON(LS.book, {});
var dailyHistory = readJSON(LS.history, []);
var customCards = readJSON(LS.custom, {});
var recent = readJSON(LS.recent, []);
var daily = readJSON(LS.daily, null);
var state = { view: 'today', essayTab: 'templates', bookSort: 'due', word: null, pdf: null };
var deferredPrompt = null;

function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    var v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { toast('浏览器存储空间不足，请先导出备份'); return false; }
}
function saveBook() { writeJSON(LS.book, book); }
function saveSettings() { writeJSON(LS.settings, settings); }
function saveHistory() { writeJSON(LS.history, dailyHistory.slice(0, 30)); }
function saveCustom() { writeJSON(LS.custom, customCards); }
function saveRecent() { writeJSON(LS.recent, recent.slice(0, 12)); }
function saveDaily() { writeJSON(LS.daily, daily); }

/* ================= 工具 ================= */
function $(s, root) { return (root || document).querySelector(s); }
function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function addDays(dateStr, n) {
  var p = dateStr.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + Number(n || 0));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function dayDiff(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  var da = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  var db = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((da - db) / 86400000);
}
function formatDate(s) {
  if (!s) return '';
  var p = s.split('-');
  return Number(p[1]) + '月' + Number(p[2]) + '日';
}
function weekday(s) {
  var p = s.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
function toast(msg) {
  var el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.hidden = true; }, 2400);
}
function firstSense(x) {
  if (!x || !x.s || !x.s.length) return '';
  return x.s[0][1] || '';
}
function bandClass(b) {
  if (b === '极高' || b === '高频') return 'hot';
  if (b === '常考') return 'mid';
  if (b === '低频' || b === '未出现') return 'cool';
  return '';
}
function freqLabel(x) {
  if (!x || !x.f) return '';
  if (x.f.yi === null) return '扩展词';
  return '英一 ' + x.f.yi + '/25';
}
function senseText(x, n) {
  if (!x || !x.s || !x.s.length) return '';
  var arr = x.s.slice(0, n || 2).map(function (s) { return (s[0] ? s[0] + ' ' : '') + s[1]; });
  return arr.join('；');
}
function normalizeWord(q) {
  return String(q || '').toLowerCase().trim().replace(/^[^a-z]+|[^a-z' -]+$/g, '');
}
function stemCandidates(q) {
  var out = [q];
  if (q.length > 3 && q.slice(-1) === 's') out.push(q.slice(0, -1));
  if (q.length > 4 && q.slice(-2) === 'es') out.push(q.slice(0, -2));
  if (q.length > 4 && q.slice(-2) === 'ed') out.push(q.slice(0, -2), q.slice(0, -1));
  if (q.length > 5 && q.slice(-3) === 'ing') out.push(q.slice(0, -3), q.slice(0, -3) + 'e');
  if (q.length > 4 && q.slice(-2) === 'ly') out.push(q.slice(0, -2));
  return out;
}
function speak(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) { toast('当前浏览器不支持朗读'); return; }
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'en-US';
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  } catch (e) { toast('朗读失败'); }
}
function copyText(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { toast('复制失败'); });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败'); }
    ta.remove();
  }
}

/* ================= 生词本 / 记忆曲线 ================= */
function ensureWord(w, meta) {
  if (!WORD_MAP.has(w)) return null;
  if (!book[w]) {
    book[w] = { addedAt: todayStr(), interval: 0, ease: 2.5, due: todayStr(), exposures: 0, lastShown: null };
  }
  if (meta && meta.source && !book[w].source) {
    book[w].source = meta.source;
    book[w].sourceName = meta.sourceName || '';
    book[w].importedAt = meta.importedAt || todayStr();
  }
  return book[w];
}
function toggleBook(w) {
  if (book[w]) { delete book[w]; saveBook(); toast('已移出生词本'); }
  else { ensureWord(w); saveBook(); toast('已加入生词本'); }
  if (state.word === w && $('#sheet') && !$('#sheet').hidden) renderWordDetail(w);
  renderBook();
  renderToday();
}
function isSaved(w) { return !!book[w]; }
function exposure(w) {
  var e = ensureWord(w);
  if (!e) return;
  e.interval = e.interval ? Math.min(60, Math.round(e.interval * (e.ease || 2.5))) : 1;
  e.ease = Math.min(2.8, (e.ease || 2.5) + 0.05);
  e.due = addDays(todayStr(), e.interval);
  e.exposures = (e.exposures || 0) + 1;
  e.lastShown = todayStr();
  saveBook();
}
function bookEntries() {
  return Object.keys(book).map(function (w) {
    var x = WORD_MAP.get(w);
    return x ? { w: w, x: x, e: book[w] } : null;
  }).filter(Boolean);
}
function dueCount() {
  var t = todayStr();
  return bookEntries().filter(function (it) { return it.e.due <= t; }).length;
}
function selectTargets(n) {
  var t = todayStr();
  var list = bookEntries().map(function (it) {
    var e = it.e;
    var score = 0;
    if (!e.lastShown) score += 120;
    if (e.due <= t) score += 90 + Math.min(40, dayDiff(t, e.due));
    var gap = e.lastShown ? dayDiff(t, e.lastShown) : 30;
    if (gap < 3) score -= 70 - gap * 10;
    score += Math.max(0, 18 - (e.exposures || 0) * 3);
    if (it.x.f && it.x.f.yi) score += Math.min(12, it.x.f.yi / 2);
    if (e.interval >= 30) score -= 12;
    return { w: it.w, x: it.x, e: e, score: score };
  });
  list.sort(function (a, b) { return b.score - a.score; });
  return list.slice(0, Math.max(1, n)).map(function (it) { return it.w; });
}

/* ================= 搜索 ================= */
function searchEntries(q) {
  var raw = String(q || '').trim();
  if (!raw) return [];
  var n = normalizeWord(raw);
  var out = [];
  var seen = {};
  function add(x) {
    if (!x || seen[x.w]) return;
    seen[x.w] = 1; out.push(x);
  }
  if (WORD_MAP.has(n)) add(WORD_MAP.get(n));
  if (FORM_MAP.has(n)) add(WORD_MAP.get(FORM_MAP.get(n)));
  for (var i = 0; i < stemCandidates(n).length; i++) {
    var s = stemCandidates(n)[i];
    if (WORD_MAP.has(s)) add(WORD_MAP.get(s));
    if (FORM_MAP.has(s)) add(WORD_MAP.get(FORM_MAP.get(s)));
  }
  if (!out.length && n.length >= 2) {
    for (var j = 0; j < WORDS.length && out.length < 12; j++) {
      if (WORDS[j].w.indexOf(n) === 0) add(WORDS[j]);
    }
  }
  if (!out.length && n.length >= 3) {
    for (var k = 0; k < WORDS.length && out.length < 12; k++) {
      if (WORDS[k].w.indexOf(n) > 0) add(WORDS[k]);
    }
  }
  if (!out.length && raw && /[\u4e00-\u9fff]/.test(raw)) {
    for (var m = 0; m < WORDS.length && out.length < 20; m++) {
      var x = WORDS[m];
      if (!x.s) continue;
      for (var z = 0; z < x.s.length; z++) {
        if (x.s[z][1] && x.s[z][1].indexOf(raw) >= 0) { add(x); break; }
      }
    }
  }
  if (!out.length && n.length >= 4) {
    for (var p = 0; p < WORDS.length && out.length < 6; p++) {
      if (WORDS[p].w.charAt(0) !== n.charAt(0)) continue;
      if (editDistance(WORDS[p].w, n) <= 2) add(WORDS[p]);
    }
  }
  return out.slice(0, 30);
}
function editDistance(a, b) {
  if (a === b) return 0;
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 2) return 99;
  var prev = [], cur = [];
  for (var j = 0; j <= lb; j++) prev[j] = j;
  for (var i = 1; i <= la; i++) {
    cur[0] = i;
    for (var k = 1; k <= lb; k++) {
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1));
    }
    var tmp = prev; prev = cur; cur = tmp;
  }
  return prev[lb];
}

/* ================= 链接/高亮 ================= */
function linkify(text, targets) {
  var tset = {};
  (targets || []).forEach(function (w) { tset[w] = 1; });
  var re = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
  var out = '', last = 0, m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out += esc(String(text).slice(last, m.index));
    var raw = m[0];
    var low = raw.toLowerCase();
    var lemma = FORM_MAP.get(low) || low;
    var known = WORD_MAP.has(lemma);
    if (known && tset[lemma]) {
      out += '<mark class="target"><button type="button" class="word-link" data-word="' + esc(lemma) + '">' + esc(raw) + '</button></mark>';
    } else if (known) {
      out += '<button type="button" class="word-link" data-word="' + esc(lemma) + '">' + esc(raw) + '</button>';
    } else {
      out += esc(raw);
    }
    last = m.index + raw.length;
  }
  out += esc(String(text || '').slice(last));
  return out;
}
function paragraphs(text, targets) {
  return String(text || '').split(/\n{2,}/).map(function (p) {
    return '<p>' + linkify(p.replace(/\n/g, ' '), targets) + '</p>';
  }).join('');
}

/* ================= Sheet ================= */
function openSheet(title, html, after) {
  var sheet = $('#sheet');
  if (!sheet) return;
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  var panel = $('.sheet-panel');
  if (panel && panel.focus) { try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); } }
  if (after) after();
}
function closeSheet() {
  var sheet = $('#sheet');
  if (!sheet) return;
  if (state.pdf && state.pdf.parsing) state.pdf.cancelled = true;
  sheet.hidden = true;
  document.body.style.overflow = '';
  state.word = null;
}
function bindSheetEvents() {
  var sheet = $('#sheet');
  if (!sheet) return;
  sheet.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-close]');
    if (t) { closeSheet(); return; }
    var a = ev.target.closest('[data-act]');
    if (a) {
      var act = a.getAttribute('data-act');
      var word = a.getAttribute('data-word') || state.word;
      if (act === 'speak') speak(word);
      if (act === 'save') toggleBook(word);
      if (act === 'ai') generateWordCard(word);
      if (act === 'copy') copyText(a.getAttribute('data-copy') || '');
      if (act === 'settings') { closeSheet(); showView('settings'); }
      return;
    }
    var w = ev.target.closest('[data-word]');
    if (w) { ev.preventDefault(); openWord(w.getAttribute('data-word')); return; }
  });
  $('#sheetClose').addEventListener('click', closeSheet);
}

/* ================= 词条 ================= */
function openWord(w) {
  var lemma = FORM_MAP.get(String(w || '').toLowerCase()) || String(w || '').toLowerCase();
  var x = WORD_MAP.get(lemma);
  state.word = lemma;
  if (!x) {
    openSheet('未收录', '<div class="empty"><b>没有找到「' + esc(w) + '」</b>这个词典里暂时没有收录。可以换个拼写，或减少词形变化再试。</div><div class="actions"><button type="button" class="btn" data-close="1">关闭</button></div>');
    return;
  }
  if (settings.autoAdd !== false && !book[x.w]) {
    ensureWord(x.w);
    saveBook();
    if (state.view === 'book') renderBook();
  }
  renderWordDetail(x.w);
  addRecent(x.w);
}
function renderWordDetail(w) {
  var x = WORD_MAP.get(w);
  if (!x) return;
  state.word = w;
  var saved = isSaved(w);
  var html = '';
  html += '<div class="word-head"><div><div class="word-title">' + esc(x.w) + '</div>';
  if (x.p) html += '<div class="word-ipa">/' + esc(x.p) + '/</div>';
  html += '</div><button type="button" class="icon-btn" data-act="speak" data-word="' + esc(w) + '" aria-label="朗读">声</button></div>';
  html += '<div class="tagrow">';
  html += '<span class="tag ' + (x.src === '大纲' ? 'green' : '') + '">' + (x.src === '大纲' ? '大纲词' : '扩展词') + '</span>';
  if (x.f && x.f.band) html += '<span class="tag ' + (bandClass(x.f.band) === 'hot' ? 'accent' : '') + '">' + esc(x.f.band) + '</span>';
  html += '<span class="tag">' + esc(freqLabel(x)) + '</span>';
  if (x.f && x.f.all) html += '<span class="tag">全科 ' + x.f.all.count + ' 次 / ' + x.f.all.papers + ' 套</span>';
  html += '</div>';
  if (x.f && x.f.yi !== null) {
    var pct = Math.max(2, Math.min(100, Math.round(x.f.yi / 25 * 100)));
    html += '<div class="freq-card"><div class="freq-top"><div class="freq-num">' + x.f.yi + '<small> / 25 套</small></div><div class="badge ' + bandClass(x.f.band) + '">' + esc(x.f.band) + '</div></div>';
    html += '<div class="freq-bar"><i style="width:' + pct + '%"></i></div>';
    html += '<div class="freq-note">英语一 2002–2026 真题正文，出现在 ' + x.f.yi + ' 套试卷中；0 表示这 25 套正文未出现，不等于从未考过。</div></div>';
  } else {
    html += '<div class="freq-card"><div class="freq-note">这个词不在 5,501 大纲词表内，暂无英语一考频；可参考全科词频。</div></div>';
  }
  html += '<div class="actions"><button type="button" class="btn primary" data-act="save" data-word="' + esc(w) + '">' + (saved ? '移出生词本' : '加入生词本') + '</button>';
  html += '<button type="button" class="btn ghost" data-act="ai" data-word="' + esc(w) + '">AI 作文句</button>';
  html += '<button type="button" class="btn ghost" data-act="speak" data-word="' + esc(w) + '">朗读</button></div>';

  html += '<div class="details" open><summary>全部义项 · ' + (x.s ? x.s.length : 0) + ' 条</summary><div class="details-body">';
  (x.s || []).forEach(function (s) {
    html += '<div class="sense"><div class="sense-head"><span class="sense-pos">' + esc(s[0] || '') + '</span><span class="sense-zh">' + esc(s[1] || '') + '</span></div>';
    if (s[2]) html += '<div class="sense-note">' + esc(s[2]) + '</div>';
    html += '</div>';
  });
  html += '</div></div>';

  if (x.rt && x.rt.length) {
    html += '<div class="details" open><summary>词根 / 词缀</summary><div class="details-body"><div class="root-row">';
    x.rt.forEach(function (r) {
      html += '<span class="root-chip"><b>' + esc(r[0]) + '</b> <span>' + esc(r[1] || '') + '</span></span>';
    });
    html += '</div><div class="freq-note">词根来自 ECDICT；例词和词源仅供辅助记忆，遇到多源词以权威词典为准。</div></div></div>';
  }
  if (x.et) html += '<div class="details" open><summary>词源</summary><div class="details-body">' + esc(x.et) + '</div></div>';
  if (x.hk) html += '<div class="details"><summary>记忆钩子</summary><div class="details-body">' + esc(x.hk) + '</div></div>';
  if (x.us) html += '<div class="details"><summary>用法 / 易错</summary><div class="details-body">' + esc(x.us) + '</div></div>';
  if (x.ex && x.ex.length) {
    html += '<div class="details" open><summary>作文语料里的例句</summary><div class="details-body">';
    x.ex.forEach(function (ex) {
      html += '<div class="copy-line">' + linkify(ex[0], [w]) + '</div>';
      if (ex[1]) html += '<div class="freq-note">' + esc(ex[1]) + '</div>';
      html += '<div class="freq-note">— ' + esc(ex[2] || '') + (ex[3] ? ' · ' + esc(ex[3]) : '') + '</div>';
    });
    html += '</div></div>';
  }
  var cc = customCards[w];
  if (cc) {
    html += '<div class="details" open><summary>AI 作文句</summary><div class="details-body">';
    if (cc.a && cc.a.en) { html += '<div class="copy-line"><b>Part B：</b>' + linkify(cc.a.en, [w]) + '</div><div class="freq-note">' + esc(cc.a.zh || '') + '</div>'; }
    if (cc.b && cc.b.en) { html += '<div class="copy-line"><b>Part A：</b>' + linkify(cc.b.en, [w]) + '</div><div class="freq-note">' + esc(cc.b.zh || '') + '</div>'; }
    if (cc.note) html += '<div class="freq-note">' + esc(cc.note) + '</div>';
    html += '<div class="actions"><button type="button" class="btn sm ghost" data-act="ai" data-word="' + esc(w) + '">重新生成</button></div>';
    html += '</div></div>';
  }
  html += '<div class="freq-note" style="margin-top:14px">释义/词源由 AI 整理，参考 ECDICT 与开放词典；作文句由 AI 生成，仅供参考。</div>';
  openSheet('词条', html);
}

/* ================= AI ================= */
function hasKey() { return !!(settings.key && settings.key.trim()); }
function callAI(messages, maxTokens) {
  if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 60000);
  return fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.key.trim() },
    signal: controller.signal,
    body: JSON.stringify({
      model: settings.model || 'deepseek-flash',
      messages: messages,
      temperature: 0.8,
      max_tokens: maxTokens || 1400,
      response_format: { type: 'json_object' }
    })
  }).then(function (res) {
    return res.text().then(function (txt) {
      if (!res.ok) throw new Error('API ' + res.status + '：' + txt.slice(0, 180));
      var j = JSON.parse(txt);
      var content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!content) throw new Error('AI 没有返回内容');
      return JSON.parse(content);
    });
  }).finally(function () { clearTimeout(timer); });
}
function generateWordCard(w) {
  var x = WORD_MAP.get(w);
  if (!x) return;
  if (!hasKey()) { toast('先在设置里填 DeepSeek Key'); closeSheet(); showView('settings'); return; }
  openSheet('词条', '<div class="loading"><span class="spinner"></span>正在生成作文句…</div>');
  var senses = (x.s || []).slice(0, 3).map(function (s) { return (s[0] ? s[0] + ' ' : '') + s[1]; }).join('；');
  var prompt = '你是考研英语一作文老师。为单词 "' + w + '" 写两句可直接用于作文的英文句子：\n' +
    '1) Part B 大作文句（图画/图表/观点，20–35 词），自然使用该词的核心义项；\n' +
    '2) Part A 小作文句（书信/通知，15–30 词），自然使用该词；\n' +
    '每句配中文翻译。再给一句中文用法提示。不要编造统计数字，不要用中文写英文句。\n' +
    '单词义项：' + senses + '。\n' +
    '只返回 JSON：{"a":{"en":"...","zh":"..."},"b":{"en":"...","zh":"..."},"note":"..."}';
  callAI([{ role: 'system', content: '你只输出合法 JSON，不要 markdown。' }, { role: 'user', content: prompt }], 900)
    .then(function (j) {
      customCards[w] = { a: j.a || {}, b: j.b || {}, note: j.note || '', at: new Date().toISOString(), model: settings.model };
      saveCustom();
      renderWordDetail(w);
      toast('作文句已生成');
    })
    .catch(function (e) {
      if (e.message === 'NO_KEY') { toast('先在设置里填 DeepSeek Key'); closeSheet(); showView('settings'); }
      else { renderWordDetail(w); toast('生成失败：' + e.message.slice(0, 80)); }
    });
}

/* ================= 最近查词 ================= */
function addRecent(w) {
  recent = recent.filter(function (x) { return x !== w; });
  recent.unshift(w);
  recent = recent.slice(0, 12);
  saveRecent();
}
function resultHtml(x) {
  return '<button type="button" class="result" data-word="' + esc(x.w) + '">' +
    '<div class="result-main"><div class="result-word"><b>' + esc(x.w) + '</b>' +
    (x.p ? '<span>/' + esc(x.p) + '/</span>' : '') +
    '<span class="badge ' + bandClass(x.f && x.f.band) + '">' + esc(freqLabel(x)) + '</span></div>' +
    '<div class="result-zh">' + esc(senseText(x, 2)) + '</div></div></button>';
}
function renderSearch() {
  var input = $('#searchInput');
  var box = $('#searchResults');
  var home = $('#searchHome');
  var clear = $('#searchClear');
  if (!input || !box || !home) return;
  var q = input.value;
  if (clear) clear.hidden = !q;
  if (!q.trim()) {
    box.innerHTML = '';
    home.style.display = '';
    renderRecent();
    return;
  }
  home.style.display = 'none';
  var list = searchEntries(q);
  if (!list.length) {
    box.innerHTML = '<div class="empty"><b>没有找到「' + esc(q) + '」</b>换个拼写，或只输入词根部分试试。扩展词库之外的新词，可以先记下来，后续再加。</div>';
    return;
  }
  box.innerHTML = list.map(resultHtml).join('');
}
function renderRecent() {
  var box = $('#searchHome');
  if (!box) return;
  var html = '';
  if (recent.length) {
    html += '<div class="section-title"><h3>最近查过</h3><span>' + recent.length + ' 个</span></div><div class="results">';
    recent.slice(0, 6).forEach(function (w) {
      var x = WORD_MAP.get(w);
      if (x) html += resultHtml(x);
    });
    html += '</div>';
  }
  var saved = bookEntries().slice(0, 6);
  if (saved.length) {
    html += '<div class="section-title"><h3>生词本</h3><button type="button" class="link-btn" data-view-link="book">查看全部</button></div><div class="results">';
    saved.forEach(function (it) { html += resultHtml(it.x); });
    html += '</div>';
  }
  if (!html) html = '<div class="empty"><b>输入一个词开始</b>查过的词会自动进生词本，之后每天从里面选词编进范文。</div>';
  box.innerHTML = html;
}

/* ================= 视图切换 ================= */
function showView(v) {
  state.view = v;
  $$('.view').forEach(function (el) { el.classList.remove('on'); });
  var el = $('#view-' + v);
  if (el) el.classList.add('on');
  $$('.tabbar button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
  try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }
  if (v === 'today') renderToday();
  if (v === 'search') { renderSearch(); var inp = $('#searchInput'); if (inp) setTimeout(function () { inp.focus(); }, 40); }
  if (v === 'essay') renderEssayTab();
  if (v === 'book') renderBook();
  if (v === 'settings') renderSettings();
  if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#/' + v);
}


/* ================= 每日范文 ================= */
function frameworkById(id) {
  var arr = ESSAYS.frameworks || [];
  for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
  return null;
}
function chooseFramework() {
  var arr = ESSAYS.frameworks || [];
  if (!arr.length) return null;
  var d = new Date();
  var seed = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
  return arr[seed % arr.length];
}
function chooseTemplate() {
  var arr = ESSAYS.templates || [];
  if (!arr.length) return null;
  var d = new Date();
  var seed = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
  return arr[seed % arr.length];
}
function wordInText(text, w) {
  if (!text || !w) return false;
  var safe = w.replace(/[.*+?^$()|[\]\\]/g, '\\/* __PART2__ */');
  var re = new RegExp('\\b' + safe + '(?:s|es|ed|ing)?\\b', 'i');
  return re.test(text);
}
function countTargets(text, words) {
  var n = 0;
  for (var i = 0; i < words.length; i++) if (wordInText(text, words[i])) n++;
  return n;
}
function findSample(words, part) {
  var list = (ESSAYS.samples || []).filter(function (s) { return s.part === part; });
  if (!list.length) list = ESSAYS.samples || [];
  var best = null;
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s.model || !s.model.en) continue;
    var c = countTargets(s.model.en, words);
    if (!best || c > best.count || (c === best.count && s.year > best.sample.year)) {
      best = { sample: s, count: c, words: words.filter(function (w) { return wordInText(s.model.en, w); }) };
    }
  }
  return best;
}
function partLabel(p) { return p === 'A' ? 'Part A 小作文' : 'Part B 大作文'; }
function dailySourceLabel(d) {
  if (!d) return '';
  if (d.source === 'ai') return 'AI 生成';
  if (d.source === 'sample') return '现成范文';
  return '范文';
}
function renderTodayEmpty() {
  var box = $('#todayContent');
  if (!box) return;
  var sample = (ESSAYS.samples || []).filter(function (s) { return s.part === 'B'; })[0] || (ESSAYS.samples || [])[0];
  var html = '';
  html += '<div class="hero-card"><div class="hero-kicker"><span>今日范文</span><span class="badge">先积累词</span></div>';
  html += '<h3 class="hero-title">先查几个生词，明天开始每天一篇</h3>';
  html += '<p class="hero-sub">查过的词会自动进生词本。之后每天从生词本选 3–5 个词，编进一篇英语一范文；不用打分，靠重复出现来记。</p>';
  html += '<div class="actions"><button type="button" class="btn primary" data-act="go-search">去查词</button><button type="button" class="btn ghost" data-act="load-sample">加载 5 个示例词</button>' + (dailyHistory.length ? '<button type="button" class="btn ghost" data-act="history">往期范文</button>' : '') + '</div></div>';
  if (sample) {
    html += '<div class="section-title"><h3>先读一篇</h3><span>' + sample.year + ' · ' + esc(sample.titleZh || sample.topicEn || '') + '</span></div>';
    html += '<div class="hero-card"><div class="hero-kicker"><span>Part B 范文</span><span class="badge">通用</span></div>';
    html += '<div class="essay-text">' + paragraphs(sample.model.en, []) + '</div>';
    html += '<details class="details"><summary>中文翻译</summary><div class="details-body">' + esc(sample.model.zh || '') + '</div></details>';
    html += '<div class="actions"><button type="button" class="btn ghost" data-act="speak-sample">朗读</button></div></div>';
  }
  box.innerHTML = html;
  bindToday();
  $('#todayDate').textContent = formatDate(todayStr()) + ' · ' + weekday(todayStr());
  updateExamPill();
}
function updateExamPill() {
  var el = $('#examPill');
  if (!el) return;
  var d = settings.examDate || DEFAULTS.examDate;
  var diff = dayDiff(d, todayStr());
  el.textContent = diff > 0 ? '距考研 ' + diff + ' 天' : (diff === 0 ? '今天考试' : '考试已结束');
}
function renderToday() {
  var box = $('#todayContent');
  if (!box) return;
  $('#todayDate').textContent = formatDate(todayStr()) + ' · ' + weekday(todayStr());
  updateExamPill();
  if (!bookEntries().length) { renderTodayEmpty(); return; }
  if (daily && daily.date !== todayStr()) { daily = null; saveDaily(); }
  if (!daily) {
    box.innerHTML = '<div class="hero-card"><div class="loading"><span class="spinner"></span>正在为你选词、找范文…</div></div>';
    buildDaily(false);
    return;
  }
  renderDailyCard(box);
}
function renderDailyCard(box) {
  var d = daily;
  var html = '';
  html += '<div class="seg sm" id="dailyParts"><button type="button" data-part="B" class="' + (settings.dailyPart === 'B' ? 'on' : '') + '">大作文 Part B</button><button type="button" data-part="A" class="' + (settings.dailyPart === 'A' ? 'on' : '') + '">小作文 Part A</button></div>';
  html += '<div class="hero-card">';
  html += '<div class="hero-kicker"><span>' + esc(formatDate(d.date)) + ' · ' + partLabel(d.part) + '</span><span class="badge">' + esc(dailySourceLabel(d)) + '</span></div>';
  html += '<h3 class="hero-title">' + esc(d.title || '今日范文') + '</h3>';
  if (d.topic) html += '<p class="hero-sub">' + esc(d.topic) + '</p>';
  if (d.words && d.words.length) {
    html += '<div class="chips">';
    d.words.forEach(function (w) { html += '<button type="button" class="chip target" data-word="' + esc(w) + '">' + esc(w) + '</button>'; });
    html += '</div>';
  }
  html += '<div class="essay-text">' + paragraphs(d.en, d.words || []) + '</div>';
  html += '<div class="essay-zh" id="dailyZh"' + (state.showZh ? '' : ' hidden') + '>' + esc(d.zh || '') + '</div>';
  var meta = [];
  if (d.source === 'sample' && d.sampleYear) meta.push(d.sampleYear + ' 真题范文');
  if (d.frameworkId) { var fw = frameworkById(d.frameworkId); if (fw) meta.push('框架：' + fw.title); }
  if (d.templateId) { var tp = templateById(d.templateId); if (tp) meta.push('模板：' + tp.type); }
  if (meta.length) html += '<div class="meta-line">' + meta.map(esc).join(' · ') + '</div>';
  if (d.note) html += '<div class="freq-note">' + esc(d.note) + '</div>';
  html += '<div class="actions">';
  html += '<button type="button" class="btn primary" data-act="regen">换一篇</button>';
  html += '<button type="button" class="btn ghost" data-act="toggle-zh">' + (state.showZh ? '隐藏中文' : '显示中文') + '</button>';
  html += '<button type="button" class="btn ghost" data-act="speak-daily">朗读</button>';
  html += '<button type="button" class="btn ghost" data-act="history">历史</button>';
  html += '</div>';
  if (d.source === 'sample' && (!d.words || d.words.length < 2)) {
    html += '<div class="freq-note" style="margin-top:10px">这篇是现成范文，匹配到的生词不多。配置 DeepSeek Key 后，可以用你的生词生成专属范文。<button type="button" class="link-btn" data-act="settings">去设置</button></div>';
  }
  html += '</div>';

  if (d.words && d.words.length) {
    html += '<div class="section-title"><h3>本篇生词</h3><span>' + d.words.length + ' 个</span></div><div class="target-list">';
    d.words.forEach(function (w) {
      var x = WORD_MAP.get(w);
      if (!x) return;
      html += '<button type="button" class="target-item" data-word="' + esc(w) + '"><div style="flex:1;text-align:left"><b>' + esc(w) + '</b> <span class="badge ' + bandClass(x.f && x.f.band) + '">' + esc(freqLabel(x)) + '</span><p>' + esc(senseText(x, 2)) + '</p></div></button>';
    });
    html += '</div>';
  }
  if (d.outline && d.outline.length) {
    html += '<details class="details"><summary>三段提纲</summary><div class="details-body"><ol style="margin:0;padding-left:18px">';
    d.outline.forEach(function (o) { html += '<li>' + esc(o) + '</li>'; });
    html += '</ol></div></details>';
  }
  var hs = dailyHistory.slice(0, 4);
  if (hs.length) {
    html += '<div class="section-title"><h3>最近读过</h3><span>共 ' + dailyHistory.length + ' 篇</span></div><div class="results">';
    hs.forEach(function (h, i) {
      if (!h || !h.en) return;
      html += '<button type="button" class="result" data-act="open-history" data-index="' + i + '"><div class="result-main"><div class="result-word"><b>' + esc(h.date || '') + '</b><span class="badge">' + esc(partLabel(h.part)) + '</span></div><div class="result-zh">' + esc(h.title || '') + '</div></div></button>';
    });
    html += '</div>';
  }
  box.innerHTML = html;
  bindToday();
}
function bindToday() {
  var box = $('#todayContent');
  if (!box) return;
  box.querySelectorAll('[data-word]').forEach(function (b) {
    b.addEventListener('click', function () { openWord(b.getAttribute('data-word')); });
  });
  var parts = $('#dailyParts');
  if (parts) {
    parts.querySelectorAll('[data-part]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-part');
        if (settings.dailyPart === p) return;
        settings.dailyPart = p; saveSettings(); daily = null; saveDaily(); renderToday();
      });
    });
  }
  box.querySelectorAll('[data-act]').forEach(function (b) {
    b.addEventListener('click', function () {
      var act = b.getAttribute('data-act');
      if (act === 'go-search') showView('search');
      if (act === 'load-sample') loadSampleWords();
      if (act === 'settings') showView('settings');
      if (act === 'regen') regenerateDaily();
      if (act === 'toggle-zh') { state.showZh = !state.showZh; renderToday(); }
      if (act === 'speak-daily') speak(daily ? daily.en : '');
      if (act === 'speak-sample') { var s = (ESSAYS.samples || [])[0]; if (s) speak(s.model.en); }
      if (act === 'history') openHistorySheet();
      if (act === 'open-history') openHistorySheet(Number(b.getAttribute('data-index')) || 0);
    });
  });
}
function loadSampleWords() {
  var demo = ['sustain', 'contribute', 'phenomenon', 'appreciate', 'recommend'];
  demo.forEach(function (w) { if (WORD_MAP.has(w)) ensureWord(w); });
  saveBook();
  toast('已加入 5 个示例词');
  daily = null; saveDaily();
  showView('today');
}
function findSampleForBook(part) {
  var items = bookEntries();
  var t = todayStr();
  var list = (ESSAYS.samples || []).filter(function (s) { return s.part === part; });
  if (!list.length) list = ESSAYS.samples || [];
  var best = null;
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s.model || !s.model.en) continue;
    var dueWords = [], otherWords = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (!wordInText(s.model.en, it.w)) continue;
      if (it.e.due <= t) dueWords.push(it.w); else otherWords.push(it.w);
    }
    var score = dueWords.length * 10 + otherWords.length;
    if (!best || score > best.score) best = { sample: s, words: dueWords.concat(otherWords).slice(0, 5), score: score };
  }
  return best;
}
function buildDaily(force) {
  if (state.building) return;
  if (!bookEntries().length) { renderTodayEmpty(); return; }
  state.building = true;
  var targets = selectTargets(Number(settings.dailyCount) || 4);
  var part = settings.dailyPart === 'A' ? 'A' : 'B';
  var match = findSample(targets, part);
  function finish(d) {
    daily = d;
    saveDaily();
    dailyHistory = dailyHistory.filter(function (h) { return h.date !== d.date; });
    dailyHistory.unshift(d);
    saveHistory();
    state.building = false;
    renderToday();
  }
  function fallback(note, chosen) {
    var s = (chosen && chosen.sample) || (match && match.sample) || ((ESSAYS.samples || []).filter(function (x) { return x.part === part; })[0] || (ESSAYS.samples || [])[0]);
    if (!s) { state.building = false; toast('没有可用范文'); return; }
    var used = (chosen && chosen.words) || (match && match.words) || targets.filter(function (w) { return wordInText(s.model.en, w); });
    used.forEach(exposure);
    finish({
      date: todayStr(), part: part, source: 'sample',
      title: (s.year || '') + ' 真题范文 · ' + (s.titleZh || s.topicEn || (s.part === 'A' ? '应用文' : '范文')),
      topic: s.topicEn || s.titleZh || '',
      en: s.model.en, zh: s.model.zh || '', outline: s.model.outline || [],
      sampleYear: s.year, frameworkId: null, templateId: null,
      words: used, note: note || (used.length ? '' : '今日先读这篇通用范文；配置 Key 后可以生成包含你生词的专属范文。'),
      createdAt: new Date().toISOString()
    });
  }
  if (!hasKey()) { fallback('', findSampleForBook(part)); return; }
  if (match && match.count >= 2) { fallback('', { sample: match.sample, words: match.words }); return; }
  var fw = chooseFramework();
  var tp = part === 'A' ? chooseTemplate() : null;
  var prompt = buildDailyPrompt(targets, part, fw, tp);
  callAI([{ role: 'system', content: '你是考研英语一作文老师。只输出合法 JSON，不要 markdown。' }, { role: 'user', content: prompt }], 1800)
    .then(function (j) {
      if (!j || !j.en) throw new Error('AI 返回格式不对');
      var missing = targets.filter(function (w) { return !wordInText(j.en, w); });
      if (missing.length) throw new Error('AI 漏掉了：' + missing.join(', '));
      targets.forEach(exposure);
      finish({
        date: todayStr(), part: part, source: 'ai',
        title: j.title || '今日范文', topic: j.topic || '',
        en: j.en, zh: j.zh || '', outline: Array.isArray(j.outline) ? j.outline : [],
        frameworkId: fw ? fw.id : null, templateId: tp ? tp.id : null,
        words: targets, note: '', createdAt: new Date().toISOString()
      });
    })
    .catch(function (e) {
      state.building = false;
      console.warn(e);
      if (e.message === 'NO_KEY') fallback('', findSampleForBook(part));
      else { toast('生成失败，先用现成范文：' + e.message.slice(0, 60)); fallback('AI 生成失败，已切换为现成范文。', findSampleForBook(part)); }
    });
}
function buildDailyPrompt(targets, part, fw, tp) {
  var wordLines = targets.map(function (w) {
    var x = WORD_MAP.get(w);
    return '- ' + w + '：' + senseText(x, 2);
  }).join('\n');
  if (part === 'A') {
    var blocks = tp ? tp.blocks.map(function (b) { return b.text; }).join('\n') : '';
    return '写一篇考研英语一 Part A 小作文（约 100 词），类型：' + (tp ? tp.type : '建议信') + '。\n' +
      '可参考以下模板骨架（不要照抄全部，要自然）：\n' + blocks + '\n\n' +
      '必须自然用上这些生词（每个至少一次，可用变形）：\n' + wordLines + '\n\n' +
      '要求：英文；格式正确（称呼、正文、落款）；不要编造具体数据；另给中文翻译和 3 条中文提纲。\n' +
      '只返回 JSON：{"title":"...","topic":"...","en":"...","zh":"...","outline":["...","...","..."]}';
  }
  var frames = '';
  if (fw) {
    frames = fw.paragraphs.map(function (p) {
      return '[' + p.role + ']\n' + p.frames.map(function (f) { return '- ' + f.en; }).join('\n');
    }).join('\n');
  }
  return '写一篇考研英语一 Part B 大作文（160–200 词，三段），主题自选但要能自然容纳下面的生词。\n' +
    '可参考以下三段框架骨架（可改写，不要机械照抄）：\n' + frames + '\n\n' +
    '必须自然用上这些生词（每个至少一次，可用变形）：\n' + wordLines + '\n\n' +
    '要求：英文；第一段描述图画/现象，第二段分析原因或影响，第三段建议/升华；不要编造统计数字；不要用中文写英文；另给中文翻译和 3 条中文提纲。\n' +
    '只返回 JSON：{"title":"...","topic":"...","en":"段落1\\n\\n段落2\\n\\n段落3","zh":"...","outline":["...","...","..."]}';
}
function regenerateDaily() {
  if (state.building) return;
  daily = null; saveDaily();
  renderToday();
}
function openHistorySheet(index) {
  var d = typeof index === 'number' ? dailyHistory[index] : null;
  if (!d) {
    var html = '<div class="results">';
    if (!dailyHistory.length) html += '<div class="empty"><b>还没有历史</b>每天生成范文后会存在这里。</div>';
    dailyHistory.forEach(function (h, i) {
      html += '<button type="button" class="result" data-act="open-history" data-index="' + i + '"><div class="result-main"><div class="result-word"><b>' + esc(h.date) + '</b><span class="badge">' + esc(partLabel(h.part)) + '</span></div><div class="result-zh">' + esc(h.title || '') + '</div></div></button>';
    });
    html += '</div>';
    openSheet('范文历史', html, function () {
      $$('#sheetBody [data-act="open-history"]').forEach(function (b) {
        b.addEventListener('click', function () { openHistorySheet(Number(b.getAttribute('data-index')) || 0); });
      });
    });
    return;
  }
  var body = '<div class="hero-kicker"><span>' + esc(d.date) + ' · ' + partLabel(d.part) + '</span><span class="badge">' + esc(dailySourceLabel(d)) + '</span></div>' +
    '<h3 class="hero-title">' + esc(d.title || '') + '</h3>' +
    '<div class="essay-text">' + paragraphs(d.en, d.words || []) + '</div>' +
    '<details class="details"><summary>中文翻译</summary><div class="details-body">' + esc(d.zh || '') + '</div></details>' +
    '<div class="actions"><button type="button" class="btn ghost" data-act="speak-history">朗读</button></div>';
  openSheet('往期范文', body, function () {
    var b = $('#sheetBody [data-act="speak-history"]');
    if (b) b.addEventListener('click', function () { speak(d.en); });
  });
}


/* ================= 作文库 ================= */
function templateById(id) {
  var arr = ESSAYS.templates || [];
  for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
  return null;
}
function renderEssayTab() {
  var tabs = $('#essayTabs');
  if (!tabs) return;
  tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === state.essayTab); });
  var q = ($('#essaySearch').value || '').trim().toLowerCase();
  var box = $('#essayContent');
  var html = '';
  if (state.essayTab === 'templates') {
    var list = (ESSAYS.templates || []).filter(function (t) {
      return !q || (t.type + ' ' + (t.typeEn || '') + ' ' + (t.scene || '') + ' ' + (t.freq || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) html = '<div class="empty"><b>没有匹配的模板</b>换个关键词试试。</div>';
    list.forEach(function (t) {
      html += '<button type="button" class="list-card" data-open-template="' + esc(t.id) + '"><h3>' + esc(t.type) + ' <span class="badge">' + esc(t.typeEn || '') + '</span></h3><p>' + esc(t.scene || '') + '</p><div class="meta-line"><span>' + esc(t.wordTarget || '') + '</span><span>' + esc(t.freq || '') + '</span></div></button>';
    });
  } else if (state.essayTab === 'frameworks') {
    var fs = (ESSAYS.frameworks || []).filter(function (f) {
      return !q || (f.title + ' ' + f.subtitle + ' ' + (f.use || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!fs.length) html = '<div class="empty"><b>没有匹配的框架</b>换个关键词试试。</div>';
    fs.forEach(function (f) {
      html += '<button type="button" class="list-card" data-open-framework="' + esc(f.id) + '"><h3>' + esc(f.title) + '</h3><p>' + esc(f.subtitle) + '</p><div class="meta-line"><span>' + esc(f.use || '') + '</span><span>' + (f.paragraphs || []).length + ' 段</span></div></button>';
    });
  } else if (state.essayTab === 'samples') {
    var ss = (ESSAYS.samples || []).map(function (s, i) { return { s: s, i: i }; }).filter(function (it) {
      var s = it.s;
      return !q || ((s.year || '') + ' ' + (s.titleZh || '') + ' ' + (s.topicEn || '') + ' ' + (s.part || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!ss.length) html = '<div class="empty"><b>没有匹配的范文</b>换个关键词试试。</div>';
    ss.forEach(function (it) {
      var s = it.s;
      html += '<button type="button" class="list-card" data-open-sample="' + it.i + '"><h3>' + s.year + ' · ' + esc(s.titleZh || s.topicEn || '') + ' <span class="badge">' + (s.part === 'A' ? 'Part A' : 'Part B') + '</span></h3><p>' + esc((s.pictureZh || s.directionsZh || '').slice(0, 90)) + '</p><div class="meta-line"><span>' + esc(s.topicEn || '') + '</span><span>' + esc(s.chartType || '') + '</span></div></button>';
    });
  } else if (state.essayTab === 'topics') {
    var ts = (ESSAYS.topics || []).filter(function (t) {
      if (!q) return true;
      if ((t.title + ' ' + (t.desc || '')).toLowerCase().indexOf(q) >= 0) return true;
      return (t.entries || []).some(function (e) { return ((e.en || '') + ' ' + (e.zh || '')).toLowerCase().indexOf(q) >= 0; });
    });
    if (!ts.length) html = '<div class="empty"><b>没有匹配的语料</b>换个关键词试试。</div>';
    ts.forEach(function (t) {
      html += '<button type="button" class="list-card" data-open-topic="' + esc(t.id) + '"><h3>' + esc(t.emoji || '') + ' ' + esc(t.title) + '</h3><p>' + esc(t.desc || '') + '</p><div class="meta-line"><span>' + (t.entries || []).length + ' 条</span><span>' + esc(t.group || '') + '</span></div></button>';
    });
  } else if (state.essayTab === 'roots') {
    var rs = ROOTS.filter(function (r) {
      return !q || ((r.k || '') + ' ' + (r.m || '') + ' ' + (r.o || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!rs.length) html = '<div class="empty"><b>没有匹配的词根</b>换个关键词试试。</div>';
    rs.slice(0, 120).forEach(function (r, i) {
      var idx = ROOTS.indexOf(r);
      html += '<button type="button" class="list-card" data-open-root="' + idx + '"><h3>' + esc(r.k) + ' <span class="badge">' + esc(r.c || '') + '</span></h3><p>' + esc(r.m || '') + '</p><div class="meta-line"><span>' + esc(r.o || '') + '</span><span>' + (r.ex || []).length + ' 个例词</span></div></button>';
    });
    if (rs.length > 120) html += '<div class="freq-note">只显示前 120 条，输入关键词可缩小范围。</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-open-template]').forEach(function (b) { b.addEventListener('click', function () { openTemplate(b.getAttribute('data-open-template')); }); });
  box.querySelectorAll('[data-open-framework]').forEach(function (b) { b.addEventListener('click', function () { openFramework(b.getAttribute('data-open-framework')); }); });
  box.querySelectorAll('[data-open-sample]').forEach(function (b) { b.addEventListener('click', function () { openSample(Number(b.getAttribute('data-open-sample'))); }); });
  box.querySelectorAll('[data-open-topic]').forEach(function (b) { b.addEventListener('click', function () { openTopic(b.getAttribute('data-open-topic')); }); });
  box.querySelectorAll('[data-open-root]').forEach(function (b) { b.addEventListener('click', function () { openRoot(Number(b.getAttribute('data-open-root'))); }); });
}
function openTemplate(id) {
  var t = templateById(id);
  if (!t) return;
  var html = '<div class="meta-line"><span>' + esc(t.typeEn || '') + '</span><span>' + esc(t.wordTarget || '') + '</span></div>';
  html += '<p class="freq-note">' + esc(t.scene || '') + '</p>';
  (t.blocks || []).forEach(function (b) {
    html += '<div class="template-block"><h4>' + esc(b.name || '') + '</h4><div class="en">' + linkify(b.text || '', []) + '</div><div class="zh">' + esc(b.zh || '') + '</div>';
    if (b.note) html += '<div class="note">' + esc(b.note) + '</div>';
    html += '</div>';
  });
  html += '<div class="actions"><button type="button" class="btn ghost" data-act="copy-template">复制全文</button><button type="button" class="btn ghost" data-act="hide-zh">背诵模式</button></div>';
  openSheet(t.type, html, function () {
    var copy = $('#sheetBody [data-act="copy-template"]');
    if (copy) copy.addEventListener('click', function () { copyText((t.blocks || []).map(function (b) { return b.text; }).join('\n')); });
    var hide = $('#sheetBody [data-act="hide-zh"]');
    if (hide) hide.addEventListener('click', function () { $('#sheetBody').classList.toggle('hide-zh'); hide.textContent = $('#sheetBody').classList.contains('hide-zh') ? '显示中文' : '背诵模式'; });
  });
}
function openFramework(id) {
  var f = frameworkById(id);
  if (!f) return;
  var html = '<p class="freq-note">' + esc(f.subtitle || '') + ' · ' + esc(f.use || '') + '</p>';
  (f.paragraphs || []).forEach(function (p) {
    html += '<div class="details" open><summary>' + esc(p.role) + '</summary><div class="details-body"><div class="freq-note">' + esc(p.goal || '') + '</div>';
    (p.frames || []).forEach(function (fr) {
      html += '<div class="frame"><div class="en">' + linkify(fr.en || '', []) + '</div><div class="zh">' + esc(fr.zh || '') + '</div>';
      if (fr.note) html += '<div class="note">' + esc(fr.note) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  });
  html += '<div class="actions"><button type="button" class="btn ghost" data-act="copy-framework">复制框架</button><button type="button" class="btn ghost" data-act="hide-zh">背诵模式</button></div>';
  openSheet(f.title, html, function () {
    var copy = $('#sheetBody [data-act="copy-framework"]');
    if (copy) copy.addEventListener('click', function () {
      var txt = (f.paragraphs || []).map(function (p) { return '[' + p.role + ']\n' + (p.frames || []).map(function (x) { return x.en; }).join('\n'); }).join('\n\n');
      copyText(txt);
    });
    var hide = $('#sheetBody [data-act="hide-zh"]');
    if (hide) hide.addEventListener('click', function () { $('#sheetBody').classList.toggle('hide-zh'); hide.textContent = $('#sheetBody').classList.contains('hide-zh') ? '显示中文' : '背诵模式'; });
  });
}
function openSample(i) {
  var s = (ESSAYS.samples || [])[i];
  if (!s) return;
  var html = '<div class="meta-line"><span>' + esc(s.year) + '</span><span>' + (s.part === 'A' ? 'Part A' : 'Part B') + '</span><span>' + esc(s.topicEn || '') + '</span></div>';
  if (s.pictureZh) html += '<div class="details"><summary>题目/图画</summary><div class="details-body">' + esc(s.pictureZh) + '<br>' + esc(s.directionsZh || '') + '</div></div>';
  html += '<div class="essay-text">' + paragraphs(s.model.en, []) + '</div>';
  html += '<details class="details" open><summary>中文翻译</summary><div class="details-body">' + esc(s.model.zh || '') + '</div></details>';
  if (s.model.outline && s.model.outline.length) {
    html += '<details class="details"><summary>三段提纲</summary><div class="details-body"><ol style="margin:0;padding-left:18px">' + s.model.outline.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ol></div></details>';
  }
  html += '<div class="actions"><button type="button" class="btn ghost" data-act="speak-sample">朗读</button></div>';
  openSheet(s.year + ' 范文', html, function () {
    var b = $('#sheetBody [data-act="speak-sample"]');
    if (b) b.addEventListener('click', function () { speak(s.model.en); });
  });
}
function openTopic(id) {
  var t = (ESSAYS.topics || []).filter(function (x) { return x.id === id; })[0];
  if (!t) return;
  var html = '<p class="freq-note">' + esc(t.desc || '') + '</p>';
  (t.entries || []).forEach(function (e) {
    html += '<div class="template-block"><h4>' + esc(e.type || '') + ' ' + esc(e.pos || '') + '</h4><div class="en">' + linkify(e.en || '', []) + '</div><div class="zh">' + esc(e.zh || '') + '</div>';
    if (e.example) html += '<div class="copy-line">' + linkify(e.example, []) + '</div><div class="freq-note">' + esc(e.exampleZh || '') + '</div>';
    if (e.note) html += '<div class="note">' + esc(e.note) + '</div>';
    html += '</div>';
  });
  openSheet(t.emoji + ' ' + t.title, html);
}
function openRoot(i) {
  var r = ROOTS[i];
  if (!r) return;
  var html = '<div class="meta-line"><span>' + esc(r.c || '') + '</span><span>' + esc(r.o || '') + '</span></div>';
  html += '<div class="copy-line"><b>' + esc(r.k) + '</b> — ' + esc(r.m || '') + '</div>';
  if (r.fn) html += '<p class="freq-note">' + esc(r.fn) + '</p>';
  if (r.ex && r.ex.length) {
    html += '<div class="details" open><summary>例词</summary><div class="details-body"><div class="root-row">';
    r.ex.forEach(function (w) { html += '<span class="root-chip"><b>' + linkify(w, []) + '</b></span>'; });
    html += '</div></div></div>';
  }
  openSheet('词根 · ' + r.k, html);
}

/* ================= PDF 导入 ================= */
var PDF_STOP = {};
('a an the and or but if then than as at by for from in into of on onto out over to up with without within through during before after above below between among against about around under again further once here there when where why how all any both each few more most other some such only own same so too very can could may might must shall should will would do does did done have has had having be am is are was were been being i me my we our you your he him his she her it its they them their this that these those not no nor one two three four five').split(' ').forEach(function (w) { PDF_STOP[w] = 1; });
var PDFJS_LOADING = null;

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (PDFJS_LOADING) return PDFJS_LOADING;
  PDFJS_LOADING = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'js/vendor/pdf.min.js';
    s.onload = function () {
      try {
        if (!window.pdfjsLib) throw new Error('PDF.js 未加载');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } catch (e) { PDFJS_LOADING = null; reject(e); }
    };
    s.onerror = function () { PDFJS_LOADING = null; reject(new Error('PDF.js 加载失败，请检查网络后重试')); };
    document.head.appendChild(s);
  });
  return PDFJS_LOADING;
}

function pdfIsFile(file) {
  if (!file) return false;
  return /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
}

function normalizePdfText(s) {
  return String(s || '')
    .replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl').replace(/\uFB05/g, 'st').replace(/\uFB06/g, 'st')
    .replace(/\u00AD/g, '')
    .replace(/\u2019/g, "'")
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfTokens(text) {
  var normalized = normalizePdfText(text);
  var arr = normalized.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var raw = arr[i].toLowerCase().replace(/^['-]+|['-]+$/g, '');
    if (raw.length < 2) continue;
    if (raw.slice(-2) === "'s") raw = raw.slice(0, -2);
    if (!raw) continue;
    if (settings.pdfFilterStop !== false && PDF_STOP[raw]) continue;
    out.push(raw);
  }
  return out;
}

function openPdfProgress(name) {
  openSheet('PDF 导入', '<div class="pdf-progress"><div class="bar"><i id="pdfBar"></i></div><p id="pdfProgressText">准备解析…</p><div class="actions"><button type="button" class="btn ghost" id="pdfCancel">取消</button></div></div><div class="pdf-note">文件只在本地解析，不会上传。支持文字版 PDF；扫描件需要 OCR。最多处理前 200 页。</div>', function () {
    var b = $('#pdfCancel');
    if (b) b.addEventListener('click', function () {
      if (state.pdf) state.pdf.cancelled = true;
      closeSheet();
      toast('已取消');
    });
  });
}
function updatePdfProgress(pct, text) {
  var bar = $('#pdfBar');
  var t = $('#pdfProgressText');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (t) t.textContent = text;
}

function parsePdfFile(file) {
  if (!file) return;
  if (!pdfIsFile(file)) { toast('请选择 PDF 文件'); return; }
  if (file.size > 50 * 1024 * 1024) { toast('PDF 不能超过 50MB'); return; }
  state.pdf = { name: file.name || 'PDF', cancelled: false, parsing: true, rows: [], stats: null, selected: {}, filter: 'new', q: '' };
  openPdfProgress(file.name || 'PDF');
  loadPdfJs().then(function (pdfjs) {
    return file.arrayBuffer().then(function (buf) {
      return pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useWorkerFetch: false }).promise;
    });
  }).then(function (pdf) {
    var pages = Math.min(pdf.numPages, 200);
    var counts = {}, unknown = {}, total = 0;
    var chain = Promise.resolve();
    for (var i = 1; i <= pages; i++) {
      (function (pageNo) {
        chain = chain.then(function () {
          if (!state.pdf || state.pdf.cancelled) throw new Error('CANCELLED');
          return pdf.getPage(pageNo).then(function (page) { return page.getTextContent(); }).then(function (tc) {
            var text = (tc.items || []).map(function (it) { return (it.str || '') + (it.hasEOL ? '\n' : ' '); }).join('');
            var toks = pdfTokens(text);
            for (var k = 0; k < toks.length; k++) {
              var raw = toks[k];
              total++;
              var lemma = FORM_MAP.get(raw) || raw;
              if (WORD_MAP.has(lemma)) counts[lemma] = (counts[lemma] || 0) + 1;
              else unknown[raw] = (unknown[raw] || 0) + 1;
            }
            updatePdfProgress(pageNo / pages * 100, '正在解析第 ' + pageNo + ' / ' + pages + ' 页');
            if (pageNo % 3 === 0) return new Promise(function (resolve) { setTimeout(resolve, 0); });
          });
        });
      })(i);
    }
    return chain.then(function () {
      if (!state.pdf || state.pdf.cancelled) throw new Error('CANCELLED');
      var rows = [];
      Object.keys(counts).forEach(function (w) {
        var x = WORD_MAP.get(w);
        rows.push({ w: w, n: counts[w], known: true, src: x.src, band: x.f && x.f.band, sense: senseText(x, 1), saved: !!book[w] });
      });
      Object.keys(unknown).forEach(function (w) {
        rows.push({ w: w, n: unknown[w], known: false, src: '', band: '', sense: '词库未收录', saved: false });
      });
      rows.sort(function (a, b) { if (a.known !== b.known) return a.known ? -1 : 1; return b.n - a.n || a.w.localeCompare(b.w); });
      if (!rows.length) {
        state.pdf.parsing = false;
        openSheet('PDF 导入', '<div class="empty"><b>没有提取到文字</b>这可能是扫描版/图片版 PDF，需要 OCR。当前只支持文字版 PDF；可以换一份文字版，或继续手动查词。</div><div class="actions"><button type="button" class="btn" data-close="1">关闭</button></div>');
        return;
      }
      var known = rows.filter(function (r) { return r.known; });
      var newRows = known.filter(function (r) { return !r.saved; });
      state.pdf.rows = rows;
      state.pdf.parsing = false;
      state.pdf.stats = {
        pages: pages,
        total: total,
        unique: rows.length,
        syllabus: known.filter(function (r) { return r.src === '大纲'; }).length,
        extra: known.filter(function (r) { return r.src === '扩展'; }).length,
        unknown: rows.length - known.length,
        saved: known.length - newRows.length
      };
      state.pdf.selected = {};
      newRows.forEach(function (r) { state.pdf.selected[r.w] = 1; });
      openPdfResult();
    });
  }).catch(function (e) {
    var msg = e && e.message ? e.message : '解析失败';
    if (msg === 'CANCELLED') { toast('已取消'); return; }
    if (/password/i.test(msg)) msg = '这个 PDF 有密码，暂不支持。请先解除密码再导入。';
    if (/Invalid PDF|InvalidPDF/i.test(msg)) msg = '文件不是有效的 PDF，或已经损坏。';
    openSheet('PDF 导入失败', '<div class="empty"><b>没有导入成功</b>' + esc(msg) + '</div><div class="actions"><button type="button" class="btn" data-close="1">关闭</button></div>');
  });
}

function pdfFilteredRows() {
  var p = state.pdf;
  if (!p) return [];
  var q = (p.q || '').toLowerCase();
  return p.rows.filter(function (r) {
    if (p.filter === 'new' && !(r.known && !r.saved)) return false;
    if (p.filter === 'saved' && !(r.known && r.saved)) return false;
    if (p.filter === 'unknown' && r.known) return false;
    if (p.filter === 'syllabus' && !(r.known && r.src === '大纲')) return false;
    if (p.filter === 'extra' && !(r.known && r.src === '扩展')) return false;
    if (q && (r.w + ' ' + (r.sense || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}
function pdfUpdateCount() {
  var p = state.pdf;
  if (!p) return;
  var n = Object.keys(p.selected).filter(function (w) { return p.selected[w]; }).length;
  var count = $('#pdfSelectedCount');
  if (count) count.textContent = '已选 ' + n + ' 个';
  var btn = $('#pdfImportBtn');
  if (btn) { btn.textContent = '加入生词本（' + n + '）'; btn.disabled = n === 0; }
}
function renderPdfList() {
  var p = state.pdf;
  var box = $('#pdfList');
  if (!p || !box) return;
  var rows = pdfFilteredRows();
  var html = '';
  var shown = rows.slice(0, 300);
  if (!shown.length) html = '<div class="empty" style="border:0;padding:20px 8px"><b>没有匹配的词</b>换个筛选或搜索词。</div>';
  shown.forEach(function (r) {
    var checked = p.selected[r.w] ? ' checked' : '';
    var disabled = r.known && !r.saved ? '' : ' disabled';
    var tag = !r.known ? '<span class="pdf-tag">未收录</span>' : (r.saved ? '<span class="pdf-tag saved">已在生词本</span>' : '<span class="pdf-tag">' + esc(r.src) + '</span>');
    html += '<label class="pdf-row' + (r.known ? '' : ' unknown') + '">' +
      '<input type="checkbox" data-pdf-word="' + esc(r.w) + '"' + checked + disabled + '>' +
      '<div class="pdf-main"><div class="pdf-word"><b>' + esc(r.w) + '</b>' + tag +
      (r.known ? '<span class="badge ' + bandClass(r.band) + '">' + esc(freqLabel(WORD_MAP.get(r.w))) + '</span>' : '') +
      '</div><div class="pdf-zh">' + esc(r.sense || '') + '</div></div>' +
      '<div class="pdf-count">' + r.n + ' 次</div></label>';
  });
  if (rows.length > 300) html += '<div class="pdf-note">只显示前 300 条；导入按当前筛选的已选词执行，不受 300 条限制。</div>';
  box.innerHTML = html;
  pdfUpdateCount();
}
function openPdfResult() {
  var p = state.pdf;
  if (!p || !p.stats) return;
  var s = p.stats;
  var html = '<div class="pdf-summary"><div class="pdf-sum"><b>' + s.pages + '</b><span>页</span></div><div class="pdf-sum"><b>' + s.unique + '</b><span>唯一词</span></div><div class="pdf-sum"><b>' + s.syllabus + '</b><span>大纲词</span></div><div class="pdf-sum"><b>' + s.extra + '</b><span>扩展词</span></div><div class="pdf-sum"><b>' + s.unknown + '</b><span>未收录</span></div><div class="pdf-sum"><b>' + s.saved + '</b><span>已在生词本</span></div></div>';
  html += '<p class="pdf-note">共 ' + s.total + ' 个词次；默认只选“新词”。未收录词不能加入生词本。文件仅在本机解析。</p>';
  html += '<div class="pdf-toolbar"><select id="pdfFilter" class="btn sm ghost" style="min-height:40px"><option value="new">只看新词</option><option value="all">全部</option><option value="syllabus">大纲词</option><option value="extra">扩展词</option><option value="saved">已在生词本</option><option value="unknown">未收录</option></select><div class="search-box"><input id="pdfSearch" type="search" placeholder="搜索单词/释义"></div></div>';
  html += '<div class="row" style="margin:8px 0"><button type="button" class="btn sm ghost" data-pdf-action="all">全选</button><button type="button" class="btn sm ghost" data-pdf-action="none">清空</button><button type="button" class="btn sm ghost" data-pdf-action="new">仅新词</button><span class="freq-note" id="pdfSelectedCount"></span></div>';
  html += '<div class="pdf-list" id="pdfList"></div>';
  html += '<div class="pdf-actions"><button type="button" class="btn primary" id="pdfImportBtn" disabled>加入生词本（0）</button><button type="button" class="btn ghost" id="pdfCloseBtn">关闭</button></div>';
  openSheet('PDF 导入 · ' + (p.name || ''), html, function () {
    var filter = $('#pdfFilter');
    var search = $('#pdfSearch');
    if (filter) filter.addEventListener('change', function () { state.pdf.filter = filter.value; renderPdfList(); });
    if (search) search.addEventListener('input', function () { state.pdf.q = search.value; renderPdfList(); });
    var list = $('#pdfList');
    if (list) list.addEventListener('change', function (ev) {
      var cb = ev.target.closest('[data-pdf-word]');
      if (!cb) return;
      var w = cb.getAttribute('data-pdf-word');
      if (cb.checked) state.pdf.selected[w] = 1; else delete state.pdf.selected[w];
      pdfUpdateCount();
    });
    $$('#sheetBody [data-pdf-action]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-pdf-action');
        var rows = pdfFilteredRows();
        if (act === 'none') state.pdf.selected = {};
        if (act === 'all') rows.forEach(function (r) { if (r.known && !r.saved) state.pdf.selected[r.w] = 1; });
        if (act === 'new') {
          state.pdf.selected = {};
          rows.forEach(function (r) { if (r.known && !r.saved) state.pdf.selected[r.w] = 1; });
        }
        renderPdfList();
      });
    });
    var imp = $('#pdfImportBtn');
    if (imp) imp.addEventListener('click', importPdfSelected);
    var close = $('#pdfCloseBtn');
    if (close) close.addEventListener('click', function () { state.pdf = null; closeSheet(); });
    renderPdfList();
  });
}
function importPdfSelected() {
  var p = state.pdf;
  if (!p) return;
  var imported = 0, skipped = 0, unknown = 0;
  Object.keys(p.selected).forEach(function (w) {
    if (!p.selected[w]) return;
    var x = WORD_MAP.get(w);
    if (!x) { unknown++; return; }
    if (book[w]) { skipped++; return; }
    ensureWord(w, { source: 'pdf', sourceName: p.name, importedAt: todayStr() });
    imported++;
  });
  saveBook();
  state.pdf = null;
  closeSheet();
  renderBook();
  renderToday();
  toast('导入 ' + imported + ' 个' + (skipped ? '，跳过已在生词本 ' + skipped + ' 个' : '') + (unknown ? '，未收录 ' + unknown + ' 个' : ''));
}

/* ================= 安装到手机 ================= */
function isStandalone() {
  try { if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) {}
  return window.navigator.standalone === true;
}
function isIOSDevice() {
  var ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isWeChat() { return /MicroMessenger/i.test(navigator.userAgent || ''); }
function openInstallGuide() {
  var ios = isIOSDevice();
  var android = /Android/i.test(navigator.userAgent || '');
  var wx = isWeChat();
  var html = '<div class="install-hero"><span class="brand-mark" aria-hidden="true">研</span><div><h3>把研词放到手机主屏</h3><p>它是可安装网页（PWA），不是应用商店 App；不用下载安装包。</p></div></div>';
  if (wx) {
    html += '<span class="install-platform">微信内置浏览器</span><ol class="install-steps"><li>点右上角 <b>…</b></li><li>选择 <b>在浏览器打开</b></li><li>再用下面的 iPhone / Android 步骤安装</li></ol><div class="install-note">微信里直接“添加到桌面”通常不可用，必须换到系统浏览器。</div>';
  } else if (ios) {
    html += '<span class="install-platform">iPhone / iPad · Safari</span><ol class="install-steps"><li>确认当前是 <b>Safari</b> 打开本页</li><li>点底部 <b>分享</b> 按钮（方框向上箭头）</li><li>向下找 <b>添加到主屏幕</b> → 添加</li><li>回到桌面，点“研词”图标即可全屏使用</li></ol><div class="install-note">iOS 不提供“下载 App”按钮；PWA 安装就是“添加到主屏幕”。用 Chrome/微信打开时不会出现这个选项。</div>';
  } else if (android) {
    html += '<span class="install-platform">Android · Chrome / Edge</span><ol class="install-steps"><li>点浏览器右上角 <b>⋮</b> 菜单</li><li>选择 <b>安装应用</b> 或 <b>添加到主屏幕</b></li><li>确认安装，桌面会出现“研词”图标</li></ol><div class="install-note">部分浏览器会直接弹出安装提示；没有提示就用菜单里的“添加到主屏幕”。</div>';
  } else {
    html += '<span class="install-platform">桌面 / 其他浏览器</span><ol class="install-steps"><li>打开浏览器菜单</li><li>找 <b>安装应用</b> 或 <b>添加到主屏幕</b></li><li>手机上建议用 Safari 或 Chrome 打开</li></ol>';
  }
  if (deferredPrompt) html += '<div class="actions"><button type="button" class="btn primary" id="installNowBtn">立即安装</button></div>';
  html += '<div class="install-note">安装后离线可用；数据仍然只存在这台设备，换机请先在设置里导出备份。</div>';
  openSheet('安装到手机', html, function () {
    var b = $('#installNowBtn');
    if (b) b.addEventListener('click', function () {
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function () { deferredPrompt = null; var ib = $('#installBtn'); if (ib) ib.hidden = true; }).catch(function () { deferredPrompt = null; });
          return;
        } catch (e) { deferredPrompt = null; }
      }
      openInstallGuide();
    });
  });
}

/* ================= 生词本 ================= */
function renderBook() {
  var box = $('#bookList');
  if (!box) return;
  var items = bookEntries();
  var stats = $('#bookStats');
  if (stats) {
    var totalExp = items.reduce(function (n, it) { return n + (it.e.exposures || 0); }, 0);
    stats.innerHTML = '<div class="stat"><b>' + items.length + '</b><span>生词</span></div><div class="stat"><b>' + dueCount() + '</b><span>待复现</span></div><div class="stat"><b>' + totalExp + '</b><span>累计出现</span></div>';
  }
  if (!items.length) {
    box.innerHTML = '<div class="empty"><b>生词本还是空的</b>查词时点「加入生词本」，之后每天会从这里选词编进范文。</div>';
    return;
  }
  var sort = state.bookSort;
  items.sort(function (a, b) {
    if (sort === 'recent') return String(b.e.addedAt).localeCompare(String(a.e.addedAt));
    if (sort === 'freq') return ((b.x.f && b.x.f.yi) || 0) - ((a.x.f && a.x.f.yi) || 0);
    return String(a.e.due).localeCompare(String(b.e.due)) || String(a.e.lastShown || '').localeCompare(String(b.e.lastShown || ''));
  });
  var html = '';
  items.forEach(function (it) {
    var x = it.x;
    var due = it.e.due <= todayStr() ? '待复现' : formatDate(it.e.due) + ' 复现';
    html += '<div class="book-item"><button type="button" class="main" data-word="' + esc(x.w) + '"><b>' + esc(x.w) + '</b> <span class="badge ' + bandClass(x.f && x.f.band) + '">' + esc(freqLabel(x)) + '</span><p>' + esc(senseText(x, 2)) + '</p></button><div class="side"><div>' + due + '</div><div>出现 ' + (it.e.exposures || 0) + ' 次</div><button type="button" data-remove="' + esc(x.w) + '">移除</button></div></div>';
  });
  box.innerHTML = html;
  box.querySelectorAll('[data-word]').forEach(function (b) { b.addEventListener('click', function () { openWord(b.getAttribute('data-word')); }); });
  box.querySelectorAll('[data-remove]').forEach(function (b) { b.addEventListener('click', function () { toggleBook(b.getAttribute('data-remove')); }); });
}

/* ================= 设置 ================= */
function renderSettings() {
  var box = $('#settingsContent');
  if (!box) return;
  var html = '';
  html += '<div class="setting-card"><h3>学习计划</h3><p>每天从生词本选几个词，编进一篇范文。没有打卡，也没有打分。</p>';
  html += '<div class="setting-row"><label>考试日期<small>用于倒计时，可改</small></label><input type="date" id="setExamDate" value="' + esc(settings.examDate) + '"></div>';
  html += '<div class="setting-row"><label>查词自动加入生词本<small>关掉后需要手动点「加入生词本」</small></label><label class="switch"><input type="checkbox" id="setAutoAdd"' + (settings.autoAdd !== false ? ' checked' : '') + '><i></i></label></div>';
  html += '<div class="setting-row"><label>PDF 过滤常见虚词<small>默认过滤 the/and/of；关掉会显示这些词</small></label><label class="switch"><input type="checkbox" id="setPdfStop"' + (settings.pdfFilterStop !== false ? ' checked' : '') + '><i></i></label></div>';
  html += '<div class="setting-row"><label>每天选词数<small>建议 3–5 个，范文才不会太挤</small></label><select id="setDailyCount"><option value="3"' + (Number(settings.dailyCount) === 3 ? ' selected' : '') + '>3 个</option><option value="4"' + (Number(settings.dailyCount) === 4 ? ' selected' : '') + '>4 个</option><option value="5"' + (Number(settings.dailyCount) === 5 ? ' selected' : '') + '>5 个</option></select></div>';
  html += '<div class="setting-row"><label>默认作文<small>每天打开时优先生成哪一篇</small></label><select id="setDailyPart"><option value="B"' + (settings.dailyPart === 'B' ? ' selected' : '') + '>Part B 大作文</option><option value="A"' + (settings.dailyPart === 'A' ? ' selected' : '') + '>Part A 小作文</option></select></div>';
  html += '<div class="setting-row"><label>深色模式<small>跟随系统 / 强制浅色 / 强制深色</small></label><select id="setTheme"><option value="auto"' + (settings.theme === 'auto' ? ' selected' : '') + '>跟随系统</option><option value="light"' + (settings.theme === 'light' ? ' selected' : '') + '>浅色</option><option value="dark"' + (settings.theme === 'dark' ? ' selected' : '') + '>深色</option></select></div>';
  html += '</div>';

  html += '<div class="setting-card"><h3>PDF 导入</h3><p>从文字版 PDF 提取英文单词，筛选后加入生词本。文件只在本机解析，不上传。</p><div class="row"><button type="button" class="btn sm" id="settingsPdfBtn">选择 PDF</button></div><div class="freq-note" style="margin-top:6px">扫描版/图片版 PDF 需要 OCR，当前不支持。</div></div>';
  html += '<div class="setting-card"><h3>安装到手机</h3><p>这是可安装网页（PWA），不是应用商店 App。iPhone 用 Safari 分享→添加到主屏幕；Android 用 Chrome 菜单→安装应用。</p><div class="row"><button type="button" class="btn sm ghost" id="installGuideBtn">查看安装步骤</button></div></div>';
  html += '<div class="setting-card"><h3>AI 范文（可选）</h3><p>不填 Key 也能用：会用 IKTNF 的 49 篇现成范文匹配你的生词。填了 Key，就能按你的生词生成专属范文。</p>';
  html += '<div class="setting-row"><label>DeepSeek API Key<small>只保存在本机，不会上传到别处</small></label><input type="password" id="setKey" value="' + esc(settings.key) + '" placeholder="sk-..." autocomplete="off"></div>';
  html += '<div class="setting-row"><label>模型<small>默认 deepseek-flash</small></label><select id="setModel"><option value="deepseek-flash"' + (settings.model === 'deepseek-flash' ? ' selected' : '') + '>deepseek-flash</option><option value="deepseek-v4-pro"' + (settings.model === 'deepseek-v4-pro' ? ' selected' : '') + '>deepseek-v4-pro</option></select></div>';
  html += '<div class="row"><button type="button" class="btn sm ghost" id="saveKeyBtn">保存 Key</button><span class="freq-note">在 platform.deepseek.com 申请；按量付费，一天一篇约几分钱。</span></div>';
  html += '</div>';

  html += '<div class="setting-card"><h3>备份</h3><p>进度只存在本机。换手机、清浏览器数据前，先导出。</p>';
  html += '<div class="row"><button type="button" class="btn sm" id="exportBtn">导出 JSON</button><button type="button" class="btn sm ghost" id="importBtn">导入 JSON</button><input type="file" id="importFile" accept="application/json" hidden></div>';
  html += '<div class="freq-note" style="margin-top:8px">导出不含 API Key；只含生词本、范文历史、设置。</div>';
  html += '</div>';

  html += '<div class="setting-card"><h3>数据</h3>';
  html += '<div class="kv"><b>词库</b><span>' + (META.words || WORDS.length) + ' 词（大纲 ' + (META.syllabus || 5501) + ' + 扩展 ' + (META.extra || 0) + '）</span><b>考频</b><span>英语一 2002–2026，25 套正文</span><b>词根</b><span>' + (META.rootEntries || ROOTS.length) + ' 条</span><b>作文</b><span>' + (META.essayEntries || 0) + ' 条语料 · ' + (META.templates || 0) + ' 类模板 · ' + (META.samples || 0) + ' 篇范文</span></div>';
  html += '<div class="row"><button type="button" class="btn sm ghost" id="demoBtn">加载示例生词</button><button type="button" class="btn sm ghost" id="clearBtn">清空本机数据</button></div>';
  html += '</div>';

  html += '<div class="setting-card"><h3>来源与许可</h3><p>代码与数据仅用于个人学习。词频来自 npee（MIT）；词典/词根来自 ECDICT（MIT）；作文语料来自 IKTNF（MIT）；词卡来自 JTKING27（CC BY-SA 4.0）；扩展词频来自 xiangjiawei（MIT）。真题原文不随应用分发；释义和作文句由 AI 整理，仅供参考。</p><p style="margin-top:6px">' + esc('构建：' + (META.builtAt || '')) + '</p></div>';
  box.innerHTML = html;

  $('#setExamDate').addEventListener('change', function (e) { settings.examDate = e.target.value || DEFAULTS.examDate; saveSettings(); updateExamPill(); });
  $('#setAutoAdd').addEventListener('change', function (e) { settings.autoAdd = !!e.target.checked; saveSettings(); });
  $('#setPdfStop').addEventListener('change', function (e) { settings.pdfFilterStop = !!e.target.checked; saveSettings(); });
  if ($('#installGuideBtn')) $('#installGuideBtn').addEventListener('click', openInstallGuide);
  if ($('#settingsPdfBtn')) $('#settingsPdfBtn').addEventListener('click', function () { var f = $('#pdfFile'); if (f) { f.value = ''; f.click(); } });
  $('#setDailyCount').addEventListener('change', function (e) { settings.dailyCount = Number(e.target.value) || 4; saveSettings(); });
  $('#setDailyPart').addEventListener('change', function (e) { settings.dailyPart = e.target.value === 'A' ? 'A' : 'B'; saveSettings(); daily = null; saveDaily(); });
  $('#setTheme').addEventListener('change', function (e) { settings.theme = e.target.value; saveSettings(); applyTheme(); });
  $('#setModel').addEventListener('change', function (e) { settings.model = e.target.value; saveSettings(); });
  $('#saveKeyBtn').addEventListener('click', function () { settings.key = $('#setKey').value.trim(); saveSettings(); toast(settings.key ? 'Key 已保存' : '已清空 Key'); });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', importData);
  $('#demoBtn').addEventListener('click', loadSampleWords);
  $('#clearBtn').addEventListener('click', function () {
    if (!confirm('会清空生词本、范文历史和设置（含 Key），确定吗？')) return;
    Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
    location.reload();
  });
}

/* ================= 导入导出 ================= */
function exportData() {
  var data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    book: book,
    settings: { examDate: settings.examDate, dailyCount: settings.dailyCount, dailyPart: settings.dailyPart, model: settings.model, theme: settings.theme, autoAdd: settings.autoAdd !== false, pdfFilterStop: settings.pdfFilterStop !== false },
    history: dailyHistory.slice(0, 30),
    customCards: customCards,
    daily: daily
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = '研词备份-' + todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  toast('已导出（不含 API Key）');
}
function importData(ev) {
  var f = ev.target.files && ev.target.files[0];
  if (!f) return;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var d = JSON.parse(String(reader.result));
      if (!d || !d.book || typeof d.book !== 'object') throw new Error('文件格式不对');
      if (!confirm('导入会覆盖当前生词本和历史，确定吗？')) return;
      book = d.book || {};
      dailyHistory = Array.isArray(d.history) ? d.history.slice(0, 30) : [];
      customCards = d.customCards && typeof d.customCards === 'object' ? d.customCards : {};
      daily = d.daily || null;
      if (d.settings) {
        settings.examDate = d.settings.examDate || settings.examDate;
        settings.dailyCount = Number(d.settings.dailyCount) || settings.dailyCount;
        settings.dailyPart = d.settings.dailyPart === 'A' ? 'A' : 'B';
        settings.model = d.settings.model || settings.model;
        settings.theme = d.settings.theme || settings.theme;
        settings.autoAdd = d.settings.autoAdd !== false;
        settings.pdfFilterStop = d.settings.pdfFilterStop !== false;
      }
      saveBook(); saveHistory(); saveCustom(); saveDaily(); saveSettings();
      applyTheme(); renderToday(); renderBook(); renderSettings();
      toast('已导入');
    } catch (e) { toast('导入失败：' + e.message.slice(0, 80)); }
  };
  reader.readAsText(f);
}

/* ================= 主题 / 安装 / 初始化 ================= */
function applyTheme() {
  var t = settings.theme || 'auto';
  if (t === 'auto') {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
  var btn = $('#themeBtn');
  if (btn) btn.title = t === 'auto' ? '主题：跟随系统' : (t === 'dark' ? '主题：深色' : '主题：浅色');
}
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW', e); });
  }
  var ib = $('#installBtn');
  if (ib && !isStandalone()) ib.hidden = false;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (ib) ib.hidden = false;
  });
  if (ib) ib.addEventListener('click', function () {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          ib.hidden = true;
        }).catch(function () { deferredPrompt = null; });
        return;
      } catch (e) { deferredPrompt = null; }
    }
    openInstallGuide();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    if (ib) ib.hidden = true;
    toast('已安装到主屏');
  });
}
function init() {
  buildMaps();
  applyTheme();
  bindSheetEvents();
  initPWA();
  $$('.tabbar button').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
  });
  var pdfBtn = $('#bookPdfImport');
  var pdfInput = $('#pdfFile');
  if (pdfBtn && pdfInput) {
    pdfBtn.addEventListener('click', function () { pdfInput.value = ''; pdfInput.click(); });
  }
  if (pdfInput) {
    pdfInput.addEventListener('change', function () {
      var f = pdfInput.files && pdfInput.files[0];
      pdfInput.value = '';
      if (f) parsePdfFile(f);
    });
  }
  var themeBtn = $('#themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    settings.theme = settings.theme === 'auto' ? 'light' : (settings.theme === 'light' ? 'dark' : 'auto');
    saveSettings(); applyTheme();
    toast(settings.theme === 'auto' ? '跟随系统' : (settings.theme === 'dark' ? '深色模式' : '浅色模式'));
  });
  var si = $('#searchInput');
  var stimer = null;
  if (si) si.addEventListener('input', function () {
    clearTimeout(stimer);
    stimer = setTimeout(renderSearch, 110);
  });
  $('#searchClear').addEventListener('click', function () { $('#searchInput').value = ''; renderSearch(); $('#searchInput').focus(); });
  $('#searchResults').addEventListener('click', function (e) {
    var b = e.target.closest('[data-word]');
    if (b) openWord(b.getAttribute('data-word'));
  });
  $('#searchHome').addEventListener('click', function (e) {
    var b = e.target.closest('[data-word]');
    if (b) { openWord(b.getAttribute('data-word')); return; }
    var v = e.target.closest('[data-view-link]');
    if (v) showView(v.getAttribute('data-view-link'));
  });
  $('#essayTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    state.essayTab = b.getAttribute('data-tab');
    renderEssayTab();
  });
  $('#essaySearch').addEventListener('input', function () { renderEssayTab(); });
  $('#bookSort').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sort]');
    if (!b) return;
    state.bookSort = b.getAttribute('data-sort');
    $$('#bookSort button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderBook();
  });
  $('#bookExport').addEventListener('click', exportData);
  window.addEventListener('hashchange', function () {
    var v = (location.hash || '').replace(/^#\//, '');
    if (v && v !== state.view && $('#view-' + v)) showView(v);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (daily && daily.date !== todayStr()) { daily = null; saveDaily(); }
    if (state.view === 'today') renderToday();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#sheet') && !$('#sheet').hidden) closeSheet();
  });
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { if (settings.theme === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    } catch (e) {}
  }
  var v = (location.hash || '').replace(/^#\//, '');
  showView(v && $('#view-' + v) ? v : 'today');
}
window.addEventListener('load', init);


