// ============================================================
// نظام تقييم الأعمال الفنية — منطق التطبيق (v2)
// التصميم مبني من الصفر على البنية الجديدة:
//   40 بطاقة مفاهيمية، 6 فئات، 8 مجموعات، 140 حالة.
// تاريخ الإنشاء: 10 أكتوبر 2026
// ============================================================

// --- الحالة العامة ---
const state = {
  view: 'home',
  library: [],
  activeDraft: null,
  current: null,
  currentDetailsId: null,
  filters: { medium: 'all', format: 'all', sort: 'desc', tag: '' },
  wizardData: { name: '', medium: null, format: null, relation: null, nature: null, mode: 'detailed', watchDate: '', tags: [] },
  expandedCards: new Set(),     // بطاقات مفتوحة بالكامل (بعد «رؤية المزيد»)
  theme: 'dark',
  showGradeDescriptions: false,  // الفكرة 34 — الافتراضي: مطفأ (القرار المعتمد 9 أكتوبر 2026)
  lists: [],       // الفكرة 15/قوائم مخصصة
  umbrellas: [],   // الفكرة 29: مظلات تجميع
  selectedForCompare: [], // الفكرة 12: عملان لل مقارنة
  systemHash: null,   // إصلاح ط7: بصمة تعريف البطاقات وقت التحميل (في الذاكرة فقط — لا تُخزَّن)
  weightsHash: null,  // إصلاح ط7: بصمة جدول الأوزان وقت التحميل
};

// ============================================================
// 1. الانطباق والحساب (النظام الجديد)
// ============================================================

// تحويل الوسيط → متحرك/واقعي
function isAnimated(medium) { return medium !== 'live'; }

// هل تنطبق البطاقة على التكوين؟
function cardApplies(card, config) {
  switch (card.appliesTo) {
    case 'ALL': return true;
    case 'ANIMATED': return isAnimated(config.medium);
    case 'LIVE': return !isAnimated(config.medium);
    case 'DERIV': return config.relation === 'derivative';
    case 'FILM_SERIES': return config.format === 'film_series';
    default: return true;
  }
}

// قائمة البطاقات المنطبقة مجمعة حسب الفئة
function getApplicableCards(config) {
  const result = [];
  for (const cat of CATEGORIES) {
    const cards = CARDS.filter(c => c.categoryId === cat.id && cardApplies(c, config));
    if (cards.length > 0) {
      result.push({ category: cat, cards });
    }
  }
  return result;
}

// نص البطاقة (مع الصياغة الخاصة إن وُجدت)
function getCardText(card, config) {
  const override = resolveCardText(card, config.format);
  if (override) return override;
  return card.question;
}

// الأقسام المشروطة داخل بطاقات العلاقة بالمصدر (بحسب طبيعة التبعية)
function getNatureCondition(card, config) {
  if (!card.conditionalByNature || !config.nature) return null;
  const cond = card.conditionalByNature[config.nature];
  if (!cond) return null;
  return cond;
}

// ============================================================
// 2. الحساب النهائي (فئات + نقاط)
// ============================================================

function calculateScore(config, scores) {
  // v20 D-4: حارس في المسار المشترك نفسه — أي مستهلك (autoSaveCurrent، saveFinal، العرض، الاستيراد)
  // لا يحصل أبدًا على نتيجة مكتملة لتكوين غير معروف أو ناقص؛ يعود شكل النتيجة المعتاد مع allScored=false.
  if (!hasKnownConfig(config)) return { allScored: false, totalScore: null, weights: null, categoryScores: [] };
  const weights = calculateWeights(config.medium, config.format, config.relation);
  const cats = getApplicableCards(config);
  const categoryScores = [];
  let totalScore = 0;
  let allScored = true;

  for (const { category, cards } of cats) {
    const weight = weights[category.id] || 0;
    if (weight === 0) continue;

    let sum = 0, count = 0, catAllScored = true;
    for (const card of cards) {
      const s = scores ? scores[card.id] : undefined;
      if (typeof s === 'number' && Number.isFinite(s)) { sum += s; count++; }  // v18 B-01: القيم النصية/غير الرقمية تُعامل كغير مقيَّمة
      else catAllScored = false;
    }
    allScored = allScored && catAllScored;

    if (count === 0) {
      categoryScores.push({ categoryId: category.id, name: category.name, weight, cardsCount: cards.length, scoredCount: 0, allScored: false, points: 0 });
      continue;
    }

    const avg = sum / count;
    const points = (avg / 4) * weight;
    if (catAllScored) totalScore += points;

    categoryScores.push({ categoryId: category.id, name: category.name, weight, cardsCount: cards.length, scoredCount: count, allScored: catAllScored, avg, points });
  }

  return { weights, categoryScores, totalScore, allScored };
}

function formatNumber(n) { return (Math.round(n * 10) / 10).toFixed(1); }
// formatPercent: يُمرّر له الوزن (0–10) وليس النسبة — يُستعمل في نص التقييم ونطاق المقارنة
function formatPercent(w) {
  // CMP-PCT-FLOAT: يُقرَّب إلى خانة عشرية واحدة قبل فحص «العدد الصحيح» كي لا يظهر 55.00000000000001 كـ«55.0%»
  const pct = Math.round((w / 10) * 100 * 10) / 10;
  return Number.isInteger(pct) ? pct + '%' : pct.toFixed(1) + '%';
}
// formatRatioPercent: يحوّل نسبة أداء (0–1) إلى نسبة مئوية — يُستعمل في المقارنة والإحصاءات
// (فصل صريح كي لا تُضرب النسبة في 10 مرتين)
function formatRatioPercent(ratio) {
  // CMP-PCT-FLOAT: نفس التقريب المسبق (0.55*100 = 55.00000000000001)
  const pct = Math.round(ratio * 100 * 10) / 10;
  return Number.isInteger(pct) ? pct + '%' : pct.toFixed(1) + '%';
}

// TABLE-INTRO: فقرة تمهيد «جدول الدرجات» للبطاقة (من GRADES_INTRO في system-data.js — خارج CARDS كي لا تتغير systemHash)
function gradesIntroOf(card) {
  try { return (typeof GRADES_INTRO !== 'undefined' && card && GRADES_INTRO[card.id]) || ''; } catch (e) { return ''; }
}

// ============================================================
// 3. التخزين المحلي
// ============================================================

let _lsAvailable = false;
try { _lsAvailable = typeof localStorage !== 'undefined'; } catch (e) { _lsAvailable = false; }
const _memStore = {};

function loadFromStorage(key, defaultValue) {
  if (_lsAvailable) {
    try {
      const data = localStorage.getItem(key);
      if (data === null) return defaultValue;
      return JSON.parse(data);
    } catch (e) { return defaultValue; }
  }
  return key in _memStore ? JSON.parse(_memStore[key]) : defaultValue;
}

let _storageFullAlerted = false;

function saveToStorage(key, value) {
  const str = JSON.stringify(value);
  if (_lsAvailable) {
    try {
      localStorage.setItem(key, str);
      _storageFullAlerted = false;
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError' && !_storageFullAlerted) {
        _storageFullAlerted = true;
        showStorageFullAlert();
      }
      _memStore[key] = str;
      return false;
    }
  }
  _memStore[key] = str;
  return true;
}

function generateUUID() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { const b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const hex = Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(''); return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20); } } catch (e) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ============================================================
// 4. التهيئة والعرض
// ============================================================

// تطبيع السجلات القديمة: علامة الشك كانت تُحفظ في ev.doubts — تُنقل إلى ev.doubtMarks عند التحميل (بلا فقد)
// القديم يُدمج أولًا ثم الحالي يغلبه — ثم تُحذف الخاصية القديمة نهائيًا حتى لا تُغلب تعديلات لاحقة
function normalizeDoubtMarks(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  const legacy = (ev.doubts && typeof ev.doubts === 'object' && !Array.isArray(ev.doubts)) ? ev.doubts : null;
  // حماية من صيغ مكسورة: doubtMarks يجب أن يكون كائن قيمة-منطقية
  let current = ev.doubtMarks;
  if (Array.isArray(current)) {
    const m = {};
    for (const k of current) m[k] = true;
    current = m;
  } else if (current && typeof current === 'object') {
    current = { ...current };
    for (const k in current) current[k] = !!current[k];
  } else {
    current = {};
  }
  // الدمج: القديم أولًا (يغلبه الحالي عند التعارض)
  if (legacy) {
    for (const k in legacy) {
      // الحالي يغلبه القديم فقط إن لم يُضبط بعد — إن حُدد الحالي فكلمة القديم تُهمل
      if (!(k in current)) current[k] = !!legacy[k];
    }
  } else if (Array.isArray(ev.doubts)) {
    // ش2: صيغة v1 محتملة — doubts مصفوفة معرّفات بطاقات مشكوك فيها (كل عنصر نصي/رقمي = علامة شك)
    for (const k of ev.doubts) {
      if ((typeof k === 'string' && k) || typeof k === 'number') {
        if (!(k in current)) current[k] = true;
      }
    }
  }
  ev.doubtMarks = current;
  delete ev.doubts; // تُحذف القديمة — مصدر وحيد للحقيقة
  return normalizeEvalShape(ev);
}

// إصلاح Q-1 (قرار المالك 12 أكتوبر 2026): التواريخ تُعرض بالتقويم الميلادي دومًا.
// 'ar-SA' وحدها تعرض التقويم الهجري (أم القرى) في Chrome/Safari — لذا يُحدَّد التقويم صراحةً. المسار الوحيد لعرض التواريخ.
const DATE_LOCALE = 'ar-SA-u-ca-gregory';
function formatDate(ts) {
  return new Date(ts).toLocaleDateString(DATE_LOCALE);
}

// إصلاح سيناريو §3-4/§3-9: حماية البنية — سجل مستورد أو محمَّل بحقول من نوع خاطئ (أو بلا categoryScores)
// كان يكسر التفاصيل والنص المُصدَّر والمقارنة (`.filter/.find is not a function`). تُصحَّح الأنواع فقط ولا تُغيَّر قيم صالحة.
// تُستدعى من normalizeDoubtMarks (التي يمرّ بها كل مسار تحميل/استيراد).
function normalizeEvalShape(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  // الاسم يجب أن يكون نصًا (`.trim()` يُستدعى عليه في المعالج والحفظ): رقم/منطقي → نص، وغيرهما → ''
  if (typeof ev.name !== 'string') ev.name = (typeof ev.name === 'number' || typeof ev.name === 'boolean') ? String(ev.name) : '';
  if (!isObj(ev.scores)) ev.scores = {};
  if (!isObj(ev.changeCounts)) ev.changeCounts = {};
  if (!Array.isArray(ev.tags)) ev.tags = [];
  else ev.tags = ev.tags.filter(t => typeof t === 'string');
  if (!Array.isArray(ev.categoryScores)) ev.categoryScores = [];
  else ev.categoryScores = ev.categoryScores.filter(c => c && typeof c === 'object');
  if (ev.weights !== undefined && ev.weights !== null && !isObj(ev.weights)) ev.weights = null;
  if (ev.totalScore !== undefined && ev.totalScore !== null && !Number.isFinite(ev.totalScore)) ev.totalScore = null;
  if (typeof ev.notes !== 'string') ev.notes = '';
  if (typeof ev.seriesWitness !== 'string') ev.seriesWitness = '';
  // v20 D-4: القيم غير المعروفة تُحفظ كما هي — لا تُستبدل بقيم افتراضية صامتة فيُحسب العمل
  // بأوزان لم يخترها المستخدم. العرض يمر بـlbl (B-13: «غير معروف»)، والحساب يُمنع من الإكمال
  // عبر hasKnownConfig في applyScoreChange/saveDraft/recalcImportedItem — لا نتيجة وهمية أبدًا.
  return ev;
}

// v20 D-4: هل التكوين كله معروف؟ (وسيط/صيغة/علاقة/طبيعة مشتقة) — قيم غير معروفة تمنع إكمال التقييم
function hasKnownConfig(ev) {
  if (!ev) return false;
  // v20 D-4: القيم المفقودة تُرفض أيضًا — التكوين الناقص (بلا وسيط/صيغة/علاقة) لا يكتمل أبدًا.
  // الطبيعة تُفحص فقط عند العلاقة المشتقة (نفس شرط hasKnownNature في system-data.js).
  const valid = (v, table) => (typeof v === 'string' && table && Object.prototype.hasOwnProperty.call(table, v));
  if (!valid(ev.medium, typeof MEDIA !== 'undefined' ? MEDIA : null)) return false;
  if (!valid(ev.format, typeof FORMATS !== 'undefined' ? FORMATS : null)) return false;
  if (!valid(ev.relation, typeof RELATIONS !== 'undefined' ? RELATIONS : null)) return false;
  if (ev.relation === 'derivative' && !valid(ev.nature, typeof NATURES !== 'undefined' ? NATURES : null)) return false;
  return true;
}

// إصلاح ط4: تنظيف المراجع المعلّقة — القوائم تفقد معرّفات الأعمال غير الموجودة، والمظلات تفقد الأجزاء التي تشير إليها.
// تُرشَّح العناصر (لا يُحذف الكيان نفسه). تُعيد true إن تغيّر شيء.
function pruneDanglingRefs() {
  const ids = new Set((state.library || []).map(e => e.id));
  let changedLists = false, changedUmbrellas = false;
  for (const l of (state.lists || [])) {
    if (!l || typeof l !== 'object') continue;
    const items = Array.isArray(l.items) ? l.items : [];
    const kept = items.filter(id => ids.has(id));
    if (!Array.isArray(l.items) || kept.length !== items.length) { l.items = kept; changedLists = true; }
  }
  for (const u of (state.umbrellas || [])) {
    if (!u || typeof u !== 'object') continue;
    const parts = Array.isArray(u.parts) ? u.parts : [];
    const kept = parts.filter(p => p && ids.has(p.evalId));
    if (!Array.isArray(u.parts) || kept.length !== parts.length) { u.parts = kept; changedUmbrellas = true; }
  }
  if (changedLists) saveLists();
  if (changedUmbrellas) saveUmbrellas();
  return changedLists || changedUmbrellas;
}

// إصلاح ط4: مسار حذف واحد لكل المواضع — يحذف العمل ثم ينظف القوائم والمظلات
function deleteWorkById(id) {
  state.library = state.library.filter(e => e.id !== id);
  saveLibrary();
  pruneDanglingRefs();
}

// إصلاح ط3: تطبيق الثيم المستورد (نفس ما يفعله toggleTheme لكن بقيمة محددة)
function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return false;
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', state.theme);
  if (_lsAvailable) { try { localStorage.setItem('eval_theme', state.theme); } catch (e) {} }
  syncThemeColor();
  return true;
}

// ============================================================
// إصلاح ط7: بصمة النظام والأوزان (آلية الهاش) — تكشف تغيّر system-data.js بعد حفظ التقييم
// ============================================================

// تسلسل ثابت الترتيب (مفاتيح الكائنات مرتّبة) — لا يتأثر بترتيب تعريف الحقول
function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// checksum بلا تبعيات: FNV-1a (32 بت) + sdbm (32 بت) مدمجان في 16 خانة سداسية
function checksum(obj) {
  const str = typeof obj === 'string' ? obj : stableStringify(obj);
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (c + (h2 << 6) + (h2 << 16) - h2) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// بصمة البطاقات: كل بطاقة بكل حقولها، بترتيب المصفوفة نفسه
function systemHash() {
  return checksum(CARDS);
}

// بصمة الأوزان: كل تكوين (وسيط × صيغة × علاقة) مع ناتج calculateWeights
function weightsHash() {
  const rows = [];
  for (const m of Object.keys(MEDIA)) for (const f of Object.keys(FORMATS)) for (const r of Object.keys(RELATIONS)) {
    rows.push([m, f, r, calculateWeights(m, f, r)]);
  }
  return checksum(rows);
}

// تُحسب مرة واحدة عند التحميل وتُحفظ في الذاكرة (state) — لا في localStorage
function initSystemHashes() {
  try { state.systemHash = systemHash(); } catch (e) { state.systemHash = null; }
  try { state.weightsHash = weightsHash(); } catch (e) { state.weightsHash = null; }
}

// قرار المالك المفوَّض (13 أكتوبر 2026، يعدّل نطاق ط7): تُختم البصمتان في كل موضع تُخزَّن فيه نتيجة/أوزان
// محسوبة على النظام الحالي (saveFinal وإعادة الحساب في مسار التعديل وsaveDraft المكتمل) — لا في saveFinal وحده —
// كي لا تبقى شارة «متأثر بتغيير النظام» على عمل أُعيد حسابه، ولا يكتمل عمل بلا ختم (A1-S1/S2).
function stampSystemHashes(ev) {
  if (!state.systemHash || !state.weightsHash) initSystemHashes();
  ev.systemHash = state.systemHash;
  ev.weightsHash = state.weightsHash;
}

// IMPORT-INNER-VALUES (الدفعة 2): حاويات التخزين المحمّلة تُفحص قبل الاستعمال. كان `init()` يستدعي `.map`
// مباشرة على القيمة المحمّلة فينهار الإقلاع كله (شاشة فارغة) إن لم تكن مصفوفة أو حوت عناصر null.
// الحاوية غير المصفوفة → []؛ العناصر غير الكائنية تُحذف؛ ولا تُلمس القيم الداخلية الصالحة نوعًا.
// (تنبيه: ما يُحذف هنا يُستبدل عند أول حفظ تالٍ — لا نسخة احتياطية للتالف؛ قرار مرفوع للمالك.)
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
// NO-RECOVERY-COPY (قرار مفوَّض 13 أكتوبر 2026): قبل أن يُستبدل الخام التالف عند أول حفظ، تُحفظ نسخة منه
// تحت `eval_corrupt_backup_<المفتاح>` (الأولى فقط — لا تُكتب فوق نسخة سابقة). لا تُقرأ في التطبيق؛ للاسترجاع اليدوي.
function backupCorruptRaw(key, raw) {
  const bk = 'eval_corrupt_backup_' + key;
  try {
    const exists = _lsAvailable ? localStorage.getItem(bk) !== null : (bk in _memStore);
    if (!exists) saveToStorage(bk, { savedAt: Date.now(), raw: String(raw) });
  } catch (e) {}
}
function readRawStorage(key) {
  try { return _lsAvailable ? localStorage.getItem(key) : (key in _memStore ? _memStore[key] : null); } catch (e) { return null; }
}
function loadObjectArray(key) {
  const raw = readRawStorage(key);
  const v = loadFromStorage(key, []);
  const arr = Array.isArray(v) ? v.filter(isPlainObject) : [];
  let parseFailed = false;
  if (raw !== null) { try { JSON.parse(raw); } catch (e) { parseFailed = true; } }
  if (raw !== null && raw !== 'null' && (parseFailed || !Array.isArray(v) || arr.length !== v.length)) backupCorruptRaw(key, raw);
  return arr;
}
// ID-ORPHAN (قرار مفوَّض): عمل بلا معرّف صالح أو بمعرّف مكرر يأخذ معرّفًا جديدًا (الأول من المكرَّرين يحتفظ بمعرّفه)؛
// وإلا لا يُفتح من التفاصيل ويحذف `deleteWorkById` كل المتطابقين معًا. تُعيد true إن تغيّر شيء.
function ensureUniqueIds(list) {
  const seen = new Set();
  let changed = false;
  for (const e of list) {
    const valid = (typeof e.id === 'string' && e.id) || (typeof e.id === 'number' && Number.isFinite(e.id));
    if (!valid || seen.has(e.id)) { e.id = generateUUID(); changed = true; }
    seen.add(e.id);
  }
  return changed;
}

function init() {
  state.library = loadObjectArray('eval_library_v2').map(normalizeDoubtMarks);
  if (ensureUniqueIds(state.library)) saveLibrary();
  const draft = loadFromStorage('eval_active_draft_v2', null);
  if (draft !== null && !isPlainObject(draft)) backupCorruptRaw('eval_active_draft_v2', readRawStorage('eval_active_draft_v2'));
  state.activeDraft = isPlainObject(draft) ? normalizeDoubtMarks(draft) : null;
  state.showGradeDescriptions = loadFromStorage('eval_show_grade_desc_v2', false);
  state.lists = loadObjectArray('eval_lists_v2');
  state.umbrellas = loadObjectArray('eval_umbrellas_v2');
  pruneDanglingRefs(); // إصلاح ط4: تنظيف مراجع معلّقة محفوظة من قبل
  initTheme();
  initSystemHashes(); // إصلاح ط7
  render();
  if (state.activeDraft && state.activeDraft.draftState === 'active') {
    showActiveDraftAlert();
  }
}

function initTheme() {
  try {
    state.theme = (_lsAvailable ? localStorage.getItem('eval_theme') : null) ||
      (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  } catch (e) {
    state.theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', state.theme);
  syncThemeColor();
}

// مزامنة لون شريط العنوان مع الوضع (جزء من فكرة 31 — تجربة تثبيت متسقة)
function syncThemeColor() {
  try {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', state.theme === 'dark' ? '#0E0817' : '#F8F5FD');
  } catch (e) {}
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  if (_lsAvailable) { try { localStorage.setItem('eval_theme', state.theme); } catch (e) {} }
  syncThemeColor();
  render();
}

function render() {
  const app = document.getElementById('app');
  const viewChanged = render._previousView != null && render._previousView !== state.view;
  render._previousView = state.view;
  app.innerHTML = '';
  switch (state.view) {
    case 'home': renderHome(app); break;
    case 'wizard': renderWizard(app); break;
    case 'evaluation': renderEvaluation(app); break;
    case 'details': renderDetails(app); break;
    case 'compare': renderCompare(app); break;      // الفكرة 12
    case 'stats': renderStats(app); break;          // الفكرة 17
    case 'lists': renderLists(app); break;          // الفكرة 15 (تحسين)
    case 'umbrellas': renderUmbrellas(app); break;  // الفكرة 29
  }
  // v30: opacity-only navigation feedback, never on each score/filter update.
  if (viewChanged && typeof app.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    app.animate([{ opacity: 0.94 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }
}

// ============================================================
// 5. الهيدر والصفحة الرئيسية
// ============================================================

function renderHeader(container, showBack) {
  const header = document.createElement('div');
  header.className = 'app-header';
  if (showBack) {
    const back = document.createElement('button');
    back.className = 'eval-back';
    back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:scaleX(-1)"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    back.onclick = () => goHome();
    header.appendChild(back);
  } else {
    const logo = document.createElement('div');
    logo.className = 'logo';
    logo.innerHTML = '<svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true" style="color:var(--color-primary)"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="6"/><g fill="currentColor"><rect x="28" y="49" width="12" height="23" rx="3"/><rect x="44" y="30" width="12" height="42" rx="3"/><rect x="60" y="40" width="12" height="32" rx="3"/></g></svg><span>راجع اعمالك</span>';
    header.appendChild(logo);
  }

  const themeBtn = document.createElement('button');
  themeBtn.className = 'theme-toggle';
  themeBtn.innerHTML = state.theme === 'dark'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  themeBtn.onclick = toggleTheme;
  themeBtn.setAttribute('aria-label', 'تبديل الثيم');
  header.appendChild(themeBtn);
  container.appendChild(header);
}

function renderHome(container) {
  renderHeader(container, false);

  // أزرار الإجراء
  const actions = document.createElement('div');
  actions.className = 'home-actions';

  const newBtn = document.createElement('button');
  newBtn.className = 'btn btn-primary';
  newBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> تقييم جديد';
  newBtn.onclick = () => startNewEvaluation();
  actions.appendChild(newBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'btn btn-secondary';
  settingsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4M12 3v2M12 19v2"/><circle cx="12" cy="12" r="3"/></svg> الإعدادات';
  settingsBtn.onclick = showSettings;
  actions.appendChild(settingsBtn);

  container.appendChild(actions);

  // شريط تنقل ثانوي للأدوات (مقارنة، إحصائيات، قوائم، مظلات)
  const tools = document.createElement('div');
  tools.className = 'home-actions home-tools';
  const toolDefs = [
    ['compare', 'مقارنة عملين', 'M8 3v18M16 3v18M3 8h18M3 16h18'],
    ['stats', 'إحصائيات', 'M3 21h18M7 17V9M12 17V5M17 17v-6'],
    ['lists', 'القوائم', 'M4 6h16M4 12h16M4 18h10'],
    ['umbrellas', 'المظلات', 'M6 14a6 6 0 0 1 12 0M12 14v7'],
  ];
  for (const [view, label, path] of toolDefs) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.flex = '1';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${path}"/></svg> ${label}`;
    btn.onclick = () => { state.view = view; render(); };
    tools.appendChild(btn);
  }
  container.appendChild(tools);

  // الفلترة
  const filters = document.createElement('div');
  filters.className = 'filters';

  const mediumSelect = document.createElement('select');
  mediumSelect.className = 'filter-select';
  mediumSelect.innerHTML = '<option value="all">كل الوسائط</option>' +
    Object.entries(MEDIA).map(([k,v]) => `<option value="${k}" ${state.filters.medium===k?'selected':''}>${v}</option>`).join('');
  mediumSelect.onchange = (e) => { state.filters.medium = e.target.value; render(); };
  filters.appendChild(mediumSelect);

  const formatSelect = document.createElement('select');
  formatSelect.className = 'filter-select';
  formatSelect.innerHTML = '<option value="all">كل الصيغ</option>' +
    Object.entries(FORMATS).map(([k,v]) => `<option value="${k}" ${state.filters.format===k?'selected':''}>${v}</option>`).join('');
  formatSelect.onchange = (e) => { state.filters.format = e.target.value; render(); };
  filters.appendChild(formatSelect);

  // ترتيب: درجة أو تاريخ (الفكرة 28)
  const sortSelect = document.createElement('select');
  sortSelect.className = 'filter-select';
  sortSelect.innerHTML = `
    <option value="desc" ${state.filters.sort==='desc'?'selected':''}>ترتيب: الأعلى درجة</option>
    <option value="asc" ${state.filters.sort==='asc'?'selected':''}>ترتيب: الأقل درجة</option>
    <option value="recent" ${state.filters.sort==='recent'?'selected':''}>ترتيب: الأحدث تقييمًا</option>
    <option value="watch" ${state.filters.sort==='watch'?'selected':''}>ترتيب: تاريخ المشاهدة</option>
  `;
  sortSelect.onchange = (e) => { state.filters.sort = e.target.value; render(); };
  filters.appendChild(sortSelect);

  // فلترة الوسم (الفكرة 15)
  const tagInput = document.createElement('input');
  tagInput.className = 'filter-select';
  tagInput.type = 'text';
  tagInput.placeholder = 'فلترة بالوسم';
  tagInput.value = state.filters.tag;
  tagInput.id = 'filter-tag-input';
  tagInput.oninput = (e) => {
    state.filters.tag = e.target.value;
    const pos = e.target.selectionStart;
    render();
    // v18 B-03: render() يعيد بناء الحقل — نستعيد التركيز وموضع المؤشر
    const again = document.getElementById('filter-tag-input');
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) {} }
  };
  filters.appendChild(tagInput);

  container.appendChild(filters);

  // المكتبة
  const filtered = getFilteredLibrary();
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = `المكتبة (${filtered.length})`;
  container.appendChild(title);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><p>لا توجد أعمال مطابقة. ابدأ بتقييم عمل جديد.</p>';
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'library-list';
    for (const item of filtered) list.appendChild(renderCard(item));
    container.appendChild(list);
  }
}

function getFilteredLibrary() {
  let items = state.library.filter(ev => {
    if (state.filters.medium !== 'all' && ev.medium !== state.filters.medium) return false;
    if (state.filters.format !== 'all' && ev.format !== state.filters.format) return false;
    if (state.filters.tag && state.filters.tag.trim()) {
      const t = state.filters.tag.trim();
      const hasTag = (ev.tags || []).some(x => x.includes(t));
      if (!hasTag) return false;
    }
    return true;
  });

  const completed = items.filter(e => e.status === 'completed');
  const drafts = items.filter(e => e.status !== 'completed');

  const sorters = {
    desc: (a,b) => (b.totalScore||0) - (a.totalScore||0) || (b.updatedAt||0) - (a.updatedAt||0),
    asc: (a,b) => (a.totalScore||0) - (b.totalScore||0) || (a.updatedAt||0) - (b.updatedAt||0),
    recent: (a,b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0),
    watch: (a,b) => String(b.watchDate || '').localeCompare(String(a.watchDate || '')),  // v18 B-02
  };
  completed.sort(sorters[state.filters.sort] || sorters.desc);
  return [...completed, ...drafts];
}

// إصلاح م4: توزيع الدرجات — بطاقات التكوين الحالي فقط (لا بطاقات لا تنطبق).
// يُرجع مصفوفة من 5 خانات: الفهرس = قيمة الدرجة (0..4).
function getScoreDistribution(ev) {
  const dist = [0, 0, 0, 0, 0];
  if (!ev) return dist;
  const cfg = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };
  const live = new Set();
  for (const { cards } of getApplicableCards(cfg)) for (const c of cards) live.add(c.id);
  for (const k in (ev.scores || {})) {
    if (!live.has(k)) continue;
    const s = ev.scores[k];
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= 4) dist[s]++;
  }
  return dist;
}

// «التوزيع: ممتاز 12 · جيد 9 · عادي 5 · سيء 2 · ضعيف 0» (من الأعلى للأدنى حسب SCORE_LEVELS)
function scoreDistributionText(ev) {
  const dist = getScoreDistribution(ev);
  return 'التوزيع: ' + SCORE_LEVELS.map(l => `${l.name} ${dist[l.value]}`).join(' · ');
}

function renderScoreDistribution(ev) {
  const el = document.createElement('div');
  el.className = 'score-distribution';
  el.textContent = scoreDistributionText(ev);
  return el;
}

// كرت العمل في المكتبة (الفكرة 33: نفس شكل بطاقات التقييم)
function renderCard(ev) {
  // التصميم المعتمد (الفكرة 33): خمس مناطق ثابتة — الاسم والنتيجة أولًا، ثم بيانات العمل،
  // منطقة العلامات الموحدة (تنبيهات + سياق + وسوم)، درجات الفئات، ثم التاريخين في التذييل.
  const card = document.createElement('div');
  card.className = 'card';
  card.onclick = () => openDetails(ev.id);
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(ev.id); }
  };

  // 1) الاسم والنتيجة النهائية — رأس الكرت
  const head = document.createElement('div');
  head.className = 'card-head';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = ev.name;
  head.appendChild(name);
  if (ev.status === 'completed' && ev.totalScore != null) {
    const final = document.createElement('div');
    final.className = 'card-final';
    final.innerHTML = `<span class="label">النتيجة</span><span class="value">${formatNumber(ev.totalScore)} / 10</span>`;
    head.appendChild(final);
  }
  card.appendChild(head);

  // 2) بيانات العمل (الوسيط، الصيغة، العلاقة) — سطر ثانوي هادئ
  const path = document.createElement('div');
  path.className = 'card-path';
  path.textContent = [lbl(MEDIA, ev.medium), lbl(FORMATS, ev.format), ev.relation === 'derivative' ? ('تابع' + (ev.nature ? ' (' + lbl(NATURES, ev.nature) + ')' : '')) : 'مستقل'].join(' · ');
  card.appendChild(path);

  // 3) منطقة العلامات الموحدة — تنبيهات النظام أولًا، ثم سياق التقييم، ثم الوسوم
  const badges = document.createElement('div');
  badges.className = 'card-badges';
  const chips = [];
  // تنبيهات النظام (لون تحذيري)
  if (ev.status !== 'completed') chips.push('<span class="chip chip-warn">غير مكتمل</span>');
  // إصلاح ط7: تُعرض الشارتان فقط إن حُفظت بصمة مع العمل وخالفت الحالية (عمل قديم بلا بصمة → لا شارة)
  if (ev.systemHash && state.systemHash && ev.systemHash !== state.systemHash) chips.push('<span class="chip chip-warn">متأثر بتغيير النظام</span>');
  if (ev.weightsHash && state.weightsHash && ev.weightsHash !== state.weightsHash) chips.push('<span class="chip chip-warn">الأوزان تغيّرت</span>');
  // سياق التقييم: النمط ثم عدّاد الشك (الفكرة 32 — يظهر الصفر دائمًا)
  if (ev.mode === 'quick') chips.push('<span class="chip quick">تقييم سريع</span>');
  else if (ev.mode === 'detailed') chips.push('<span class="chip">تقييم تفصيلي</span>');
  const doubtCount = countDoubt(ev);
  chips.push(`<span class="chip">مشكوك فيه: ${doubtCount}</span>`);
  // الوسوم المخصصة
  for (const t of (ev.tags || [])) chips.push(`<span class="chip tag">${escapeHtml(t)}</span>`);
  badges.innerHTML = chips.join('');
  card.appendChild(badges);

  // 4) درجات الفئات — صفوف مدمجة بمحاذاة ثابتة
  if (ev.status === 'completed' && ev.totalScore != null) {
    const scoresDiv = document.createElement('div');
    scoresDiv.className = 'card-scores';
    for (const cs of (ev.categoryScores || [])) {
      const row = document.createElement('div');
      row.className = 'card-score-row';
      row.innerHTML = `<span>${escapeHtml(cs.name)}</span><span class="score-val">${formatNumber(cs.points)}</span>`;
      scoresDiv.appendChild(row);
    }
    card.appendChild(scoresDiv);
  }
  // إصلاح م4: توزيع الدرجات في كرت العمل (المسودة: فقط إن وُجدت درجة واحدة على الأقل)
  if (ev.status === 'completed' || getScoreDistribution(ev).some(n => n > 0)) {
    card.appendChild(renderScoreDistribution(ev));
  }

  // 5) التاريخان — تذييل هادئ بعناوين صريحة (الفكرة 28)
  if (ev.watchDate || ev.completedAt) {
    const dates = document.createElement('div');
    dates.className = 'card-dates';
    const parts = [];
    if (ev.watchDate) parts.push(`المشاهدة: ${ev.watchDate}`);
    if (ev.completedAt) parts.push(`التقييم: ${formatDate(ev.completedAt)}`);
    dates.textContent = parts.join(' · ');
    card.appendChild(dates);
  }

  return card;
}

// عدّاد المعايير المشكوك فيها (الفكرة 32) — يقرأ ev.doubtMarks الفعلي (يُحفظ في شاشة التقييم)
function countDoubt(ev) {
  const marks = (ev && ev.doubtMarks) ? ev.doubtMarks : null;
  if (!marks) return 0;
  let n = 0;
  for (const k in marks) if (marks[k]) n++;
  return n;
}

// ============================================================
// 6. المعالج (Wizard)
// ============================================================

// الفكرة 18 (المعاينة الحية داخل المعالج): معطّلة بقرار المالك D-1 (12 أكتوبر 2026) — لا تُطوَّر لتصبح نهائية.
// الكود أدناه باقٍ كما هو (غير محذوف) ويُعاد تفعيله بتغيير هذا العلَم إلى true؛ وما دامت معطّلة لا يظهر شيء منها في المعالج.
const LIVE_PREVIEW_ENABLED = false;

function renderWizard(container) {
  renderHeader(container, true);

  const wizard = document.createElement('div');
  wizard.className = 'wizard';
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = state.editingId ? 'تعديل التكوين' : 'تقييم جديد';
  wizard.appendChild(title);

  // 1. اسم العمل
  const nameField = document.createElement('div');
  nameField.className = 'wizard-field';
  nameField.innerHTML = '<label class="wizard-label">اسم العمل</label>';
  const nameInput = document.createElement('input');
  nameInput.className = 'wizard-input';
  nameInput.type = 'text';
  nameInput.placeholder = 'اكتب اسم العمل...';
  nameInput.value = state.wizardData.name;
  nameInput.oninput = (e) => { state.wizardData.name = e.target.value; updateWizardButton(); };
  nameField.appendChild(nameInput);
  wizard.appendChild(nameField);

  // 2. تاريخ المشاهدة (الفكرة 28)
  const dateField = document.createElement('div');
  dateField.className = 'wizard-field';
  dateField.innerHTML = '<label class="wizard-label">تاريخ المشاهدة (اختياري)</label>';
  const dateInput = document.createElement('input');
  dateInput.className = 'wizard-input';
  dateInput.type = 'date';
  dateInput.value = state.wizardData.watchDate;
  dateInput.oninput = (e) => { state.wizardData.watchDate = e.target.value; };
  dateField.appendChild(dateInput);
  wizard.appendChild(dateField);

  // 3. الوسيط
  wizard.appendChild(renderWizardOptions('الوسيط', MEDIA, state.wizardData.medium, (val) => {
    state.wizardData.medium = val; render();
  }));

  // 4. الصيغة
  if (state.wizardData.medium) {
    wizard.appendChild(renderWizardOptions('الصيغة', FORMATS, state.wizardData.format, (val) => {
      state.wizardData.format = val; render();
    }));
  }

  // 5. العلاقة بالمصدر
  if (state.wizardData.format) {
    wizard.appendChild(renderWizardOptions('العلاقة بالمصدر', RELATIONS, state.wizardData.relation, (val) => {
      state.wizardData.relation = val;
      if (val !== 'derivative') state.wizardData.nature = null;
      render();
    }));
  }

  // 6. طبيعة العمل (عند التبعية)
  if (state.wizardData.relation === 'derivative') {
    wizard.appendChild(renderWizardOptions('طبيعة العمل', NATURES, state.wizardData.nature, (val) => {
      state.wizardData.nature = val; render();
    }));
  }

  // 7. نمط التقييم (الفكرة 25 بصيغة معدلة)
  if (state.wizardData.relation) {
    const modeField = document.createElement('div');
    modeField.className = 'wizard-field';
    modeField.innerHTML = '<label class="wizard-label">نمط التقييم</label>';
    const opts = document.createElement('div');
    opts.className = 'wizard-options';
    opts.style.flexDirection = 'row';
    for (const [val, label] of [['detailed', 'تفصيلي'], ['quick', 'سريع']]) {
      const b = document.createElement('button');
      b.className = 'wizard-option' + (state.wizardData.mode === val ? ' selected' : '');
      b.style.flex = '1';
      b.textContent = label;
      b.onclick = () => { state.wizardData.mode = val; render(); };
      opts.appendChild(b);
    }
    modeField.appendChild(opts);
    wizard.appendChild(modeField);
  }

  // 8. وسوم (الفكرة 15)
  if (state.wizardData.relation) {
    const tagsField = document.createElement('div');
    tagsField.className = 'wizard-field';
    tagsField.innerHTML = '<label class="wizard-label">وسوم (اختياري — مفصولة بفواصل)</label>';
    const tagsInput = document.createElement('input');
    tagsInput.className = 'wizard-input';
    tagsInput.type = 'text';
    tagsInput.placeholder = 'مثال: مفضلة, أعيدت مشاهدته';
    tagsInput.value = (state.wizardData.tags || []).join(', ');
    tagsInput.oninput = (e) => {
      state.wizardData.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    };
    tagsField.appendChild(tagsInput);
    wizard.appendChild(tagsField);
  }

  // زر البدء
  const actions = document.createElement('div');
  actions.className = 'wizard-actions';
  const startBtn = document.createElement('button');
  startBtn.className = 'btn btn-primary btn-full';
  startBtn.id = 'wizard-start';
  startBtn.textContent = 'ابدأ التقييم';
  startBtn.disabled = !wizardCanStart();
  startBtn.onclick = () => startEvaluation();
  actions.appendChild(startBtn);
  wizard.appendChild(actions);

  // ============================================================
  // معاينة حية للبطاقة كما ستظهر عند التقييم (الفكرة 18)
  // تُعرض فقط عند اكتمال التكوين — بطاقة نموذجية من كل فئة تنطبق.
  // ============================================================
  if (LIVE_PREVIEW_ENABLED && wizardCanStart()) {
    const previewSection = document.createElement('div');
    previewSection.className = 'wizard-field';
    previewSection.style.marginTop = 'var(--space-6)';
    previewSection.innerHTML = `<label class="wizard-label">معاينة حية — شكل البطاقة كما ستظهر عند التقييم</label>
      <p style="font-size:var(--text-xs);color:var(--color-text-faint);margin-bottom:var(--space-3)">
        بطاقة نموذجية من التكوين المحدد. تُعرض بنفس شكل شاشة التقييم: السؤال، أزرار الدرجات،
        جدول الدرجات، والطبقات التفصيلية. تُحدّث المعاينة تلقائيًا عند تغيير التكوين.
      </p>`;

    const config = {
      medium: state.wizardData.medium,
      format: state.wizardData.format,
      relation: state.wizardData.relation,
      nature: state.wizardData.nature,
    };
    const cats = getApplicableCards(config);
    // بطاقة نموذجية واحدة من كل فئة تنطبق — نُظهر أول فئة فقط لتفادي التطويل
    if (cats.length > 0) {
      const firstCat = cats[0];
      const sampleCard = firstCat.cards[0];
      // بناء حاوية زائفة تحاكي شاشة التقييم
      const holder = document.createElement('div');
      holder.className = 'wizard-preview-holder';
      const dummyEv = {
        id: '_preview_',
        name: state.wizardData.name || 'معاينة',
        scores: {},
        changeCounts: {},
        doubtMarks: {},
        seriesWitness: '',
        notes: '',
      };
      // استدعاء دوال الرسم الحقيقية — نفس شكل شاشة التقييم
      try {
        const rendered = renderCardCriterion(sampleCard, dummyEv, config);
        rendered.style.pointerEvents = 'none'; // المعاينة غير تفاعلية — للعرض فقط
        holder.appendChild(rendered);
      } catch (e) {
        // لا تُعطّل المعالج إن فشلت المعاينة
        const fallback = document.createElement('div');
        fallback.className = 'nature-condition';
        fallback.textContent = 'المعاينة الحية غير متاحة حاليًا.';
        holder.appendChild(fallback);
      }
      previewSection.appendChild(holder);
    } else {
      const none = document.createElement('div');
      none.className = 'nature-condition';
      none.textContent = 'لا تنطبق بطاقات على هذا التكوين — عدّل التكوين أعلاه.';
      previewSection.appendChild(none);
    }

    wizard.appendChild(previewSection);
  }

  container.appendChild(wizard);
}

function renderWizardOptions(label, options, selected, onSelect) {
  const fieldDiv = document.createElement('div');
  fieldDiv.className = 'wizard-field';
  fieldDiv.innerHTML = `<label class="wizard-label">${label}</label>`;
  const opts = document.createElement('div');
  opts.className = 'wizard-options';
  for (const [key, val] of Object.entries(options)) {
    const btn = document.createElement('button');
    btn.className = 'wizard-option' + (selected === key ? ' selected' : '');
    btn.textContent = val;
    btn.onclick = () => onSelect(key);
    opts.appendChild(btn);
  }
  fieldDiv.appendChild(opts);
  return fieldDiv;
}

function wizardCanStart() {
  const d = state.wizardData;
  if (!d.name || !d.name.trim()) return false;
  if (!d.medium) return false;
  if (!d.format) return false;
  if (!d.relation) return false;
  if (d.relation === 'derivative' && !d.nature) return false;
  return true;
}

function updateWizardButton() {
  const btn = document.getElementById('wizard-start');
  if (btn) btn.disabled = !wizardCanStart();
}

function startNewEvaluation() {
  if (state.activeDraft && state.activeDraft.draftState === 'active') {
    showActiveDraftAlert();
    return;
  }
  state.editingId = null;
  state.wizardData = { name: '', medium: null, format: null, relation: null, nature: null, mode: 'detailed', watchDate: '', tags: [] };
  state.view = 'wizard';
  render();
  window.scrollTo(0, 0);
}

function startEvaluation() {
  const d = state.wizardData;
  const config = { medium: d.medium, format: d.format, relation: d.relation, nature: d.nature };

  if (state.editingId) {
    const ev = state.library.find(e => e.id === state.editingId);
    if (ev) {
      // إصلاح م1: التحقق من الاسم قبل كتابة المكتبة
      const nameErr = invalidNameError(d.name, state.editingId);
      if (nameErr) { showToast(nameErr); return; }
      Object.assign(ev, {
        name: d.name.trim(),
        medium: d.medium,
        format: d.format,
        relation: d.relation,
        nature: d.nature,
        mode: d.mode,
        watchDate: d.watchDate,
        tags: d.tags.slice(),
      });
      applyScoreChange(ev, config);
      saveLibrary();
      state.current = ev;
      state.expandedCards.clear();
      state.view = 'evaluation';
      render();
    }
    return;
  }

  const id = generateUUID();
  const ev = {
    id,
    name: d.name.trim(),
    medium: d.medium,
    format: d.format,
    relation: d.relation,
    nature: d.nature,
    mode: d.mode || 'detailed',
    watchDate: d.watchDate || '',
    tags: (d.tags || []).slice(),
    scores: {},
    changeCounts: {},   // الفكرة 9: عدد مرات تغيير درجة كل معيار
    doubtMarks: {},     // الفكرة 32: علامة الشك على المعيار (بُني على شكل كائن قيمة-منطقية: {id: true})
    seriesWitness: '',  // إدخال واحد مشترك — شاهد التمييز للسلسلة (التحديث 16: لا يُسجّل في بطاقتين)
    notes: '',
    status: 'draft',
    draftState: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };
  state.current = ev;
  state.activeDraft = ev;
  saveToStorage('eval_active_draft_v2', ev);
  state.view = 'evaluation';
  state.expandedCards.clear();
  render();
}

// إصلاح ح2 + م1 (التقرير): تنظيف الدرجات الفائضة وعلامات الشك وعدادات التغيير وشاهد السلسلة
// وفق التكوين الجديد عند أي إعادة حساب، لا في الحفظ النهائي فقط.
// تنظيف مساعد: يُستدعى في applyScoreChange وsaveDraft وsaveFinal.
function pruneNonApplicable(ev, config) {
  // v20 D-4: عند تكوين غير معروف/ناقص لا يُحذف أي شيء من مدخلات المستخدم (scores/doubtMarks/changeCounts) —
  // كانت getApplicableCards تُرجع قائمة فارغة فيُحذف كل شيء. التقليم يحدث فقط عند تكوين معروف.
  if (!hasKnownConfig(config)) return;
  const liveCards = new Set();
  for (const { cards } of getApplicableCards(config)) for (const c of cards) liveCards.add(c.id);
  for (const key of Object.keys(ev.scores || {})) if (!liveCards.has(key)) delete ev.scores[key];
  for (const key of Object.keys(ev.doubtMarks || {})) if (!liveCards.has(key)) delete ev.doubtMarks[key];
  for (const key of Object.keys(ev.changeCounts || {})) if (!liveCards.has(key)) delete ev.changeCounts[key];
  if (config.format !== 'film_series') ev.seriesWitness = '';
}

// إصلاح م1 (التقرير): فحص موحّد لصلاحية الاسم — فارغ أو مكرر يُرفض.
// يُستعمل في كل مسار الحفظ (المعالج، شاشة التقييم، الحفظ النهائي، المسودة).
// يُرجع رسالة الخطأ أو null إن كان الاسم صالحًا.
// v19 B-13: قيم تعداد غير معروفة (مستوردة) تُعرض «غير معروف» بدل undefined
function lbl(map, key) { return (map && Object.prototype.hasOwnProperty.call(map, key) && map[key]) || 'غير معروف'; }

function invalidNameError(name, exceptId) {
  const t = (name || '').trim();
  if (!t) return 'اكتب اسم العمل أولاً';
  const dup = state.library.find(e => e.id !== exceptId && e.name.trim() === t);
  if (dup) return 'اسم العمل مكرر';
  return null;
}

function applyScoreChange(ev, config) {
  // إصلاح ح2: التنظيف يحدث هنا أيضًا — لا يبقى فائض درجات/شك/عدادات بعد تغيير التكوين
  pruneNonApplicable(ev, config);
  // v20 D-4: تكوين غير معروف لا يكتمل أبدًا — لا تُحسب نتيجة بأوزان افتراضية لم يخترها المستخدم
  const result = hasKnownConfig(ev) ? calculateScore(config, ev.scores) : { allScored: false, totalScore: null, weights: null, categoryScores: [] };
  if (result.allScored) {
    ev.status = 'completed';
    ev.totalScore = result.totalScore;
    ev.weights = result.weights;
    ev.categoryScores = result.categoryScores.map(cs => ({ categoryId: cs.categoryId, name: cs.name, points: cs.points }));
    ev.completedAt = ev.completedAt || Date.now();
    stampSystemHashes(ev);
  } else {
    // v20 B-07 (أ): توحيد تصفير حقول المسودة مع saveDraft — لا تبقى completedAt/categoryScores/weights/systemHash
    // من عمل مكتمل سابق بعد تحوّله لمسودة بتغيير التكوين (كان يعرض «غير مكتمل» مع تاريخ تقييم وهمي).
    ev.status = 'draft';
    ev.totalScore = null;
    ev.weights = null;
    ev.categoryScores = null;
    ev.completedAt = null;
    delete ev.systemHash;
    delete ev.weightsHash;
  }
  ev.updatedAt = Date.now();
}

// ============================================================
// 7. شاشة التقييم — بطاقات دائمة الانفتاح (الفكرة 37)
// ============================================================

function renderEvaluation(container) {
  if (!state.current) { goHome(); return; }
  const ev = state.current;
  const config = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };

  renderHeader(container, true);

  // العنوان
  const header = document.createElement('div');
  header.className = 'eval-header';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'eval-title';

  const nameInput = document.createElement('input');
  nameInput.className = 'wizard-input';
  nameInput.type = 'text';
  nameInput.value = ev.name;
  nameInput.style.flex = '1';
  nameInput.style.fontWeight = '600';
  nameInput.style.fontSize = 'var(--text-lg)';
  nameInput.style.fontFamily = 'var(--font-display)';
  // إصلاح م1 (تكميل): الاسم يُفحص قبل كتابته على الكائن المشترك — لا يُدخل اسم مكرر/فارغ في المكتبة
  nameInput.oninput = (e) => {
    const proposed = e.target.value;
    const err = invalidNameError(proposed, ev.id);
    if (err) {
      nameInput.style.borderColor = 'var(--color-error)';
      nameInput.title = err;
      return; // لا يُكتب الاسم غير الصالح في ev — الكائن المشترك مع المكتبة يبقى بالاسم الصالح
    }
    nameInput.style.borderColor = '';
    nameInput.title = '';
    ev.name = proposed;
    autoSaveCurrent();
  };
  titleDiv.appendChild(nameInput);

  const configLine = document.createElement('div');
  configLine.className = 'config';
  configLine.textContent = `${lbl(MEDIA, ev.medium)} — ${lbl(FORMATS, ev.format)} — ${lbl(RELATIONS, ev.relation)}${ev.nature ? ' (' + lbl(NATURES, ev.nature) + ')' : ''}${ev.mode === 'quick' ? ' — تقييم سريع' : ''}`;
  titleDiv.appendChild(configLine);

  header.appendChild(titleDiv);
  container.appendChild(header);

  // شريط التقدم (الفقرة 1/5 المعتمدة)
  const catsWithCards = getApplicableCards(config);
  const result = calculateScore(config, ev.scores || {});

  let totalCards = 0, scoredCount = 0;
  for (const { cards } of catsWithCards) {
    for (const c of cards) {
      totalCards++;
      if (ev.scores && ev.scores[c.id] != null) scoredCount++;
    }
  }

  const progress = document.createElement('div');
  progress.className = 'eval-progress';

  let progressHTML = `
    <div class="eval-progress-text">${scoredCount} من ${totalCards} معيارًا</div>
    <div class="eval-progress-bar"><div class="eval-progress-fill" style="width:${totalCards ? (scoredCount/totalCards*100) : 0}%"></div></div>
  `;

  // نتائج الفئات المكتملة (الفكرة 3 بصيغة معدلة)
  let completedHTML = '';
  for (const cs of result.categoryScores) {
    if (cs.allScored && cs.scoredCount > 0) {
      completedHTML += `<div class="eval-category-score-line"><span>${escapeHtml(cs.name)}</span><span class="score-val">${formatNumber(cs.points)}</span></div>`;
    }
  }
  if (completedHTML) progressHTML += `<div class="eval-category-scores">${completedHTML}</div>`;

  if (result.allScored) {
    progressHTML += `<div class="eval-score-display"><span class="score">${formatNumber(result.totalScore)}</span><span class="max">/ 10</span></div>`;
  }
  progress.innerHTML = progressHTML;
  container.appendChild(progress);

  // زر «انتقل للمعيار غير المقيّم» (الفكرة 2)
  if (scoredCount < totalCards) {
    const jump = document.createElement('button');
    jump.className = 'btn btn-secondary btn-full';
    jump.style.marginBottom = 'var(--space-4)';
    jump.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg> انتقل للمعيار غير المقيّم';
    jump.onclick = () => {
      for (const { cards } of catsWithCards) {
        for (const c of cards) {
          const s = ev.scores ? ev.scores[c.id] : undefined;
          if (s === undefined || s === null) {
            const el = document.querySelector(`[data-card-id="${c.id}"]`);
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
            return;
          }
        }
      }
      showToast('كل المعايير مقيّمة');
    };
    container.appendChild(jump);
  }

  // البطاقات مجمعة حسب الفئة
  // v20 D-4: عند تكوين غير معروف لا أوزان ولا فئات — تُعرض رسالة توضيحية بدل الانهيار
  if (!result.weights) {
    const warn = document.createElement('div');
    warn.className = 'eval-progress';
    warn.innerHTML = '<span>التكوين غير معروف (وسيط/صيغة/علاقة) — لا يمكن تقييم هذا العمل حتى يُصحّح.</span>';
    container.appendChild(warn);
    return container;
  }
  for (const { category, cards } of catsWithCards) {
    const weight = result.weights[category.id];
    const cs = result.categoryScores.find(s => s.categoryId === category.id);

    const catDiv = document.createElement('div');
    catDiv.className = 'eval-category';

    let scoreLabel = '';
    if (cs && cs.allScored) scoreLabel = ` — ${formatNumber(cs.points)} نقطة`;

    catDiv.innerHTML = `
      <div class="eval-category-header">
        <span class="eval-category-name">${escapeHtml(category.name)}${scoreLabel}</span>
        <span class="eval-category-weight">${formatPercent(weight)}</span>
      </div>
    `;
    const list = document.createElement('div');
    list.className = 'eval-criteria-list';
    for (const card of cards) list.appendChild(renderCardCriterion(card, ev, config));
    catDiv.appendChild(list);
    container.appendChild(catDiv);
  }

  // شاهد التمييز — إدخال واحد مشترك للسلسلة (القرار المعلق الثاني — التحديث 16)
  if (ev.format === 'film_series') {
    const witnessSection = document.createElement('div');
    witnessSection.className = 'eval-notes';
    witnessSection.style.marginTop = 'var(--space-4)';
    witnessSection.innerHTML = `
      <label class="wizard-label">شاهد التمييز للسلسلة</label>
      <p style="font-size:var(--text-xs);color:var(--color-text-faint);margin-bottom:var(--space-2)">
        إدخال واحد مشترك — يُسجّل مرة واحدة في البطاقة التي يصف سؤالها طبيعة الخلل الأصلية، ولا يُكرّر في بطاقتين.
      </p>
    `;
    const wArea = document.createElement('textarea');
    wArea.className = 'details-notes';
    wArea.placeholder = 'اكتب الشاهد المحدد الذي يبيّن ما يتميز وكيف يظهر أثره...';
    wArea.value = ev.seriesWitness || '';
    wArea.onblur = (e) => { ev.seriesWitness = e.target.value; autoSaveCurrent(); };
    witnessSection.appendChild(wArea);
    container.appendChild(witnessSection);
  }

  // الملاحظات
  const notesDiv = document.createElement('div');
  notesDiv.className = 'eval-notes';
  notesDiv.innerHTML = '<label class="wizard-label">ملاحظات</label>';
  const notesArea = document.createElement('textarea');
  notesArea.className = 'details-notes';
  notesArea.placeholder = 'اكتب ملاحظاتك عن العمل...';
  notesArea.value = ev.notes || '';
  notesArea.onblur = (e) => { ev.notes = e.target.value; autoSaveCurrent(); };
  notesDiv.appendChild(notesArea);
  container.appendChild(notesDiv);

  // الأزرار
  const actions = document.createElement('div');
  actions.className = 'eval-actions';

  if (result.allScored) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-full';
    saveBtn.textContent = 'حفظ التقييم';
    saveBtn.onclick = () => saveFinal();
    actions.appendChild(saveBtn);
  }

  const draftBtn = document.createElement('button');
  draftBtn.className = 'btn btn-secondary btn-full';
  draftBtn.textContent = 'حفظ كمسودة';
  draftBtn.onclick = () => saveDraft();
  actions.appendChild(draftBtn);

  if (ev.draftState === 'active' || state.editingId) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-full';
    delBtn.textContent = 'حذف';
    delBtn.onclick = () => {
      showConfirm('حذف', 'هل أنت متأكد من الحذف؟ لا يمكن التراجع.', () => {
        if (state.editingId) {
          deleteWorkById(state.editingId);
        } else {
          state.activeDraft = null;
          if (_lsAvailable) { try { localStorage.removeItem('eval_active_draft_v2'); } catch(e) {} }
          delete _memStore['eval_active_draft_v2'];
        }
        state.current = null;
        goHome();
      });
    };
    actions.appendChild(delBtn);
  }

  container.appendChild(actions);

  // إصلاح الحشوة السفلية في الجوال (الفكرة 5)
  container.style.paddingBottom = 'var(--space-16)';
}

// --- بطاقة المعيار — التصميم 37 المعتمد ---
//  • البطاقات مفتوحة دائمًا.
//  • طبقة أساسية ظاهرة: الاسم + السؤال + شرط الدرجات.
//  • طبقتان خلف «رؤية المزيد»: (يدخل فيه / لا يدخل فيه / التمييز + المثال)، (جدول الدرجات + الملاحظة).
//  • أزرار الدرجة في ذيل البطاقة، دائمة الظهور (الفكرة 7).
//  • علامة الشك (الفكرة 32) وعدّاد التغييرات (الفكرة 9).
//  • (نُقل عدّاد توزيع الدرجات إلى كرت العمل والتفاصيل — إصلاح م4)

function renderCardCriterion(card, ev, config) {
  const div = document.createElement('div');
  div.className = 'eval-criterion';
  div.dataset.cardId = card.id;
  div.classList.add('open');  // البطاقات مفتوحة دائمًا (الفكرة 37)

  const score = ev.scores ? ev.scores[card.id] : undefined;
  const natureCond = getNatureCondition(card, config);
  const changeCount = (ev.changeCounts && ev.changeCounts[card.id]) || 0;
  const hasDoubt = !!(ev.doubtMarks && ev.doubtMarks[card.id]);

  // --- الرأس ---
  const head = document.createElement('div');
  head.className = 'eval-criterion-head';

  const nameRow = document.createElement('div');
  nameRow.className = 'card-head-name-row';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'eval-criterion-name';
  nameSpan.textContent = card.name;
  nameRow.appendChild(nameSpan);

  if (changeCount > 0) {
    const ch = document.createElement('span');
    ch.className = 'change-badge';
    ch.title = `غُيّرت الدرجة ${changeCount} مرة`;
    ch.textContent = `↻${changeCount}`;
    nameRow.appendChild(ch);
  }

  if (hasDoubt) {
    const db = document.createElement('span');
    db.className = 'doubt-badge';
    db.textContent = '؟';
    db.title = 'معيار مشكوك فيه';
    nameRow.appendChild(db);
  }

  head.appendChild(nameRow);

  const scoreLabel = document.createElement('span');
  scoreLabel.className = 'eval-criterion-score';
  const level = score !== undefined && score !== null ? SCORE_LEVELS.find(l => l.value === score) : null;
  // الرقم بجانب اسم الدرجة (المواصفة 37)
  scoreLabel.innerHTML = level ? `<span class="level-name">${level.name} (${level.value})</span>` : 'اختر الدرجة';
  head.appendChild(scoreLabel);
  div.appendChild(head);

  // --- الطبقة الأساسية ---
  const body = document.createElement('div');
  body.className = 'eval-criterion-body';

  // نص البطاقة (السؤال)
  const question = getCardText(card, config);
  if (question) {
    const textDiv = document.createElement('div');
    textDiv.className = 'eval-criterion-text';
    textDiv.textContent = question;
    body.appendChild(textDiv);
  }

  // القسم المشروط بحسب طبيعة التبعية (بطاقات العلاقة بالمصدر)
  if (natureCond) {
    const condDiv = document.createElement('div');
    condDiv.className = 'nature-condition';
    condDiv.textContent = `(${lbl(NATURES, config.nature)}) ${natureCond}`;
    body.appendChild(condDiv);
  }

  // --- الطبقة الأساسية: يدخل فيه / لا يدخل فيه (مرئيان دائمًا) ---
  const layer1 = document.createElement('div');
  layer1.className = 'card-layer base-visible';

  if (card.enters && card.enters.length) {
    const h = document.createElement('div');
    h.className = 'layer-title';
    h.textContent = 'يدخل فيه';
    layer1.appendChild(h);
    for (const e of card.enters) {
      const p = document.createElement('div');
      p.className = 'layer-item';
      p.textContent = '• ' + e;
      layer1.appendChild(p);
    }
  }
  if (card.notEnters && card.notEnters.length) {
    const h = document.createElement('div');
    h.className = 'layer-title';
    h.textContent = 'لا يدخل فيه';
    layer1.appendChild(h);
    for (const e of card.notEnters) {
      const p = document.createElement('div');
      p.className = 'layer-item';
      p.textContent = '• ' + e;
      layer1.appendChild(p);
    }
  }
  body.appendChild(layer1);

  // --- الطبقة الثانية (خلف «رؤية المزيد» الأول): التمييز + المثال ---
  const layer2 = document.createElement('div');
  layer2.className = 'card-layer';

  if (card.distinctions && card.distinctions.length) {
    const h = document.createElement('div');
    h.className = 'layer-title';
    h.textContent = 'التمييز عن المعايير القريبة';
    layer2.appendChild(h);
    for (const e of card.distinctions) {
      const p = document.createElement('div');
      p.className = 'layer-item';
      p.textContent = '• ' + e;
      layer2.appendChild(p);
    }
  }
  if (card.example) {
    const h = document.createElement('div');
    h.className = 'layer-title';
    h.textContent = 'مثال';
    layer2.appendChild(h);
    const p = document.createElement('div');
    p.className = 'layer-item example';
    p.textContent = card.example;
    layer2.appendChild(p);
  }
  body.appendChild(layer2);

  // --- زر «رؤية المزيد» الأول ---
  const more1 = document.createElement('button');
  more1.className = 'see-more';
  const isL2Expanded = state.expandedCards.has(card.id + ':l2');
  more1.textContent = isL2Expanded ? 'إخفاء التمييز والمثال' : 'رؤية المزيد';
  more1.onclick = () => {
    const key = card.id + ':l2';
    if (state.expandedCards.has(key)) { state.expandedCards.delete(key); state.expandedCards.delete(card.id + ':l3'); }
    else state.expandedCards.add(key);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  };
  body.appendChild(more1);
  if (isL2Expanded) layer2.classList.add('visible');

  // --- الطبقة الثالثة (خلف «رؤية المزيد» الثاني): جدول الدرجات + الملاحظة ---
  const layer3 = document.createElement('div');
  layer3.className = 'card-layer';

  const gtitle = document.createElement('div');
  gtitle.className = 'layer-title';
  gtitle.textContent = 'جدول الدرجات';
  layer3.appendChild(gtitle);
  const gIntro = gradesIntroOf(card);
  if (gIntro) {
    const gi = document.createElement('div');
    gi.className = 'grades-intro';
    gi.textContent = gIntro;
    layer3.appendChild(gi);
  }

  const table = document.createElement('div');
  table.className = 'grades-table';

  for (const g of card.grades) {
    const row = document.createElement('div');
    row.className = 'grade-row' + (score === g.value ? ' selected' : '');
    row.title = 'انقر لاختيار هذه الدرجة';

    // الصف قابل للنقر لاختيار الدرجة مباشرة (المواصفة 37)
    row.onclick = () => {
      if (!ev.scores) ev.scores = {};
      if (!ev.changeCounts) ev.changeCounts = {};
      const prev = ev.scores[card.id];
      if (prev !== undefined && prev !== g.value) {
        ev.changeCounts[card.id] = (ev.changeCounts[card.id] || 0) + 1;
      }
      ev.scores[card.id] = g.value;
      autoSaveCurrent();
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    };

    const num = document.createElement('div');
    num.className = 'grade-num';
    num.textContent = `${g.value}`;
    row.appendChild(num);

    const info = document.createElement('div');
    info.className = 'grade-info';

    const nameLine = document.createElement('div');
    nameLine.className = 'grade-name';
    nameLine.textContent = g.name;
    info.appendChild(nameLine);

    const condLine = document.createElement('div');
    condLine.className = 'grade-cond';
    condLine.textContent = g.condition;
    info.appendChild(condLine);

    if (state.showGradeDescriptions) {
      const descLine = document.createElement('div');
      descLine.className = 'grade-desc';
      descLine.textContent = g.description;
      info.appendChild(descLine);
    }

    row.appendChild(info);
    table.appendChild(row);
  }
  layer3.appendChild(table);

  if (card.note) {
    const n = document.createElement('div');
    n.className = 'card-note';
    n.textContent = card.note;
    layer3.appendChild(n);
  }
  body.appendChild(layer3);

  // --- زر «رؤية المزيد» الثاني (جدول الدرجات) ---
  const more2 = document.createElement('button');
  more2.className = 'see-more';
  const isL3Expanded = state.expandedCards.has(card.id + ':l3');
  more2.textContent = isL3Expanded ? 'إخفاء جدول الدرجات' : 'رؤية جدول الدرجات';
  more2.onclick = () => {
    const key = card.id + ':l3';
    if (state.expandedCards.has(key)) state.expandedCards.delete(key);
    else state.expandedCards.add(key);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  };
  // تتابع الطبقات (المواصفة 37): زر جدول الدرجات وطبقته لا يظهران إلا بعد فتح الطبقة الثانية
  if (isL2Expanded) {
    body.appendChild(more2);
    if (isL3Expanded) layer3.classList.add('visible');
  }

  // --- أزرار الدرجة في ذيل البطاقة (دائمة الظهور) ---
  const opts = document.createElement('div');
  opts.className = 'eval-score-options';

  for (const level of SCORE_LEVELS) {
    const opt = document.createElement('button');
    opt.className = 'eval-score-option' + (score === level.value ? ' selected' : '');
    opt.innerHTML = `<span>${level.name}</span><span class="num">${level.value}</span>`;
    opt.onclick = () => {
      if (!ev.scores) ev.scores = {};
      if (!ev.changeCounts) ev.changeCounts = {};
      // عدّاد التغييرات — يزيد فقط عند تغيّر الدرجة الفعلية إلى قيمة مختلفة
      const prev = ev.scores[card.id];
      if (prev !== undefined && prev !== level.value) {
        ev.changeCounts[card.id] = (ev.changeCounts[card.id] || 0) + 1;
      }
      ev.scores[card.id] = level.value;
      autoSaveCurrent();
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    };
    opts.appendChild(opt);
  }

  // علامة الشك (الفكرة 32) — تُحفظ في doubtMarks المشترك مع عدّاد كرت العمل
  const doubtBtn = document.createElement('button');
  doubtBtn.className = 'doubt-btn' + (hasDoubt ? ' active' : '');
  doubtBtn.title = 'علامة الشك';
  doubtBtn.textContent = '؟';
  doubtBtn.onclick = () => {
    if (!ev.doubtMarks) ev.doubtMarks = {};
    ev.doubtMarks[card.id] = !ev.doubtMarks[card.id];
    autoSaveCurrent();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  };
  opts.appendChild(doubtBtn);

  body.appendChild(opts);

  div.appendChild(body);
  return div;
}

// نسخة للقراءة فقط — **غير مستخدمة بعد v23** (ملاحظة المستخدم 3): كرت العمل لم يعد يعرض
// بطاقات المعايير ووصفها في شاشة تفاصيل العمل؛ هذه الدالة باقية بلا حذف (بقرار صريح) لإمكان
// إعادتها بأمر من المالك لاحقًا. لا تُستدعى من أي مسار حاليًا. الحارس: لا يوجد — موثّقة في
// progress-report.md §4 (تنظيف 14 أكتوبر 2026)؛ راجع سطر «دالة عرض المعايير القديمة» هناك.
// تُبنى بشكل مستقل لتجنّب أي عنصر تفاعلي يغيّر الدرجة أو الحفظ.
function renderCardCriterionReadOnly(card, ev, config) {
  const div = document.createElement('div');
  div.className = 'eval-criterion';
  div.dataset.cardId = card.id;

  const score = ev.scores ? ev.scores[card.id] : undefined;
  const natureCond = getNatureCondition(card, config);
  const changeCount = (ev.changeCounts && ev.changeCounts[card.id]) || 0;
  const hasDoubt = !!(ev.doubtMarks && ev.doubtMarks[card.id]);

  const head = document.createElement('div');
  head.className = 'eval-criterion-head';
  const nameRow = document.createElement('div');
  nameRow.className = 'card-head-name-row';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'eval-criterion-name';
  nameSpan.textContent = card.name;
  nameRow.appendChild(nameSpan);
  if (changeCount > 0) {
    const ch = document.createElement('span');
    ch.className = 'change-badge';
    ch.textContent = `↻${changeCount}`;
    nameRow.appendChild(ch);
  }
  if (hasDoubt) {
    const db = document.createElement('span');
    db.className = 'doubt-badge';
    db.textContent = '؟';
    nameRow.appendChild(db);
  }
  head.appendChild(nameRow);
  const scoreLabel = document.createElement('span');
  scoreLabel.className = 'eval-criterion-score';
  const level = (score !== undefined && score !== null) ? SCORE_LEVELS.find(l => l.value === score) : null;
  scoreLabel.innerHTML = level ? `<span class="level-name">${level.name} (${level.value})</span>` : '—';
  head.appendChild(scoreLabel);
  div.appendChild(head);

  const body = document.createElement('div');
  body.className = 'eval-criterion-body';

  const question = getCardText(card, config);
  if (question) {
    const t = document.createElement('div');
    t.className = 'eval-criterion-text';
    t.textContent = question;
    body.appendChild(t);
  }
  if (natureCond) {
    const condDiv = document.createElement('div');
    condDiv.className = 'nature-condition';
    condDiv.textContent = `(${lbl(NATURES, config.nature)}) ${natureCond}`;
    body.appendChild(condDiv);
  }

  // الطبقة الأساسية (ظاهرة دائمًا)
  const layer1 = document.createElement('div');
  layer1.className = 'card-layer base-visible';
  if (card.enters && card.enters.length) {
    const h = document.createElement('div'); h.className = 'layer-title'; h.textContent = 'يدخل فيه'; layer1.appendChild(h);
    for (const e of card.enters) { const p = document.createElement('div'); p.className = 'layer-item'; p.textContent = '• ' + e; layer1.appendChild(p); }
  }
  if (card.notEnters && card.notEnters.length) {
    const h = document.createElement('div'); h.className = 'layer-title'; h.textContent = 'لا يدخل فيه'; layer1.appendChild(h);
    for (const e of card.notEnters) { const p = document.createElement('div'); p.className = 'layer-item'; p.textContent = '• ' + e; layer1.appendChild(p); }
  }
  body.appendChild(layer1);

  // الطبقتان الثانية والثالثة (قابلتان للفتح للقراءة فقط — دون تعديل)
  const layer2 = document.createElement('div');
  layer2.className = 'card-layer';
  if (card.distinctions && card.distinctions.length) {
    const h = document.createElement('div'); h.className = 'layer-title'; h.textContent = 'التمييز عن المعايير القريبة'; layer2.appendChild(h);
    for (const e of card.distinctions) { const p = document.createElement('div'); p.className = 'layer-item'; p.textContent = '• ' + e; layer2.appendChild(p); }
  }
  if (card.example) {
    const h = document.createElement('div'); h.className = 'layer-title'; h.textContent = 'مثال'; layer2.appendChild(h);
    const p = document.createElement('div'); p.className = 'layer-item example'; p.textContent = card.example; layer2.appendChild(p);
  }
  body.appendChild(layer2);

  const more1 = document.createElement('button');
  more1.className = 'see-more';
  const isL2Expanded = state.expandedCards.has(card.id + ':l2');
  more1.textContent = isL2Expanded ? 'إخفاء التمييز والمثال' : 'رؤية المزيد';
  more1.onclick = () => {
    const key = card.id + ':l2';
    if (state.expandedCards.has(key)) { state.expandedCards.delete(key); state.expandedCards.delete(card.id + ':l3'); }
    else state.expandedCards.add(key);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  };
  body.appendChild(more1);
  if (isL2Expanded) layer2.classList.add('visible');

  const layer3 = document.createElement('div');
  layer3.className = 'card-layer';
  const gtitle = document.createElement('div');
  gtitle.className = 'layer-title'; gtitle.textContent = 'جدول الدرجات'; layer3.appendChild(gtitle);
  const gIntro = gradesIntroOf(card);
  if (gIntro) { const gi = document.createElement('div'); gi.className = 'grades-intro'; gi.textContent = gIntro; layer3.appendChild(gi); }
  const table = document.createElement('div');
  table.className = 'grades-table';
  for (const g of card.grades) {
    const row = document.createElement('div');
    row.className = 'grade-row' + (score === g.value ? ' selected' : '');
    const num = document.createElement('div'); num.className = 'grade-num'; num.textContent = String(g.value); row.appendChild(num);
    const info = document.createElement('div'); info.className = 'grade-info';
    const nameLine = document.createElement('div'); nameLine.className = 'grade-name'; nameLine.textContent = g.name; info.appendChild(nameLine);
    const condLine = document.createElement('div'); condLine.className = 'grade-cond'; condLine.textContent = g.condition; info.appendChild(condLine);
    if (state.showGradeDescriptions) {
      const descLine = document.createElement('div'); descLine.className = 'grade-desc'; descLine.textContent = g.description; info.appendChild(descLine);
    }
    row.appendChild(info);
    table.appendChild(row);
  }
  layer3.appendChild(table);
  if (card.note) {
    const n = document.createElement('div'); n.className = 'card-note'; n.textContent = card.note; layer3.appendChild(n);
  }
  body.appendChild(layer3);

  const more2 = document.createElement('button');
  more2.className = 'see-more';
  const isL3Expanded = state.expandedCards.has(card.id + ':l3');
  more2.textContent = isL3Expanded ? 'إخفاء جدول الدرجات' : 'رؤية جدول الدرجات';
  more2.onclick = () => {
    const key = card.id + ':l3';
    if (state.expandedCards.has(key)) state.expandedCards.delete(key);
    else state.expandedCards.add(key);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  };
  // تتابع الطبقات (المواصفة 37): زر جدول الدرجات وطبقته لا يظهران إلا بعد فتح الطبقة الثانية
  if (isL2Expanded) {
    body.appendChild(more2);
    if (isL3Expanded) layer3.classList.add('visible');
  }

  div.appendChild(body);
  return div;
}

// ============================================================
// 8. شاشة التفاصيل
// ============================================================

function renderDetails(container) {
  if (!state.currentDetailsId) { goHome(); return; }
  const ev = state.library.find(e => e.id === state.currentDetailsId);
  if (!ev) { goHome(); return; }

  renderHeader(container, true);

  const config = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };

  const header = document.createElement('div');
  header.className = 'details-header';
  header.innerHTML = `
    <div class="eval-title">
      <h2>${escapeHtml(ev.name)}</h2>
      <div class="config">${lbl(MEDIA, ev.medium)} — ${lbl(FORMATS, ev.format)} — ${lbl(RELATIONS, ev.relation)}${ev.nature ? ' (' + lbl(NATURES, ev.nature) + ')' : ''}${ev.mode === 'quick' ? ' — تقييم سريع' : ''}</div>
      ${ev.watchDate ? `<div class="config">تاريخ المشاهدة: ${escapeHtml(ev.watchDate)}</div>` : ''}
      ${ev.completedAt ? `<div class="config">تاريخ التقييم: ${formatDate(ev.completedAt)}</div>` : ''}
    </div>
  `;
  container.appendChild(header);

  // النتيجة النهائية
  if (ev.status === 'completed' && ev.totalScore != null) {
    const final = document.createElement('div');
    final.className = 'eval-score-display details-score';
    final.innerHTML = `<span class="score">${formatNumber(ev.totalScore)}</span><span class="max">/ 10</span>`;
    container.appendChild(final);
  }
  // إصلاح م4: توزيع الدرجات في شاشة التفاصيل (بنفس الشكل)
  container.appendChild(renderScoreDistribution(ev));

  // شاهد التمييز للسلسلة (للقراءة) — للسلاسل الفيلمية وعند وجود نص فقط
  if (ev.format === 'film_series' && typeof ev.seriesWitness === 'string' && ev.seriesWitness.trim()) {
    const wSec = document.createElement('div');
    wSec.className = 'details-section series-witness';
    const wLabel = document.createElement('label');
    wLabel.className = 'wizard-label';
    wLabel.textContent = 'شاهد التمييز للسلسلة';
    const wText = document.createElement('div');
    wText.className = 'details-copy-text';
    wText.textContent = ev.seriesWitness.trim();
    wSec.appendChild(wLabel);
    wSec.appendChild(wText);
    container.appendChild(wSec);
  }

  // v23 (ملاحظة المستخدم 3): كرت العمل لم يعد يعرض المعايير ووصفها — فقط: الملاحظات، نص التقييم الجاهز للنسخ، وأزرار التصدير كصورة والتعديل.
  // دالة renderCardCriterionReadOnly باقية في الملف دون حذف (لا تُستدعى هنا) لإمكان إعادتها بأمر صريح —
  // علّق عليها سبب البقاء أعلى تعريفها (تنظيف 14 أكتوبر 2026؛ راجع progress-report.md §4).

  // الملاحظات
  const notesSection = document.createElement('div');
  notesSection.className = 'details-section';
  notesSection.innerHTML = '<label class="wizard-label">ملاحظات</label>';
  const notesArea = document.createElement('textarea');
  notesArea.className = 'details-notes';
  notesArea.value = ev.notes || '';
  notesArea.onblur = (e) => { ev.notes = e.target.value; saveLibrary(); };
  notesSection.appendChild(notesArea);
  container.appendChild(notesSection);

  // تصدير نصي (الفكرة 22)
  if (ev.status === 'completed') {
    const copySection = document.createElement('div');
    copySection.className = 'details-section';
    copySection.innerHTML = '<label class="wizard-label">نص التقييم</label>';

    const copyText = document.createElement('div');
    copyText.className = 'details-copy-text';
    copyText.textContent = generateCopyText(ev);
    copySection.appendChild(copyText);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-primary btn-full';
    copyBtn.style.marginTop = 'var(--space-2)';
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> نسخ النص';
    copyBtn.onclick = () => {
      const text = generateCopyText(ev);
      const fallbackCopy = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('تم النسخ');
      };
      // v18 B-14: navigator.clipboard قد لا يكون معرّفًا (سياق غير آمن/متصفح قديم)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast('تم النسخ')).catch(fallbackCopy);
      } else fallbackCopy();
    };
    copySection.appendChild(copyBtn);
    container.appendChild(copySection);
  }

  // زر تصدير صورة للعمل الواحد (م10 — الفكرة 23، المرجع :2113 «بطاقة نتيجة أنيقة»)
  if (ev.status === 'completed') {
    const imgSection = document.createElement('div');
    imgSection.className = 'details-section';
    const imgBtn = document.createElement('button');
    imgBtn.className = 'btn btn-secondary btn-full';
    imgBtn.style.marginTop = 'var(--space-2)';
    imgBtn.textContent = 'تصدير كصورة';
    imgBtn.onclick = () => exportResultImage(ev);
    imgSection.appendChild(imgBtn);
    container.appendChild(imgSection);
  }

  // زر التعديل
  const editSection = document.createElement('div');
  editSection.className = 'details-section';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-secondary btn-full';
  editBtn.textContent = 'تعديل';
  editBtn.onclick = () => editWork(ev.id);
  editSection.appendChild(editBtn);
  container.appendChild(editSection);

  // الحذف
  const actions = document.createElement('div');
  actions.className = 'details-actions';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-full';
  delBtn.textContent = 'حذف';
  delBtn.onclick = () => {
    showConfirm('حذف', `هل أنت متأكد من حذف "${ev.name}"؟ لا يمكن التراجع.`, () => {
      deleteWorkById(ev.id);
      state.currentDetailsId = null;
      goHome();
      showToast('تم الحذف');
    });
  };
  actions.appendChild(delBtn);
  container.appendChild(actions);
}

function openDetails(id) {
  state.currentDetailsId = id;
  state.view = 'details';
  state.expandedCards.clear();
  render();
}

function editWork(id) {
  const ev = state.library.find(e => e.id === id);
  if (!ev) return;
  state.editingId = id;
  state.wizardData = {
    name: ev.name,
    medium: ev.medium,
    format: ev.format,
    relation: ev.relation,
    nature: ev.nature,
    mode: ev.mode || 'detailed',
    watchDate: ev.watchDate || '',
    tags: (ev.tags || []).slice(),
  };
  state.current = ev;
  state.view = 'wizard';
  state.expandedCards.clear();
  render();
}

// ط10: احتساب أقوى/أضعف الفئات — v20 B-06: بالنسبة المعدّلة (points / weight * 10) لا النقاط الخام.
// النقاط الخام مُسندة إلى وزن الفئة (الحد الأقصى 5 أو 2.5 أو 1.5 أو 1) فكانت تعكس الوزن لا الجودة،
// وكانت تُطبع بمقام «/10» خاطئ وتناقض الأشرطة المعيارية في الصورة نفسها (app.js:2802).
// النسبة المعدّلة هي نفس المعيار المستخدم في المقارنة والإحصاءات — النظام الآن متسق مع نفسه.
function getExtremes(ev) {
  if (!ev || ev.status !== 'completed' || !ev.categoryScores || !ev.categoryScores.length) return null;
  // v20 D-4: تكوين غير معروف → لا أقوى/أضعف بأوزان افتراضية (المستهلك المباشر لـcalculateWeights خارج الحارس المركزي)
  if (!hasKnownConfig(ev)) return null;
  const weights = ev.weights || calculateWeights(ev.medium, ev.format, ev.relation);
  const scored = ev.categoryScores
    .filter(cs => typeof cs.points === 'number' && isFinite(cs.points))
    .map(cs => {
      const w = (weights && weights[cs.categoryId]) || 0;
      // نسبة معدّلة 0–10 (نفس معيار الأشرطة)؛ وزن مجهول/صفر → غير قابل للمقارنة فتُستبعد
      const normalized = (w > 0) ? Math.min(10, Math.max(0, cs.points / w * 10)) : null;
      return { name: cs.name, points: cs.points, normalized };
    })
    .filter(cs => cs.normalized !== null);
  if (scored.length < 2) return null;
  const sortedDesc = scored.slice().sort((a, b) => b.normalized - a.normalized);
  const top = sortedDesc[0];
  const bottom = sortedDesc[sortedDesc.length - 1];
  return { top, bottom, allEqual: top.normalized === bottom.normalized, scored: sortedDesc };
}

function generateCopyText(ev) {
  const config = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };
  // v20 D-4: تكوين غير معروف → نص بلا أوزان افتراضية ولا «أقوى/أضعف»
  if (!hasKnownConfig(config)) return (ev && ev.name ? ev.name + '\n' : '') + 'التكوين غير معروف — لا يمكن توليد ملخص التقييم.';
  const cats = getApplicableCards(config);
  const weights = ev.weights || calculateWeights(config.medium, config.format, config.relation);

  const lines = [];
  lines.push('اسم العمل: ' + ev.name);
  lines.push('');
  lines.push(`${lbl(MEDIA, ev.medium)} — ${lbl(FORMATS, ev.format)} — ${lbl(RELATIONS, ev.relation)}${ev.nature ? ' (' + lbl(NATURES, ev.nature) + ')' : ''}`);
  if (ev.mode === 'quick') lines.push('(تقييم سريع)');
  lines.push('');
  // شاهد التمييز للسلسلة: يُطبع فقط للسلاسل الفيلمية وعند وجود نص
  if (ev.format === 'film_series' && typeof ev.seriesWitness === 'string' && ev.seriesWitness.trim()) {
    lines.push('شاهد التمييز للسلسلة: ' + ev.seriesWitness.trim());
    lines.push('');
  }

  for (const { category, cards } of cats) {
    const w = weights[category.id];
    if (!w) continue;
    lines.push(`${category.name} (${formatPercent(w)})`);
    for (const card of cards) {
      const s = ev.scores ? ev.scores[card.id] : undefined;
      const level = (s !== undefined && s !== null) ? SCORE_LEVELS.find(l => l.value === s) : null;
      // اسم الدرجة + الرقم (المواصفة 37)
      lines.push(`  ${card.name}: ${level ? level.name + ' (' + level.value + ')' : '—'}`);
    }
    lines.push('');
  }

  if (ev.status === 'completed' && ev.totalScore != null) {
    // ط10: أقوى/أضعف الفئات تُطبع قبل «النتيجة النهائية» (الفكرة 22، المرجع :2105)
    const ext = getExtremes(ev);
    if (ext) {
      if (ext.allEqual) {
        lines.push('الفئات متقاربة');
      } else {
        // v20 B-06: النسبة المعدّلة (0–10) لا النقاط الخام — المقام «/10» صار صحيحًا ومتسقًا مع الأشرطة
        lines.push(`أقوى الفئات: ${ext.top.name} (${formatNumber(ext.top.normalized)}/10)`);
        lines.push(`أضعف الفئات: ${ext.bottom.name} (${formatNumber(ext.bottom.normalized)}/10)`);
      }
    }
    lines.push(`النتيجة النهائية: ${formatNumber(ev.totalScore)} / 10`);
  }

  return lines.join('\n');
}

// ============================================================
// 9. الحفظ والمسودات
// ============================================================

function autoSaveCurrent() {
  if (!state.current) return;
  const ev = state.current;

  if (state.editingId) {
    // تعديل عمل موجود — يُحدّث مباشرة في المكتبة
    // إصلاح م1: لا يُكتب اسم فارغ أو مكرر في المكتبة — الفحص قبل أي كتابة
    const nameErr = invalidNameError(ev.name, ev.id);
    if (nameErr) { showToast(nameErr); return; } // لا يُكتب للمكتبة — ev يبقى بالاسم الصالح القديم
    const existing = state.library.find(e => e.id === ev.id);
    if (existing) {
      Object.assign(existing, ev);
    } else {
      state.library.push(ev);
    }
    // أعد حساب النتيجة إن اكتمل
    const config = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };
    // إصلاح ح2: التنظيف قبل إعادة الحساب في مسار التعديل أيضًا
    pruneNonApplicable(ev, config);
    const result = calculateScore(config, ev.scores || {});
    if (result.allScored) {
      ev.status = 'completed';
      ev.totalScore = result.totalScore;
      ev.weights = result.weights;
      ev.categoryScores = result.categoryScores.map(cs => ({ categoryId: cs.categoryId, name: cs.name, points: cs.points }));
      ev.completedAt = ev.completedAt || Date.now();
      stampSystemHashes(ev);
    } else {
      // v20 B-07 (أ): توحيد تصفير حقول المسودة مع saveDraft — لا تبقى completedAt/categoryScores/weights/systemHash
      ev.status = 'draft';
      ev.totalScore = null;
      ev.weights = null;
      ev.categoryScores = null;
      ev.completedAt = null;
      delete ev.systemHash;
      delete ev.weightsHash;
    }
    ev.updatedAt = Date.now();
    saveLibrary();
  } else if (ev.draftState === 'active') {
    state.activeDraft = ev;
    saveToStorage('eval_active_draft_v2', ev);
  } else {
    // عمل مؤرشف أو مكتمل بلا editingId — يُحفظ في المكتبة
    const existing = state.library.find(e => e.id === ev.id);
    if (existing) Object.assign(existing, ev);
    else state.library.push(ev);
    saveLibrary();
  }
}

function saveFinal() {
  if (!state.current) return;
  const ev = state.current;
  const config = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };
  const result = calculateScore(config, ev.scores || {});

  if (!result.allScored) { showToast('أكمل جميع المعايير أولاً'); return; }

  const trimmedName = ev.name.trim();
  if (!trimmedName) { showToast('اكتب اسم العمل أولاً'); return; }
  const dup = state.library.find(e => e.id !== ev.id && e.name.trim() === trimmedName);
  if (dup) { showToast('اسم العمل مكرر'); return; }

  ev.name = trimmedName;
  // إصلاح ح2: التنظيف موحّد عبر pruneNonApplicable (في applyScoreChange وsaveDraft وsaveFinal)
  ev.status = 'completed';
  ev.draftState = null;
  ev.totalScore = result.totalScore;
  ev.weights = result.weights;
  ev.categoryScores = result.categoryScores.map(cs => ({ categoryId: cs.categoryId, name: cs.name, points: cs.points }));
  ev.completedAt = Date.now();
  ev.updatedAt = Date.now();
  // إصلاح ط7: ربط العمل بلقطة النظام والأوزان التي قُيِّم عليها (وإعادة التقييم تحدّثها تلقائيًا)
  stampSystemHashes(ev);

  const existing = state.library.find(e => e.id === ev.id);
  if (existing) Object.assign(existing, ev);
  else state.library.push(ev);

  // تنظيف بطاقات لا تنطبق على التكوين بعد تعديل الصيغة (تعليق الفكرة 37 — لا تُبقي فائض درجات في سجل مكتمل)
  // إصلاح ح2: موحّد عبر pruneNonApplicable — نفس المنطق في applyScoreChange وautoSaveCurrent وsaveDraft
  pruneNonApplicable(ev, config);
  // إعادة الحساب على الدرجات الصالحة بعد التنظيف
  const finalResult = calculateScore(config, ev.scores || {});
  ev.totalScore = finalResult.totalScore;
  ev.weights = finalResult.weights;
  ev.categoryScores = finalResult.categoryScores.map(cs => ({ categoryId: cs.categoryId, name: cs.name, points: cs.points }));

  // إصلاح ح1: لا تُمسح المسودة النشطة إلا إن كان المحفوظ هو المسودة نفسها
  const isSavingActiveDraft = (state.activeDraft && state.activeDraft.id === ev.id);
  if (isSavingActiveDraft) {
    state.activeDraft = null;
    if (_lsAvailable) { try { localStorage.removeItem('eval_active_draft_v2'); } catch(e) {} }
    delete _memStore['eval_active_draft_v2'];
  }
  state.editingId = null;
  saveLibrary();
  state.current = null;
  goHome();
  showToast('تم حفظ التقييم');
}

function saveDraft() {
  if (!state.current) return;
  const ev = state.current;
  const trimmedName = ev.name.trim();
  if (!trimmedName) { showToast('اكتب اسم العمل أولاً'); return; }
  const dup = state.library.find(e => e.id !== ev.id && e.name.trim() === trimmedName);
  if (dup) { showToast('اسم العمل مكرر'); return; }

  ev.name = trimmedName;
  // إصلاح ط5: لا تبقَ نتيجة نهائية قديمة على مسودة — إن لم تكتمل المعايير الحالية تُصفّر
  const config = { medium: ev.medium, format: ev.format, relation: ev.relation, nature: ev.nature };
  pruneNonApplicable(ev, config);
  // v20 D-4: تكوين غير معروف → مسودة بلا نتيجة (نفس حارس applyScoreChange)
  const result = hasKnownConfig(ev) ? calculateScore(config, ev.scores || {}) : { allScored: false, totalScore: null, weights: null, categoryScores: [] };
  // v20 B-07 (ب): مسودة مكتملة الدرجات تحتفظ بالدرجات، لكن تُمسح حقول النتيجة النهائية والتاريخ
  // والبصمات — لا تبقى totalScore: 10 وهمية مع «غير مكتمل» (كانت تُحفظ بنتيجة قديمة من عمل سابق).
  // عند اكتمال التقييم لاحقًا (من مسار التقييم أو الحفظ النهائي) تُحسب القيم فعلًا من الدرجات المحفوظة.
  if (result.allScored) {
    // تُحفظ الأوزان فقط — لا totalScore ولا completedAt ولا بصمات (المسودة ليست مكتمِلة)
    ev.weights = result.weights;
    ev.categoryScores = result.categoryScores.map(cs => ({ categoryId: cs.categoryId, name: cs.name, points: cs.points }));
    delete ev.systemHash;
    delete ev.weightsHash;
  } else {
    ev.totalScore = null;
    ev.weights = null;
    ev.categoryScores = null;
    ev.completedAt = null;
    // النتيجة والأوزان مُسحتا ← لا معنى لبصمة قديمة عليهما
    delete ev.systemHash;
    delete ev.weightsHash;
  }
  ev.totalScore = null;      // v20 B-07(ب): المسودة بلا نتيجة نهائية
  ev.completedAt = null;     // v20 B-07(ب): المسودة بلا تاريخ تقييم وهمي
  ev.status = 'draft';
  ev.draftState = 'archived';
  ev.updatedAt = Date.now();

  const existing = state.library.find(e => e.id === ev.id);
  if (existing) Object.assign(existing, ev);
  else state.library.push(ev);

  // إصلاح ح1: لا تُمسح المسودة النشطة إلا إن كان المحفوظ هو المسودة نفسها
  const isSavingActiveDraft = (state.activeDraft && state.activeDraft.id === ev.id);
  if (isSavingActiveDraft) {
    state.activeDraft = null;
    if (_lsAvailable) { try { localStorage.removeItem('eval_active_draft_v2'); } catch(e) {} }
    delete _memStore['eval_active_draft_v2'];
  }
  saveLibrary();
  state.current = null;
  goHome();
  showToast('تم حفظ المسودة');
}

function showActiveDraftAlert() {
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-title">تقييم غير مكتمل</div>
    <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-4)">لديك تقييم غير مكتمل. متابعة أم بدء جديد؟</p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="draft-continue">متابعة</button>
      <button class="btn btn-secondary" id="draft-new">بدء جديد</button>
    </div>
  `;
  overlay.appendChild(modal);

  document.getElementById('draft-continue').onclick = () => {
    hideModal();
    state.current = state.activeDraft;
    state.view = 'evaluation';
    state.expandedCards.clear();
    render();
  };

  document.getElementById('draft-new').onclick = () => {
    hideModal();
    const draft = state.activeDraft;
    const trimmedName = (draft.name || '').trim();
    if (!trimmedName || state.library.some(e => e.name.trim() === trimmedName)) {
      showToast('لم تُحفظ المسودة — اسم فارغ أو مكرر');
      state.current = state.activeDraft;
      state.view = 'evaluation';
      state.expandedCards.clear();
      render();
    } else {
      // v20 B-07 (ب): «بدء جديد» يمرّ على نفس مساعد إعادة الحساب — لا تُحفظ المسودة المؤرشفة
      // بحقول نتيجة وهمية (totalScore: 10 وcompletedAt وبصمات) من عمل سابق.
      // ملاحظة: الدرجات المحفوظة تبقى كما هي — تُحسب النتيجة عند اكتمال التقييم لاحقًا.
      recalcImportedItem(draft);   // v20 B-01/B-07: مساعد مشترك لإعادة الحساب
      draft.draftState = 'archived';
      draft.name = trimmedName;
      draft.totalScore = null;   // v20 B-07(ب): المسودة بلا نتيجة نهائية
      draft.completedAt = null; // v20 B-07(ب): المسودة بلا تاريخ تقييم وهمي
      draft.status = 'draft';    // v20 B-07(ب): «بدء جديد» يُؤرشف مسودة — تبقى مسودة وإن اكتملت درجاتها
      delete draft.systemHash;
      delete draft.weightsHash;
      const existing = state.library.find(e => e.id === draft.id);
      if (existing) Object.assign(existing, draft);
      else state.library.push(draft);
      saveLibrary();
      state.activeDraft = null;
      if (_lsAvailable) { try { localStorage.removeItem('eval_active_draft_v2'); } catch(e) {} }
      delete _memStore['eval_active_draft_v2'];
      startNewEvaluation();
    }
  };
}

// ============================================================
// 10. الإعدادات (الفكرة 34: مفتاح إظهار وصف الدرجات)
// ============================================================

function showSettings() {
  const formHTML = `
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label">إظهار وصف الدرجات</label>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn ${state.showGradeDescriptions ? 'btn-primary' : 'btn-secondary'}" style="flex:1" id="desc-on" aria-pressed="${state.showGradeDescriptions ? 'true' : 'false'}">إظهار</button>
          <button class="btn ${state.showGradeDescriptions ? 'btn-secondary' : 'btn-primary'}" style="flex:1" id="desc-off" aria-pressed="${state.showGradeDescriptions ? 'false' : 'true'}">إخفاء</button>
        </div>
        <p id="desc-status" style="font-size:var(--text-xs);color:var(--color-text-faint)">الحالة الحالية: ${state.showGradeDescriptions ? 'مُظهر' : 'مُخفي'} — يظهر الوصف داخل «جدول الدرجات» في شاشة التقييم.</p>
      </div>

      <div class="form-field">
        <label class="form-label">تصدير المكتبة (نسخة احتياطية)</label>
        <button class="btn btn-primary btn-full" id="settings-export">تصدير JSON</button>
      </div>

      <div class="form-field">
        <label class="form-label">استيراد من ملف</label>
        <input type="file" id="settings-import" accept=".json" />
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="settings-close">إغلاق</button>
    </div>
  `;
  showModal('الإعدادات', formHTML);

  // البند 1 (v24): تغذية راجعة فورية — الخيار كان يُحفظ لكن النافذة تُغلق بلا أي إشارة،
  // والوصف لا يظهر إلا داخل جدول الدرجات في شاشة التقييم، فبدا وكأن الزر لا يعمل.
  // الآن: تبقى النافذة مفتوحة، يتلوّن الزر المختار، تتحدّث الحالة، ويظهر إشعار تأكيد.
  const descOnBtn = document.getElementById('desc-on');
  const descOffBtn = document.getElementById('desc-off');
  const descStatus = document.getElementById('desc-status');
  const applyDescSetting = (on) => {
    state.showGradeDescriptions = on;
    saveToStorage('eval_show_grade_desc_v2', on);
    descOnBtn.className = 'btn ' + (on ? 'btn-primary' : 'btn-secondary');
    descOffBtn.className = 'btn ' + (on ? 'btn-secondary' : 'btn-primary');
    descOnBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    descOffBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    descStatus.textContent = 'الحالة الحالية: ' + (on ? 'مُظهر' : 'مُخفي') + ' — يظهر الوصف داخل «جدول الدرجات» في شاشة التقييم.';
    showToast(on ? 'تم إظهار وصف الدرجات' : 'تم إخفاء وصف الدرجات');
    render();
  };
  descOnBtn.onclick = () => applyDescSetting(true);
  descOffBtn.onclick = () => applyDescSetting(false);

  document.getElementById('settings-export').onclick = () => exportData();

  document.getElementById('settings-import').onchange = (e) => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
  };

  document.getElementById('settings-close').onclick = hideModal;
}

// ============================================================
// 11. التصدير والاستيراد (الفكرة 20: نسخ احتياطي)
// ============================================================

function exportData() {
  const data = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    library: state.library,
    lists: state.lists || [],
    umbrellas: state.umbrellas || [],
    settings: {
      showGradeDescriptions: state.showGradeDescriptions,
      theme: state.theme,
    },
    // نسخ احتياطي للنظام نفسه (الفكرة 20): البطاقات بكل حقولها + الفئات + الأوزان
    // إصلاح م6: تُبنى ببانية صحيحة ثم تُسلسل (يُستخدم في الاختبارات أيضًا)
    systemBackup: {
      totalCards: CARDS.length,
      categories: CATEGORIES.length,
      systemHash: state.systemHash || systemHash(),    // إصلاح ط7: بصمة التعريف وقت التصدير
      weightsHash: state.weightsHash || weightsHash(),
      scoreLevels: SCORE_LEVELS,
      // إصلاح م6: نسخ جميع خصائص البطاقة (لا قائمة تخمينية) — لا يُسقط أي حقل
      cards: CARDS.map(c => {
        const copy = {};
        for (const k of Object.keys(c)) copy[k] = c[k];
        copy.conditionalByNature = c.conditionalByNature || null;
        return copy;
      }),
      categoriesData: CATEGORIES,
      formatOverrides: FORMAT_OVERRIDES,
      gradesIntro: (typeof GRADES_INTRO !== 'undefined') ? GRADES_INTRO : {},   // TABLE-INTRO: نصوص تمهيد جدول الدرجات
      // إصلاح م6: تصدير جدول الأوزان (الفكرة 20: «البطاقات بكل حقولها + الأوزان»)
      // مصفوفة كل تكوين (medium×format×relation) مع أوزانه الثماني (أقل)
      weights: (function () {
        const mediums = Object.keys(MEDIA);
        const formats = Object.keys(FORMATS);
        const relations = Object.keys(RELATIONS);
        const rows = [];
        for (const m of mediums) for (const f of formats) for (const r of relations) {
          rows.push({ medium: m, format: f, relation: r, weights: calculateWeights(m, f, r) });
        }
        return rows;
      })(),
      // إصلاح م6: تصدير المسودة النشطة
      activeDraft: state.activeDraft || null,
      note: 'نسخة أرشيفية من تعريف النظام — البطاقات بكل حقولها والفئات وسلالم الدرجات والصياغات الخاصة وجدول الأوزان — للحفظ والتحقق من تطابق النظام (المرجع 20: تصدير لا استعادة). المسودة النشطة تُصدَّر هنا للحفظ اليدوي. الاستيراد لا يقرأ هذا القسم ولا يستبدل النظام الحالي به.',
    },
    cardsMeta: {
      version: 'v2',
      totalCards: CARDS.length,
      categories: CATEGORIES.length,
      note: 'Full system definition is embedded in system-data.js AND duplicated in systemBackup above.',
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'تقييم-الأعمال-الفنية-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('تم التصدير');
}

// v20 B-01 (تكملة): مساعد مشترك لإعادة حساب النتيجة والحالة بدل الوثوق بقيم الملف المستورد —
// يُستدعى في كل مسار قبول (الاستيراد المباشر ونافذة تعارض الأسماء) لمنع تخزين totalScore/status
// وهميين (مثل totalScore: 9999 أو status: 'completed' بلا درجات صالحة).
// ملاحظة: عند عدم اكتمال الدرجات تُمسح حقول النتيجة والبصمات — لا يبقى أي أثر لقيم الملف.
function recalcImportedItem(item) {
  const impConfig = { medium: item.medium, format: item.format, relation: item.relation, nature: item.nature };
  pruneNonApplicable(item, impConfig);
  // v20 D-4: تكوين غير معروف → لا نتيجة (الاستيراد لا يحسب العمل بأوزان افتراضية لم يخترها المستخدم)
  const impResult = hasKnownConfig(item) ? calculateScore(impConfig, item.scores || {}) : { allScored: false, totalScore: null, weights: null, categoryScores: [] };
  if (impResult.allScored) {
    item.status = 'completed';
    item.totalScore = impResult.totalScore;
    item.weights = impResult.weights;
    item.categoryScores = impResult.categoryScores.map(cs => ({ categoryId: cs.categoryId, name: cs.name, points: cs.points }));
    item.completedAt = item.completedAt || Date.now();
    stampSystemHashes(item);
  } else {
    item.status = 'draft';
    item.totalScore = null;
    item.weights = null;
    item.categoryScores = null;
    item.completedAt = null;
    delete item.systemHash;
    delete item.weightsHash;
  }
  item.updatedAt = Date.now();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object' || Array.isArray(data)) { showToast('ملف غير صالح'); return; }
      // إصلاح ط3: ترحيل الإصدار 1 بدل رفضه — الإصدار 1 لا يختلف إلا بحفظ علامة الشك في ev.doubts
      // (يعالجها normalizeDoubtMarks) — أي رقم آخر يُرفض برسالة واضحة
      let migratedFromV1 = false;
      if (data.schemaVersion === 1) {
        if (!Array.isArray(data.library)) { showToast('ملف غير صالح'); return; }
        for (const it of data.library) normalizeDoubtMarks(it);
        data.schemaVersion = SCHEMA_VERSION;
        migratedFromV1 = true;
      }
      if (data.schemaVersion !== SCHEMA_VERSION) {
        showToast(typeof data.schemaVersion === 'number'
          ? `إصدار الملف (${data.schemaVersion}) غير مدعوم — المدعوم: 1 و${SCHEMA_VERSION}`
          : 'ملف غير صالح: لا يحمل رقم إصدار');
        return;
      }
      if (!Array.isArray(data.library)) { showToast('ملف غير صالح'); return; }
      // إصلاح م2: تحقق بنية العناصر قبل تعديل الحالة — لا يُدخل عنصر بلا name يكسر كل حفظ لاحق.
      // العنصر الصالح: كائن غير فارغ، اسم نصي غير فارغ بعد trim، ومعرّف نصي صالح.
      const validItems = data.library.filter(x =>
        x && typeof x === 'object' &&
        typeof x.name === 'string' && x.name.trim() &&
        typeof x.id === 'string' && x.id
      );
      const invalidCount = data.library.length - validItems.length;
      if (invalidCount > 0) showToast(`تُخطّي ${invalidCount} عنصرًا غير صالح (بلا اسم أو معرّف)`);

      let imported = 0, dupId = 0, nameConflicts = [];

      for (const item of validItems) {
        // تطبيع علامات الشك في الملفات المستوردة أيضًا — قبل التفرّع كي لا يفلت مسار
        // v18 B-01: حذف الدرجات غير الصحيحة (نص/كسر/خارج 0–4) من الملف المستورد — null يبقى كما هو
        if (item.scores && typeof item.scores === 'object' && !Array.isArray(item.scores)) {
          for (const k of Object.keys(item.scores)) {
            const v = item.scores[k];
            if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 4)) delete item.scores[k];
          }
        }
        normalizeDoubtMarks(item);
        if (state.library.some(e => e.id === item.id)) { dupId++; continue; }
        const trimmedName = (item.name || '').trim();
        if (trimmedName && state.library.some(e => e.name.trim() === trimmedName)) {
          nameConflicts.push(item); continue;
        }
        if (item.draftState === 'active') item.draftState = 'archived';
        recalcImportedItem(item);  // v20 B-01: مساعد مشترك — يعاد حساب النتيجة/الحالة بدل الوثوق بقيم الملف
        state.library.push(item);
        imported++;
      }

      // إصلاح ط3: معرّفات الأعمال الصالحة = المكتبة الآن + عناصر تعارض الأسماء المعلّقة (قد تُضاف بعد حوار التعارض)
      // وما يبقى معلّقًا بعد الحوار يُنظَّف في showImportConflicts
      const validIds = new Set(state.library.map(x => x.id));
      for (const c of nameConflicts) validIds.add(c.id);
      // قوائم مخصصة — تُنسخ وتُرشَّح عناصرها (لا مرجع معلّق)
      if (data.lists && Array.isArray(data.lists)) {
        for (const l0 of data.lists) {
          if (!l0 || typeof l0 !== 'object') continue;
          const l = { ...l0 };
          if (!l.id) l.id = generateUUID();
          l.items = (Array.isArray(l.items) ? l.items : []).filter(id => validIds.has(id));
          if (!state.lists.some(x => x.id === l.id)) state.lists.push(l);
        }
      }
      // مظلات — نفس المبدأ على الأجزاء
      if (data.umbrellas && Array.isArray(data.umbrellas)) {
        for (const u0 of data.umbrellas) {
          if (!u0 || typeof u0 !== 'object') continue;
          const u = { ...u0 };
          if (!u.id) u.id = generateUUID();
          u.parts = (Array.isArray(u.parts) ? u.parts : []).filter(p => p && validIds.has(p.evalId));
          if (!state.umbrellas.some(x => x.id === u.id)) state.umbrellas.push(u);
        }
      }
      // إعدادات
      if (data.settings && typeof data.settings === 'object') {
        // إصلاح ط3: الثيم المُصدَّر يُطبَّق إن كان light/dark
        setTheme(data.settings.theme);
        if (typeof data.settings.showGradeDescriptions === 'boolean') {
          state.showGradeDescriptions = data.settings.showGradeDescriptions;
          saveToStorage('eval_show_grade_desc_v2', state.showGradeDescriptions);
        }
      }

      saveLibrary();
      saveLists();
      saveUmbrellas();

      if (nameConflicts.length > 0) {
        showImportConflicts(nameConflicts, imported, dupId);
      } else {
        hideModal();  // v18 B-12: إغلاق نافذة الإعدادات بعد الاستيراد
        showToast(`تم استيراد ${imported} عنصرًا` + (migratedFromV1 ? ' (رُحِّل من الإصدار 1)' : ''));
        render();
      }
    } catch (err) {
      showToast('خطأ في قراءة الملف');
    }
  };
  reader.readAsText(file);
}

function showImportConflicts(conflicts, imported, dupId) {
  const formHTML = `
    <div class="modal-body">
      <p style="font-size:var(--text-sm);color:var(--color-text-muted)">تعارضات في أسماء الأعمال. عدّل الأسماء أو تخطّى.</p>
      ${conflicts.map((item, i) => `
        <div class="form-field">
          <label class="form-label">${escapeHtml(item.name)}</label>
          <input class="form-input" type="text" id="conflict-${i}" value="${escapeHtml(item.name)}">
        </div>
      `).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="conflict-save">حفظ</button>
      <button class="btn btn-secondary" id="conflict-skip">تخطّي الكل</button>
    </div>
  `;
  showModal('تعارضات الأسماء', formHTML);

  document.getElementById('conflict-save').onclick = () => {
    // إصلاح ط2: تحقق من كل الأسماء أولًا (ذرّية) — لا يُدفع عنصر إن كان أي اسم مكررًا
    const proposed = conflicts.map((item, i) => document.getElementById(`conflict-${i}`).value.trim()).filter(Boolean);
    const seen = new Set();
    for (const nm of proposed) {
      if (seen.has(nm) || state.library.some(e => e.name.trim() === nm)) {
        showToast(`الاسم "${nm}" مكرر أيضًا`);  // v18 B-10: textContent يهرّب وحده
        return;
      }
      seen.add(nm);
    }
    // كل الأسماء صالحة — تُضاف المجموعة دفعة واحدة
    let added = 0;
    for (let i = 0; i < conflicts.length; i++) {
      const newName = document.getElementById(`conflict-${i}`).value.trim();
      if (!newName) continue;
      const item = conflicts[i];
      item.name = newName;
      if (item.draftState === 'active') item.draftState = 'archived';
      recalcImportedItem(item);  // v20 B-01: نفس مساعد إعادة الحساب
      state.library.push(item);
      added++;
    }
    saveLibrary();
    pruneDanglingRefs(); // ط3: عناصر لم تُضف (اسم فارغ) لا تترك مراجع معلّقة
    hideModal();
    showToast(`تم استيراد ${imported + added} عنصرًا`);
    render();
  };

  document.getElementById('conflict-skip').onclick = () => {
    pruneDanglingRefs(); // ط3: المتخطّى لا يترك مراجع معلّقة في القوائم/المظلات
    hideModal();
    showToast(`تم استيراد ${imported} عنصرًا (${conflicts.length} تعارض تُخطّي)`);
    render();
  };
}

// ============================================================
// 12. أدوات عامة
// ============================================================

function saveLibrary() {
  saveToStorage('eval_library_v2', state.library);
}

function saveLists() {
  saveToStorage('eval_lists_v2', state.lists);
}

function saveUmbrellas() {
  saveToStorage('eval_umbrellas_v2', state.umbrellas);
}

function goHome() {
  state.view = 'home';
  state.current = null;
  state.currentDetailsId = null;
  state.editingId = null;
  state.expandedCards.clear();
  render();
  window.scrollTo(0, 0);
}

function showModal(title, bodyHTML) {
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <button class="modal-close" id="modal-close-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    <div class="modal-title">${title}</div>
    ${bodyHTML}
  `;
  overlay.appendChild(modal);

  document.getElementById('modal-close-btn').onclick = hideModal;
  overlay.onclick = (e) => { if (e.target === overlay) hideModal(); };
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function showConfirm(title, message, onConfirm) {
  // إصلاح ط1: الرسالة تُهرَّب مرة واحدة فقط (هنا) — لا تنفيذ HTML من الاسم، ولا تهريب مزدوج
  const formHTML = `
    <div class="modal-body">
      <p style="font-size:var(--text-sm);color:var(--color-text-muted)">${escapeHtml(String(message))}</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="confirm-yes">نعم</button>
      <button class="btn btn-secondary" id="confirm-no">إلغاء</button>
    </div>
  `;
  showModal(title, formHTML);
  document.getElementById('confirm-yes').onclick = () => { hideModal(); onConfirm(); };
  document.getElementById('confirm-no').onclick = hideModal;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.animation = 'none';
  void toast.offsetWidth;
  toast.style.animation = '';
  clearTimeout(showToast._t);  // v18 B-11: إلغاء مؤقّت الرسالة السابقة
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function formatWeightsLine(weights) {
  const parts = [];
  for (const k in weights) {
    const name = (CATEGORIES.find(c => c.id === k) || {}).name || k;
    parts.push(`${name} ${formatNumber(weights[k])}`);
  }
  return parts.join(' · ');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  // innerHTML يهرّب & < > فقط. الدالة تُستعمل أيضًا داخل سمات value="…" (showListForm/showUmbrellaForm)،
  // فتُهرَّب علامتا الاقتباس هنا كي لا يكسر الاسمُ السمةَ ويحقن حدثًا (T-1 — الدفعة 1، 13 أكتوبر 2026)
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showStorageFullAlert() {
  showToast('امتلأ التخزين. صدّر مكتبتك واحذف بعض العناصر.');
}

// ============================================================
// 13. شاشة المقارنة — الفكرة 12 (مقارنة عملين)
// ============================================================

function renderCompare(container) {
  renderHeader(container, true);

  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'مقارنة عملين';
  container.appendChild(title);

  const completed = state.library.filter(e => e.status === 'completed');
  if (completed.length < 2) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>تحتاج تقييمين مكتملين على الأقل للمقارنة.</p>';
    container.appendChild(empty);
    return;
  }

  // v18 B-04/B-05: ضبط الاختيار الافتراضي قبل بناء المنسدلتين، واعتبار معرّف محذوف كأنه فارغ
  const completedIds = new Set(completed.map(e => e.id));
  if (!state.selectedForCompare[0] || !completedIds.has(state.selectedForCompare[0])) state.selectedForCompare[0] = completed[0].id;
  if (!state.selectedForCompare[1] || !completedIds.has(state.selectedForCompare[1]) || state.selectedForCompare[1] === state.selectedForCompare[0]) {
    state.selectedForCompare[1] = (completed.find(e => e.id !== state.selectedForCompare[0]) || completed[0]).id;
  }

  // اختيار العملين — البند 5 (v25): الشاشة مقسومة بخط في المنتصف، العمل الأول على اليمين والثاني على اليسار
  const pickers = document.createElement('div');
  pickers.className = 'wizard-field';
  pickers.innerHTML = '<label class="wizard-label">اختر العملين للمقارنة</label>';
  const split = document.createElement('div');
  split.className = 'compare-split-pickers';
  const makeSide = (caption, idx) => {
    const side = document.createElement('div');
    side.className = 'compare-side';
    const cap = document.createElement('div');
    cap.className = 'compare-side-caption';
    cap.textContent = caption;
    side.appendChild(cap);
    const sel = document.createElement('select');
    sel.className = 'filter-select';
    for (const e of completed) sel.innerHTML += `<option value="${escapeHtml(e.id)}" ${state.selectedForCompare[idx]===e.id?'selected':''}>${escapeHtml(e.name)}</option>`;
    sel.onchange = (e) => { state.selectedForCompare[idx] = e.target.value; render(); };
    side.appendChild(sel);
    return side;
  };
  split.appendChild(makeSide('العمل الأول', 0));
  split.appendChild(makeSide('العمل الثاني', 1));
  pickers.appendChild(split);
  container.appendChild(pickers);

  const evA = state.library.find(e => e.id === state.selectedForCompare[0]);
  const evB = state.library.find(e => e.id === state.selectedForCompare[1]);
  if (!evA || !evB || evA.id === evB.id) return;

  // توضيح نطاق المقارنة (تحسين الفكرة 12) — على النقاط المعدّل (نسبة أداء الفئة من وزنها)
  // لا على النقاط الخام — كي لا تُقرأ الفروق الموزونية كفروق جودة
  // ط9: تاريخ كل تقييم يُعرض في سياق المقارنة (تحسين الفكرة 12، المرجع :2584)
  // التسمية حسب الخطة: «تاريخ التقييم» إن وُجد completedAt، و«تاريخ الحفظ» إن fallback إلى updatedAt، و«—» إن غابا
  const evalDateLine = (ev) => {
    if (ev.completedAt) return `تاريخ التقييم: ${formatDate(ev.completedAt)}`;
    if (ev.updatedAt) return `تاريخ الحفظ: ${formatDate(ev.updatedAt)}`;
    return 'تاريخ التقييم: —';
  };
  const context = document.createElement('div');
  context.className = 'eval-progress compare-context';
  const catsA = getApplicableCards({medium:evA.medium,format:evA.format,relation:evA.relation,nature:evA.nature});
  const catsB = getApplicableCards({medium:evB.medium,format:evB.format,relation:evB.relation,nature:evB.nature});
  const nA = catsA.reduce((s,x)=>s+x.cards.length,0);
  const nB = catsB.reduce((s,x)=>s+x.cards.length,0);
  const sameStructure = evA.medium === evB.medium && evA.format === evB.format && evA.relation === evB.relation;
  // v20 D-4: تكوين غير معروف → أوزان افتراضية لا تُعرض (لا مقارنة بأوزان لم يخترها المستخدم)
  const wA = hasKnownConfig(evA) ? calculateWeights(evA.medium, evA.format, evA.relation) : null;
  const wB = hasKnownConfig(evB) ? calculateWeights(evB.medium, evB.format, evB.relation) : null;
  context.innerHTML = `
    <div class="eval-progress-text">${escapeHtml(evA.name)}: ${lbl(MEDIA, evA.medium)} · ${lbl(FORMATS, evA.format)} · ${lbl(RELATIONS, evA.relation)} · ${nA} بطاقة · ${evalDateLine(evA)}</div>
    <div class="eval-progress-text">${escapeHtml(evB.name)}: ${lbl(MEDIA, evB.medium)} · ${lbl(FORMATS, evB.format)} · ${lbl(RELATIONS, evB.relation)} · ${nB} بطاقة · ${evalDateLine(evB)}</div>
    ${!sameStructure ? '<div class="nature-condition" style="margin-top:var(--space-2)">تنبيه محايد: بنية العملين مختلفة — لا تُقرأ الفروق كأنها أُنتجا بالمعايير نفسها. أوزان العملين مختلفة: ' + (wA ? formatWeightsLine(wA) : 'غير معروف') + ' مقابل ' + (wB ? formatWeightsLine(wB) : 'غير معروف') + '</div>' : ''}
  `;
  container.appendChild(context);

  // النتائج جنبًا إلى جنب — على أداء الفئة (%) لا النقاط الخام (تحسين 12)
  const grid = document.createElement('div');
  grid.className = 'compare-grid';
  // رأس الشبكة: تسميات الأعمدة بالوحدات صراحة
  const headerRow = document.createElement('div');
  headerRow.className = 'compare-row compare-row-head';
  headerRow.innerHTML = `
    <div class="compare-row-label" style="font-weight:700">فئة التقييم</div>
    <div class="compare-row-values"><span class="compare-val" style="font-weight:700">${escapeHtml(evA.name)} (%)</span><span class="compare-val" style="font-weight:700">${escapeHtml(evB.name)} (%)</span></div>
  `;
  grid.appendChild(headerRow);
  const idsA = catsA.map(x=>x.category.id);
  const idsB = catsB.map(x=>x.category.id);
  const allCatIds = [...new Set([...idsA, ...idsB])];

  for (const catId of allCatIds) {
    const inA = idsA.includes(catId);
    const inB = idsB.includes(catId);
    const catName = (CATEGORIES.find(c=>c.id===catId)||{}).name || catId;
    const row = document.createElement('div');
    row.className = 'compare-row';
    const label = document.createElement('div');
    label.className = 'compare-row-label';
    label.textContent = catName + (inA && !inB ? ' (غير مشترك في العمل الثاني)' : '') + (!inA && inB ? ' (غير مشترك في العمل الأول)' : '');
    row.appendChild(label);
    const values = document.createElement('div');
    values.className = 'compare-row-values';
    // الفروق تُعرض على النقاط المعدّلة (نسبة أداء الفئة من وزنها) لا الخام —
    // كي لا تُقرأ الفروق الموزونية كفروق جودة
    const norm = (ev, cs) => {
      if (!cs) return null;
      // v20 D-4: تكوين غير معروف → لا وزن افتراضي
      if (!hasKnownConfig(ev)) return null;
      // الوزن المحفوظ مع التقييم أولًا — المحسوب الحالي احتياط فقط (تحسين 12)
      const w = (ev.weights && ev.weights[catId]) || calculateWeights(ev.medium, ev.format, ev.relation)[catId];
      if (!w) return null;
      return cs.points / w;
    };
    const csA = evA.categoryScores && evA.categoryScores.find(c=>c.categoryId===catId);
    const csB = evB.categoryScores && evB.categoryScores.find(c=>c.categoryId===catId);
    const nA2 = inA ? norm(evA, csA) : null;
    const nB2 = inB ? norm(evB, csB) : null;
    values.innerHTML = `
      <span class="compare-val"><bdi class="compare-number" dir="ltr">${nA2 !== null ? formatRatioPercent(nA2) : '—'}</bdi></span>
      <span class="compare-val"><bdi class="compare-number" dir="ltr">${nB2 !== null ? formatRatioPercent(nB2) : '—'}</bdi></span>
    `;
    row.appendChild(values);
    grid.appendChild(row);
  }
  container.appendChild(grid);

  const finalRow = document.createElement('div');
  finalRow.className = 'compare-final';
  finalRow.innerHTML = `
    <span class="compare-val" style="font-size:var(--text-xs);color:var(--color-text-muted)">النتيجة النهائية / 10</span>
    <span class="compare-val"><bdi class="compare-number" dir="ltr">${formatNumber(evA.totalScore)} / 10</bdi></span>
    <span class="compare-val"><bdi class="compare-number" dir="ltr">${formatNumber(evB.totalScore)} / 10</bdi></span>
  `;
  container.appendChild(finalRow);

  // زر تصدير صورة المقارنة (الفكرة 23)
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-secondary btn-full';
  exportBtn.style.marginTop = 'var(--space-4)';
  exportBtn.textContent = 'تصدير صورة المقارنة';
  exportBtn.onclick = () => exportCompareImage(evA, evB, grid, finalRow);
  container.appendChild(exportBtn);
}

// البند 2 (v25): على iPhone لا يعمل رابط التنزيل (a.download) مع data: خصوصًا في التطبيق المثبّت،
// فلا تُنتَج صورة. الحل: ورقة المشاركة (Web Share بملف) وفيها «حفظ الصورة» إلى المعرض (Photos)؛
// وإن لم تتوفر المشاركة (حاسوب/متصفح قديم) يُستعمل التنزيل القديم. التحويل إلى ملف متزامن
// كي يبقى استدعاء share() داخل لمسة المستخدم (شرط Safari).
function saveCanvasImage(canvas, filename) {
  let dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png')) throw new Error('Invalid PNG');
  } catch (e) {
    showToast('تعذّر إنشاء الصورة؛ حاول مجددًا');
    return;
  }
  const download = () => {
    try {
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();
      showToast('طُلب تنزيل الصورة؛ تحقق من التنزيلات');
    } catch (e) {
      showToast('تعذّر تنزيل الصورة؛ حاول من المتصفح');
    }
  };
  try {
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && typeof File !== 'undefined') {
      const bin = atob(dataUrl.split(',')[1] || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] })
          .then(() => showToast('أُغلقت المشاركة؛ تحقق من حفظ الصورة في الوجهة المختارة'))
          .catch((err) => { if (!err || err.name !== 'AbortError') download(); });
        return;
      }
    }
  } catch (e) { /* ننتقل للتنزيل */ }
  download();
}

function exportCompareImage(evA, evB, grid, finalRow) {
  const canvas = document.createElement('canvas');
  // سياق قياس منفصل (O-3): تغيير canvas.width/height يمسح ما رُسم ويعيد ضبط حالة السياق،
  // لذا لا يُرسم شيء على الكانفس الحقيقي قبل تحديد أبعاده النهائية (كان العنوان وأسماء الأعمدة يُمسحان).
  const mctx = document.createElement('canvas').getContext('2d');
  // v29: صورة أضيق مع خط بالحجم نفسه؛ تقليل المساحة الفارغة بين الفئة وعمودي النسب.
  const W = 720, M = 36, colW = 190, labelW = W - 2 * M - 2 * colW;
  const colPad = 16; // هامش داخلي: لا يلتصق نص عمود بجاره
  const titleText = 'مقارنة: ' + evA.name + ' × ' + evB.name;
  // لفّ النص على حدود الكلمات (لا داخل الكلمة) — يمنع قصّ الحروف ويحفظ قراءة العربية
  const wrapLines = (text, maxW, font) => {
    mctx.font = font;
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (mctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const titleFont = 'bold 26px sans-serif';
  const titleLines = wrapLines(titleText, W - 2 * M, titleFont);
  const rowH = 46;
  const rows = Array.from(grid.children);
  const isHeadRow = (row) => String(row.className || '').indexOf('compare-row-head') !== -1;
  const dataH = rows.reduce((h, row) => {
    const label = row.querySelector('.compare-row-label').textContent;
    return h + wrapLines(label, labelW, '16px sans-serif').length * rowH;
  }, 0);
  // مناطق غير متراكبة (تحسين الفكرة 23): الفئة يمينًا، عمود A، ثم عمود B أقصى اليسار
  const label_X = W - M;
  const colA_X = W - M - labelW - colW + (colW / 2);  // مركز عمود A
  const colB_X = M + (colW / 2);                        // مركز عمود B
  // أسماء الأعمدة تُلفّ داخل عرض العمود وتُوسَّط على مركزه؛ بدء البيانات يُحسب من أسفل أطولها (يمنع التراكب)
  const nameA = wrapLines(evA.name, colW - colPad, 'bold 16px sans-serif');
  const nameB = wrapLines(evB.name, colW - colPad, 'bold 16px sans-serif');
  const headerTop = M + 24 + (titleLines.length - 1) * 34 + 40; // 40px تحت آخر سطر عنوان (لا التصاق)
  const nameBottom = headerTop + Math.max(nameA.length, nameB.length) * 20;
  const dataTop = nameBottom + 16;
  const finalY = dataTop + dataH + 40;
  const H = finalY + 80;
  // الأبعاد النهائية أولًا، ثم الرسم
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0E0817';
  ctx.fillRect(0, 0, W, H);
  ctx.direction = 'rtl'; // اتجاه الرسم من اليمين — يمنع قصّ بداية النص العربي
  // العنوان
  ctx.textAlign = 'right';
  ctx.fillStyle = '#B794F6';
  ctx.font = titleFont;
  let y = M + 24;
  for (const line of titleLines) { ctx.fillText(line, W - M, y); y += 34; }
  // رأس: أسماء العملين فوق عموديهما (موسَّطة)
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#B3A7CC';
  ctx.textAlign = 'center';
  y = headerTop;
  for (const l of nameA) { ctx.fillText(l, colA_X, y); y += 20; }
  y = headerTop;
  for (const l of nameB) { ctx.fillText(l, colB_X, y); y += 20; }
  // صفوف البيانات — النص يُلفّ داخل مساحة الفئة
  y = dataTop;
  // v30: a quiet header band makes category/units visibly different from data.
  ctx.fillStyle = '#181027';
  ctx.fillRect(M, dataTop - 24, W - 2 * M, rowH);
  for (const row of rows) {
    const label = row.querySelector('.compare-row-label').textContent;
    const vals = row.querySelectorAll('.compare-val');
    const lines = wrapLines(label, labelW, '16px sans-serif');
    ctx.font = '16px sans-serif';
    for (const l of lines) {
      ctx.textAlign = 'right';
      ctx.fillStyle = isHeadRow(row) ? '#B3A7CC' : '#F0EAFB';
      ctx.fillText(l, W - M, y); y += rowH;
    }
    // صف الرأس: اسما العملين مرسومان أصلًا فوق العمودين — هنا وحدة القياس فقط (لا تكرار اسم طويل يتراكب)
    const v0 = isHeadRow(row) ? '%' : (vals[0] ? vals[0].textContent : '—');
    const v1 = isHeadRow(row) ? '%' : (vals[1] ? vals[1].textContent : '—');
    const lineY = y - rowH; // نفس خط الأساس لآخر سطر من اسم الفئة (كان أخفض بـ14px)
    ctx.fillStyle = isHeadRow(row) ? '#B3A7CC' : '#B794F6';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(v0, colA_X, lineY);
    ctx.fillText(v1, colB_X, lineY);
  }
  // النتيجة النهائية
  ctx.fillStyle = '#B794F6';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('النتيجة النهائية', label_X, finalY);
  ctx.textAlign = 'center';
  ctx.fillText(formatNumber(evA.totalScore), colA_X, finalY);
  ctx.fillText(formatNumber(evB.totalScore), colB_X, finalY);

  saveCanvasImage(canvas, 'مقارنة-' + evA.name + '-' + evB.name + '.png');
}

// م10: تصدير صورة لنتيجة عمل واحد من شاشة التفاصيل (الفكرة 23، المرجع :2113)
// نفس هندسة exportCompareImage لكن لعمل واحد — يتكامل مع ط10 (أقوى/أضعف فئة مدمجتان في الكانفس)
// ألوان الثيم المطبق: فاتح أو داكن حسب state.theme
function exportResultImage(ev) {
  if (ev.status !== 'completed' || ev.totalScore == null) return;

  const isDark = state.theme === 'dark';
  // ألوان الثيم الفعلية — مأخوذة من متغيرات styles.css نفسها (الفاتح والداكن)
  // light: bg #F8F5FD, text #231A33, muted #5E5373, primary #6D3FC7, surface-2 #F1ECFA, divider #E0D7F0
  // dark:  bg #0E0817, text #F0EAFB, muted #B3A7CC, primary #B794F6, surface-2 #1F1533, divider #2E2147
  const colors = {
    bg:      isDark ? '#0E0817' : '#F8F5FD',
    title:   isDark ? '#B794F6' : '#6D3FC7',
    label:   isDark ? '#F0EAFB' : '#231A33',
    muted:   isDark ? '#B3A7CC' : '#5E5373',
    accent:  isDark ? '#B794F6' : '#6D3FC7',
    grid:    isDark ? '#1F1533' : '#F1ECFA',
    divider: isDark ? '#2E2147' : '#E0D7F0',
  };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const W = 720, M = 36;

  // عمود قيمة ثابت للدرجات (لا يتدخل مع عرض الشريط) — يمنع قصّ النص عند درجات 0 أو منخفضة
  const valW = 76;  // عمود القيمة
  const barAreaW = 360; // أشرطة أقصر، مع إبقاء الخط دون تصغير
  const labelAreaW = W - 2 * M - barAreaW - valW;

  // لف النص (نفس نمط wrapLines من exportCompareImage)
  const wrapLines = (text, maxW, font) => {
    ctx.font = font;
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };

  // ط9/ط10: أقوى/أضعف فئة
  const ext = getExtremes(ev);

  // الارتفاع: العنوان + سطر التكوين + النتيجة النهائية + أقوى/أضعف + صفوف الفئات + حاشية
  const titleText = 'تقييم: ' + ev.name;
  const titleLines = wrapLines(titleText, W - 2 * M, 'bold 26px sans-serif');
  const configText = `${lbl(MEDIA, ev.medium)} — ${lbl(FORMATS, ev.format)} — ${lbl(RELATIONS, ev.relation)}${ev.nature ? ' (' + lbl(NATURES, ev.nature) + ')' : ''}`;
  const configLines = wrapLines(configText, W - 2 * M, '16px sans-serif');
  const extLines = !ext ? [] : (ext.allEqual ? ['الفئات متقاربة'] : [
    `أقوى الفئات: ${ext.top.name} (${formatNumber(ext.top.normalized)}/10)`,
    `أضعف الفئات: ${ext.bottom.name} (${formatNumber(ext.bottom.normalized)}/10)`,
  ]).flatMap(text => wrapLines(text, W - 2 * M, '16px sans-serif'));

  const rowH = 56; // (يُعاد استخدامه أدناه)
  const catsWithScores = (ev.categoryScores || []).map(cs => {
    // الوزن المحفوظ أولًا — المحسوب من التكوين احتياط (نفس نمط renderStats/getExtremes)
    let w = (ev.weights && ev.weights[cs.categoryId]) || null;
    // v20 D-4: تكوين غير معروف → لا وزن افتراضي في صورة التصدير
    if ((!w || w <= 0) && hasKnownConfig(ev)) {
      try { w = calculateWeights(ev.medium, ev.format, ev.relation)[cs.categoryId] || null; } catch (err) { w = null; }
    }
    if (!w || w <= 0) return null;
    const lines = wrapLines(cs.name, labelAreaW, '16px sans-serif');
    return { name: cs.name, lines, height: Math.max(rowH, lines.length * 22 + 24),
      score: Math.min(10, Math.max(0, cs.points / w * 10)) };
  }).filter(Boolean);

  // الارتفاع: العنوان + سطر التكوين + النتيجة النهائية + أقوى/أضعف + صفوف الفئات + حاشية
  const headerH = titleLines.length * 34;
  const configH = configLines.length * 24 + 6;
  const finalH = 80;
  const extH = extLines.length * 28;
  const rowsH = catsWithScores.reduce((sum, cat) => sum + cat.height, 0);
  const H = M + headerH + 16 + configH + 16 + finalH + extH + rowsH + M + 20;
  canvas.width = W;
  canvas.height = H;

  // الخلفية
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  // إعادة ضبط حالة السياق بعد تغيير الأبعاد — إعادة تعيينها تمسح textAlign/direction/font
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';

  let y = M + 24;

  // العنوان — rtl: يُرسم من الحد الأيمن (W-M) مع textAlign='right'
  ctx.fillStyle = colors.title;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  for (const line of titleLines) { ctx.fillText(line, W - M, y); y += 34; }

  // سطر التكوين (وسيط/صيغة/علاقة)
  y += 16;
  ctx.fillStyle = colors.muted;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'right';
  for (const line of configLines) { ctx.fillText(line, W - M, y); y += 24; }
  y += 6;

  // v29: النتيجة بمحاذاة عمود الدرجات وقرب عنوانها؛ الأرقام LTR لمنع قلب «8.8 / 10».
  y += 16;
  ctx.fillStyle = colors.title;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  ctx.fillText('النتيجة النهائية', W - M, y);
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillText(`${formatNumber(ev.totalScore)} / 10`, M + barAreaW + 12, y);
  ctx.direction = 'rtl';
  y += 24;

  // أقوى/أضعف فئة (ط10 — مدمجة في الكانفس) — rtl: من الحد الأيمن
  if (ext) {
    ctx.font = '16px sans-serif';
    ctx.fillStyle = colors.label;
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    for (const line of extLines) {
      ctx.fillText(line, W - M, y);
      y += 28;
    }
  }

  // صفوف الفئات — شريط لكل فئة يمثل نسبة 0–10
  y += 12;
  for (const cat of catsWithScores) {
    // اسم الفئة (يمين، منطقة labelAreaW)
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.label;
    ctx.font = '16px sans-serif';
    const catLines = cat.lines;
    let localY = y + cat.height / 2 - (catLines.length - 1) * 11;
    for (const l of catLines) {
      ctx.fillText(l, W - M, localY);
      localY += 22;
    }
    // الشريط يسار الصورة؛ قيمة ثابتة بين الشريط واسم الفئة.
    const barX = M; // من اليسار
    const barW = (cat.score / 10) * barAreaW;
    ctx.fillStyle = colors.grid;
    const barY = y + (cat.height - 36) / 2;
    ctx.fillRect(barX, barY, barAreaW, 36); // مسار الخلفية (surface-2)
    // إطار مسار الشريط بلون divider لتحديد الحدود
    ctx.strokeStyle = colors.divider;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barAreaW, 36);
    if (barW > 0) {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(barX, barY, barW, 36); // الشريط نفسه
    }
    // الدرجة في عمود ثابت يمين الشريط — نسبة رقمية تُرسم LTR (متجاوزة direction)
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.fillStyle = colors.title;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`${formatNumber(cat.score)}/10`, barX + barAreaW + 12, y + cat.height / 2);
    ctx.direction = 'rtl';
    y += cat.height;
  }

  saveCanvasImage(canvas, 'تقييم-' + ev.name + '.png');
}

// ============================================================
// 14. شاشة الإحصائيات — الفكرة 17 + رسم بياني (13)
// ============================================================

// الفكرة 17 (تحسين اختياري): الأكثر تقييمًا — يعيد أسماء القيم ذات أعلى تكرار (عند التعادل تُذكر كلها) وعدّها
function mostCommonLabels(items, key, labels) {
  const counts = {};
  for (const e of items) { const k = e[key]; if (k && labels[k]) counts[k] = (counts[k] || 0) + 1; }
  const max = Math.max(0, ...Object.values(counts));
  if (!max) return null;
  return { names: Object.keys(counts).filter(k => counts[k] === max).map(k => labels[k]), count: max };
}

function renderStats(container) {
  renderHeader(container, true);
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'إحصائيات شخصية';
  container.appendChild(title);

  const completed = state.library.filter(e => e.status === 'completed');
  const drafts = state.library.filter(e => e.status !== 'completed');

  if (completed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>لا توجد تقييمات مكتملة بعد.</p>';
    container.appendChild(empty);
    return;
  }

  // متوسط النتيجة النهائية
  const avgTotal = completed.reduce((s,e)=>s+(e.totalScore||0),0) / completed.length;
  const kpi1 = document.createElement('div');
  kpi1.className = 'eval-progress';
  kpi1.innerHTML = `<div class="eval-progress-text">متوسط النتيجة النهائية: <strong><bdi class="stats-average-score" dir="ltr">${formatNumber(avgTotal)} / 10</bdi></strong></div>`;
  container.appendChild(kpi1);

  // متوسط كل فئة — على المتوسط المعدّل (نقاط الفئة ÷ وزنها) لا النقاط الخام
  // (النقاط الخام تساهم بأوزان مختلفة — لا يصح مقارنتها كقوة)
  const catAvgs = {};
  const catCount = {};
  for (const e of completed) {
    for (const cs of (e.categoryScores || [])) {
      if (!(cs.categoryId in catAvgs)) { catAvgs[cs.categoryId] = 0; catCount[cs.categoryId] = 0; }
      const w = (e.weights && e.weights[cs.categoryId]) || null;
      // متوسط معدّل: نقاط الفئة مقسومة على وزنها (نسبة أداء 0–1)
      // إن لم يُحفظ الوزن التاريخي، تُحسب من التكوين — v20 D-4: تكوين غير معروف → لا وزن افتراضي
      let weight = w;
      if (!weight && hasKnownConfig(e)) {
        try { weight = calculateWeights(e.medium, e.format, e.relation)[cs.categoryId] || 1; } catch (err) { weight = 1; }
      }
      if (!weight) continue;
      catAvgs[cs.categoryId] += (weight > 0 ? cs.points / weight : 0);
      catCount[cs.categoryId]++;
    }
  }

  const catStats = Object.keys(catAvgs).map(k => ({ id: k, avg: catAvgs[k]/catCount[k], count: catCount[k] }));
  if (catStats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>لا توجد درجات فئات محفوظة بعد.</p>';
    container.appendChild(empty);
    return;
  }
  const sorted = catStats.slice().sort((a,b)=>b.avg-a.avg);

  const strong = sorted[0];
  const weak = sorted[sorted.length-1];
  const catNameOf = (id) => (CATEGORIES.find(c=>c.id===id)||{}).name || id;

  const summary = document.createElement('div');
  summary.className = 'eval-progress';
  summary.innerHTML = `
    <div class="eval-progress-text">أعلى متوسط أداء: <strong>${escapeHtml(catNameOf(strong.id))}</strong> — ${formatRatioPercent(strong.avg)} من وزنها</div>
    <div class="eval-progress-text">أدنى متوسط أداء: <strong>${escapeHtml(catNameOf(weak.id))}</strong> — ${formatRatioPercent(weak.avg)} من وزنها</div>
    <div class="eval-progress-text">تقييمات مكتملة: <strong>${completed.length}</strong> · مسودات: <strong>${drafts.length}</strong></div>
    ${(() => {
      const mm = mostCommonLabels(completed, 'medium', MEDIA), mf = mostCommonLabels(completed, 'format', FORMATS);
      const line = (label, r) => r ? `<div class="eval-progress-text">${label}: <strong>${escapeHtml(r.names.join('، '))}</strong> (${r.count})</div>` : '';
      return line('أكثر وسيط تقيّمه', mm) + line('أكثر صيغة تقيّمها', mf);
    })()}
    <div class="eval-progress-text" style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--color-text-faint)">المتوسط على أداء الفئة بالنسبة إلى وزنها — لا على النقاط الخام — كي لا تعكس الأوزان المختلفة قوة الفئة.</div>
  `;
  container.appendChild(summary);

  // رسم بياني (الفكرة 13) — أعمدة أفقية لكل فئة على متوسط الأداء 0–100%
  const chart = document.createElement('div');
  chart.className = 'stats-chart';
  for (const cs of sorted) {
    const row = document.createElement('div');
    row.className = 'stats-bar-row';
    row.innerHTML = `
      <span class="stats-bar-label">${escapeHtml(catNameOf(cs.id))}</span>
      <span class="stats-bar-track"><span class="stats-bar-fill" style="width:${Math.min(100, cs.avg * 100)}%"></span></span>
      <span class="stats-bar-val">${formatRatioPercent(cs.avg)}</span>
    `;
    chart.appendChild(row);
  }
  container.appendChild(chart);

  // توزيع الدرجات لكل عمل (الفكرة 4) — على بطاقات التكوين الحالي فقط
  const distTitle = document.createElement('div');
  distTitle.className = 'section-title';
  distTitle.textContent = 'توزيع الدرجات لكل عمل';
  distTitle.style.marginTop = 'var(--space-6)';
  container.appendChild(distTitle);

  for (const e of completed) {
    const dist = getScoreDistribution(e);
    const row = document.createElement('div');
    row.className = 'stats-bar-row';
    row.innerHTML = `
      <span class="stats-bar-label">${escapeHtml(e.name)}</span>
      <span class="stats-bar-val" style="text-align:left;font-variant-numeric:tabular-nums">4:${dist[4]} · 3:${dist[3]} · 2:${dist[2]} · 1:${dist[1]} · 0:${dist[0]}</span>
    `;
    container.appendChild(row);
  }
}

// ============================================================
// 15. شاشة القوائم المنتقاة — الفكرة 15 + تحسين (ترتيب تحريري)
// ============================================================

// البند 4 (v26): صف عمل موحّد للقوائم والمظلات — اسم العمل بوضوح، وسيطه وصيغته، ودرجته (أو «غير مكتمل») على الطرف.
// لا درجة مجمعة هنا: كل عمل يعرض درجته الخاصة فقط (الفكرة 29). النصوص كلها عبر textContent.
function buildWorkRow(ev, titleText, tagText) {
  const row = document.createElement('div');
  row.className = 'work-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.onclick = () => openDetails(ev.id);
  row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(ev.id); } };

  const main = document.createElement('div');
  main.className = 'work-row-main';
  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'work-row-tag';
    tag.textContent = tagText;
    main.appendChild(tag);
  }
  const title = document.createElement('div');
  title.className = 'work-row-title';
  title.textContent = titleText;
  main.appendChild(title);
  const metaBits = [];
  if (ev.medium) metaBits.push(lbl(MEDIA, ev.medium));
  if (ev.format) metaBits.push(lbl(FORMATS, ev.format));
  if (metaBits.length) {
    const meta = document.createElement('div');
    meta.className = 'work-row-meta';
    meta.textContent = metaBits.join(' · ');
    main.appendChild(meta);
  }
  row.appendChild(main);

  const score = document.createElement('div');
  if (ev.status === 'completed' && ev.totalScore != null) {
    score.className = 'work-row-score';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = formatNumber(ev.totalScore);
    const max = document.createElement('span');
    max.className = 'max';
    max.textContent = '/ 10';
    score.appendChild(num);
    score.appendChild(max);
  } else {
    score.className = 'work-row-score pending';
    score.textContent = 'غير مكتمل';
  }
  row.appendChild(score);
  return row;
}

// رأس بطاقة المجموعة: الاسم، ثم الوصف إن وُجد، ثم شريحة العدّ
function buildCollectionHead(card, nameText, descText, countText) {
  const name = document.createElement('div');
  name.className = 'card-name collection-name';
  name.textContent = nameText;
  card.appendChild(name);
  if (descText) {
    const desc = document.createElement('div');
    desc.className = 'collection-desc';
    desc.textContent = descText;
    card.appendChild(desc);
  }
  const meta = document.createElement('div');
  meta.className = 'collection-count';
  meta.textContent = countText;
  card.appendChild(meta);
}

function renderLists(container) {
  renderHeader(container, true);
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'القوائم المنتقاة';
  container.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'screen-sub';
  sub.textContent = 'رتّب أعمالك بترتيب تحريري تختاره، مثل «أفضل عشرة أعمال». اضغط أي عمل لفتح تفاصيله.';
  container.appendChild(sub);

  // زر إضافة قائمة
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-full';
  addBtn.style.marginBottom = 'var(--space-4)';
  addBtn.textContent = 'قائمة جديدة';
  addBtn.onclick = () => showListForm(null);
  container.appendChild(addBtn);

  if (!state.lists || state.lists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>لا توجد قوائم بعد. أنشئ قائمة تجمع أعمالك بترتيب تحريري.</p>';
    container.appendChild(empty);
    return;
  }

  for (const list of state.lists) {
    const card = document.createElement('div');
    card.className = 'card collection-card';
    card.style.marginBottom = 'var(--space-3)';

    // إصلاح ط4: العدّ والترقيم من الأعمال الموجودة فعلًا فقط
    const validItems = (Array.isArray(list.items) ? list.items : []).filter(id => state.library.some(e => e.id === id));
    const cnt = validItems.length;
    buildCollectionHead(card, list.name, list.description, `${cnt} عملًا`);

    // عرض الأعمال بالترتيب — مع أزرار ترتيب تحريري (↑ ↓)
    const listEl = document.createElement('div');
    listEl.className = 'work-rows';
    const moveItem = (listId, idx, dir) => {
      const l = state.lists.find(x => x.id === listId);
      if (!l || !Array.isArray(l.items)) return;
      // الترتيب على العناصر الموجودة فقط (يُسقط أي معرّف معلّق أثناء الحفظ)
      const base = l.items.filter(id => state.library.some(e => e.id === id));
      const target = idx + dir;
      if (target < 0 || target >= base.length) return;
      const items = base.slice();
      [items[idx], items[target]] = [items[target], items[idx]];
      l.items = items;
      saveLists();
      render();
    };
    if (cnt === 0) {
      const none = document.createElement('div');
      none.className = 'collection-empty';
      none.textContent = 'القائمة فارغة — اضغط «تعديل القائمة» لإضافة أعمال.';
      listEl.appendChild(none);
    }
    for (const [i, itemId] of validItems.entries()) {
      const ev = state.library.find(e => e.id === itemId);
      if (!ev) continue;
      const wrap = document.createElement('div');
      wrap.className = 'work-row-wrap';
      wrap.appendChild(buildWorkRow(ev, `${i+1}. ${ev.name}`, null));

      const moves = document.createElement('div');
      moves.className = 'work-row-moves';
      const upBtn = document.createElement('button');
      upBtn.className = 'btn btn-secondary move-btn';
      upBtn.type = 'button';
      upBtn.textContent = '↑';
      upBtn.title = 'نقل للأعلى';
      upBtn.setAttribute('aria-label', 'نقل للأعلى');
      upBtn.disabled = i === 0;
      upBtn.onclick = (e) => { e.stopPropagation(); moveItem(list.id, i, -1); };
      moves.appendChild(upBtn);
      const downBtn = document.createElement('button');
      downBtn.className = 'btn btn-secondary move-btn';
      downBtn.type = 'button';
      downBtn.textContent = '↓';
      downBtn.title = 'نقل للأسفل';
      downBtn.setAttribute('aria-label', 'نقل للأسفل');
      downBtn.disabled = i === validItems.length - 1;
      downBtn.onclick = (e) => { e.stopPropagation(); moveItem(list.id, i, +1); };
      moves.appendChild(downBtn);
      wrap.appendChild(moves);
      listEl.appendChild(wrap);
    }
    card.appendChild(listEl);

    const actions = document.createElement('div');
    actions.className = 'collection-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'تعديل القائمة';
    editBtn.onclick = () => showListForm(list);
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'حذف القائمة';
    delBtn.onclick = () => {
      showConfirm('حذف القائمة', `هل أنت متأكد من حذف "${list.name}"؟`, () => {
        state.lists = state.lists.filter(l => l.id !== list.id);
        saveLists();
        render();
      });
    };
    actions.appendChild(delBtn);
    card.appendChild(actions);

    container.appendChild(card);
  }
}

function showListForm(list) {
  const isNew = !list;
  const name = isNew ? '' : list.name;
  const desc = isNew ? '' : (list.description || '');
  const items = isNew ? [] : (list.items || []);

  const formHTML = `
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label">اسم القائمة</label>
        <input class="form-input" type="text" id="list-name" value="${escapeHtml(name)}" placeholder="مثال: أفضل عشرة أعمال" />
      </div>
      <div class="form-field">
        <label class="form-label">وصف (اختياري)</label>
        <input class="form-input" type="text" id="list-desc" value="${escapeHtml(desc)}" />
      </div>
      <div class="form-field">
        <label class="form-label">اختر الأعمال — يُحدّد الترتيب بالسهمين داخل القائمة النهائية</label>
        <div class="wizard-options" id="list-items">
          ${state.library.map(e => `
            <label style="display:flex;gap:var(--space-2);align-items:center;padding:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-md)">
              <input type="checkbox" value="${escapeHtml(e.id)}" ${items.includes(e.id)?'checked':''}>
              <span>${escapeHtml(e.name)}</span>
            </label>
          `).join('')}
        </div>
        <p style="font-size:var(--text-xs);color:var(--color-text-faint)">حدّد الأعمال، ويمكنك إعادة ترتيبها لاحقًا بأزرار ↑ ↓ في القائمة بعد الحفظ.</p>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="list-save">حفظ</button>
      <button class="btn btn-secondary" id="list-cancel">إلغاء</button>
    </div>
  `;
  showModal(isNew ? 'قائمة جديدة' : 'تعديل القائمة', formHTML);

  document.getElementById('list-cancel').onclick = hideModal;
  document.getElementById('list-save').onclick = () => {
    const nm = document.getElementById('list-name').value.trim();
    if (!nm) { showToast('اكتب اسم القائمة'); return; }
    // v19 B-15: منع تكرار اسم القائمة
    if (state.lists.some(l => l.id !== (isNew ? null : list.id) && (l.name || '').trim() === nm)) { showToast('اسم القائمة مكرر'); return; }
    const dc = document.getElementById('list-desc').value.trim();
    // ترتيب تحريري: أولًا الترتيب المحفوظ سابقًا، ثم الإضافات الجديدة بحسب ترتيب الظهور
    const checked = Array.from(document.querySelectorAll('#list-items input:checked')).map(i=>i.value);
    const ordered = checked.slice().sort((x, y) => {
      const ix = items.indexOf(x); const iy = items.indexOf(y);
      return (ix === -1 ? items.length + checked.indexOf(x) : ix) - (iy === -1 ? items.length + checked.indexOf(y) : iy);
    });
    const newList = { id: isNew ? generateUUID() : list.id, name: nm, description: dc, items: ordered };
    if (isNew) state.lists.push(newList);
    else {
      const idx = state.lists.findIndex(l => l.id === list.id);
      state.lists[idx] = newList;
    }
    saveLists();
    hideModal();
    render();
  };
}

// ============================================================
// 16. شاشة المظلات — الفكرة 29 (تجميع الأجزاء)
// ============================================================

function umbrellaPartsCountText(n) {
  if (n === 1) return 'جزء واحد';
  if (n === 2) return 'جزءان';
  if (n >= 3 && n <= 10) return `${n} أجزاء`;
  return `${n} جزءًا`;
}

function renderUmbrellas(container) {
  renderHeader(container, true);
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'مظلات تجميع الأجزاء';
  container.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'screen-sub';
  sub.textContent = 'اجمع أجزاء المسلسل أو السلسلة تحت عنوان واحد، وشاهد درجة كل جزء بجانب اسمه. اضغط أي جزء لفتح تفاصيله.';
  container.appendChild(sub);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-full';
  addBtn.style.marginBottom = 'var(--space-4)';
  addBtn.textContent = 'مظلة جديدة';
  addBtn.onclick = () => showUmbrellaForm(null);
  container.appendChild(addBtn);

  if (!state.umbrellas || state.umbrellas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>لا توجد مظلات بعد. أنشئ مظلة تجمع تقييمات أجزاء مسلسل أو سلسلة أفلام تحت عنوان واحد.</p>';
    container.appendChild(empty);
    return;
  }

  for (const u of state.umbrellas) {
    const card = document.createElement('div');
    card.className = 'card collection-card';
    card.style.marginBottom = 'var(--space-3)';

    const parts = Array.isArray(u.parts) ? u.parts : [];
    // إصلاح ط4: الأجزاء التي تشير لأعمال محذوفة لا تُعرض — وإن لم يبقَ شيء تُعرض رسالة صريحة لا قائمة فارغة صامتة
    const visibleParts = parts.filter(p => p && state.library.some(e => e.id === p.evalId));
    const doneCount = visibleParts.filter(p => {
      const ev = state.library.find(e => e.id === p.evalId);
      return ev && ev.status === 'completed' && ev.totalScore != null;
    }).length;
    let countText = umbrellaPartsCountText(visibleParts.length);
    if (visibleParts.length > 0) countText += ` · ${doneCount} من ${visibleParts.length} مكتمل`;
    buildCollectionHead(card, u.name, null, countText);

    const listEl = document.createElement('div');
    listEl.className = 'work-rows';
    if (parts.length === 0) {
      const noParts = document.createElement('div');
      noParts.className = 'collection-empty';
      noParts.textContent = 'لا أجزاء مضافة للمظلة بعد';
      listEl.appendChild(noParts);
    } else if (visibleParts.length === 0) {
      const gone = document.createElement('div');
      gone.className = 'collection-empty';
      gone.textContent = 'كل الأعمال التي تجمعها هذه المظلة محذوفة — عدّل المظلة لإضافة أجزاء';
      listEl.appendChild(gone);
    }
    for (const part of visibleParts) {
      const ev = state.library.find(e => e.id === part.evalId);
      if (!ev) continue;
      const tag = `${part.type || 'جزء'} ${part.number || ''}`.trim();
      listEl.appendChild(buildWorkRow(ev, ev.name, tag));
    }
    card.appendChild(listEl);

    // تنبيه: لا درجة مجمعة تلقائيًا (الفكرة 29) — سطر هادئ صغير
    const notice = document.createElement('div');
    notice.className = 'collection-note';
    notice.textContent = 'لا تُنشئ المظلة درجة مجمعة تلقائيًا ولا تُقارن الأجزاء إلا بأمر صريح.';
    card.appendChild(notice);

    const actions = document.createElement('div');
    actions.className = 'collection-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'تعديل المظلة';
    editBtn.onclick = () => showUmbrellaForm(u);
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'حذف المظلة';
    delBtn.onclick = () => {
      showConfirm('حذف المظلة', `هل أنت متأكد من حذف "${u.name}"؟`, () => {
        state.umbrellas = state.umbrellas.filter(x => x.id !== u.id);
        saveUmbrellas();
        render();
      });
    };
    actions.appendChild(delBtn);
    card.appendChild(actions);

    container.appendChild(card);
  }
}

function showUmbrellaForm(u) {
  const isNew = !u;
  const formHTML = `
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label">اسم المظلة</label>
        <input class="form-input" type="text" id="um-name" value="${isNew ? '' : escapeHtml(u.name)}" placeholder="مثال: مسلسل X — المواسم" />
      </div>
      <div class="form-field">
        <label class="form-label">الأجزاء</label>
        <div id="um-parts">
          ${(isNew || !Array.isArray(u.parts) ? [] : u.parts).filter(p => p && typeof p === 'object').map((p, i) => `
            <div class="form-field" style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3)">
              <div style="display:flex;gap:var(--space-2)">
                <input class="form-input" type="text" id="um-type-${i}" value="${escapeHtml(p.type||'')}" placeholder="النوع (موسم/جزء)" style="flex:1;min-width:0">
                <input class="form-input" type="text" id="um-num-${i}" value="${escapeHtml(String(p.number||''))}" placeholder="الرقم" style="width:80px">
              </div>
              <div style="display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-2)">
                <select class="form-input" id="um-ev-${i}" style="flex:1;min-width:0">
                  <option value="">اختر التقييم</option>
                  ${state.library.map(e => `<option value="${escapeHtml(e.id)}" ${p.evalId===e.id?'selected':''}>${escapeHtml(e.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary um-move" data-dir="up" type="button" aria-label="نقل الجزء للأعلى" style="min-width:44px;min-height:44px">↑</button>
                <button class="btn btn-secondary um-move" data-dir="down" type="button" aria-label="نقل الجزء للأسفل" style="min-width:44px;min-height:44px">↓</button>
                <button class="btn btn-danger" data-del="${i}" type="button" aria-label="حذف الجزء" style="min-width:44px;min-height:44px">×</button>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-secondary" id="um-add-part" type="button" style="margin-top:var(--space-2)">+ إضافة جزء</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="um-save">حفظ</button>
      <button class="btn btn-secondary" id="um-cancel">إلغاء</button>
    </div>
  `;
  showModal(isNew ? 'مظلة جديدة' : 'تعديل المظلة', formHTML);

  document.getElementById('um-cancel').onclick = hideModal;
  document.getElementById('um-add-part').onclick = () => {
    const partsDiv = document.getElementById('um-parts');
    const i = partsDiv.children.length;
    const div = document.createElement('div');
    div.className = 'form-field';
    div.style.cssText = 'border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3)';
    div.innerHTML = `
      <div style="display:flex;gap:var(--space-2)">
        <input class="form-input" type="text" id="um-type-${i}" placeholder="النوع" style="flex:1;min-width:0">
        <input class="form-input" type="text" id="um-num-${i}" placeholder="الرقم" style="width:80px">
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-2)">
        <select class="form-input" id="um-ev-${i}" style="flex:1;min-width:0">
          <option value="">اختر التقييم</option>
          ${state.library.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary um-move" data-dir="up" type="button" aria-label="نقل الجزء للأعلى" style="min-width:44px;min-height:44px">↑</button>
        <button class="btn btn-secondary um-move" data-dir="down" type="button" aria-label="نقل الجزء للأسفل" style="min-width:44px;min-height:44px">↓</button>
        <button class="btn btn-danger um-del" type="button" aria-label="حذف الجزء" style="min-width:44px;min-height:44px">×</button>
      </div>
    `;
    partsDiv.appendChild(div);
  };
  // ترتيب الأجزاء يدويًا (الفكرة 29): ↑↓ — الحفظ يقرأ ترتيب العناصر في DOM
  // v20 M-5: حذف الأجزاء صار بمعالج مفوَّض (لا onclick سطري) — يمكّن CSP صارمًا مستقبلًا
  document.getElementById('um-parts').addEventListener('click', (e) => {
    const del = e.target.closest && e.target.closest('.um-del');
    if (del) { del.closest('.form-field').remove(); return; }
    const btn = e.target.closest && e.target.closest('.um-move');
    if (!btn) return;
    const row = btn.closest('.form-field');
    if (!row) return;
    if (btn.dataset.dir === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    else if (btn.dataset.dir === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
  });
  // حذف الأجزاء الموجودة
  for (const btn of document.querySelectorAll('[data-del]')) {
    btn.onclick = () => btn.closest('.form-field').remove();
  }

  document.getElementById('um-save').onclick = () => {
    const nm = document.getElementById('um-name').value.trim();
    if (!nm) { showToast('اكتب اسم المظلة'); return; }
    // v19 B-15: منع تكرار اسم المظلة
    if ((state.umbrellas || []).some(x => x.id !== (isNew ? null : u.id) && (x.name || '').trim() === nm)) { showToast('اسم المظلة مكرر'); return; }
    const partsDiv = document.getElementById('um-parts');
    const parts = [];
    for (const child of partsDiv.children) {
      const typeEl = child.querySelector('[id^="um-type-"]');
      const numEl = child.querySelector('[id^="um-num-"]');
      const evEl = child.querySelector('[id^="um-ev-"]');
      if (evEl && evEl.value) parts.push({ type: typeEl ? typeEl.value : '', number: numEl ? numEl.value : '', evalId: evEl.value });
    }
    const newU = { id: isNew ? generateUUID() : u.id, name: nm, parts };
    if (isNew) state.umbrellas.push(newU);
    else {
      const idx = state.umbrellas.findIndex(x => x.id === u.id);
      state.umbrellas[idx] = newU;
    }
    saveUmbrellas();
    hideModal();
    render();
  };
}

// --- تحديثات عامل الخدمة: بانر «إصدار جديد» (م7) ---
// لا إعادة تحميل تلقائية: الإصدار الجديد ينتظر (waiting) حتى ينقر المستخدم البانر فيُرسَل SKIP_WAITING.
let _swUserRequestedUpdate = false;
let _swReloading = false;

function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.onclick = () => {
    _swUserRequestedUpdate = true;
    banner.disabled = true;
    try { worker.postMessage('SKIP_WAITING'); } catch (e) { _swUserRequestedUpdate = false; banner.disabled = false; }
  };
  banner.classList.remove('hidden');
}

function watchServiceWorkerUpdates(reg) {
  const hasController = () => !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  // عامل ينتظر منذ زيارة سابقة
  if (reg.waiting && hasController()) showUpdateBanner(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener('statechange', () => {
      // 'installed' + وجود متحكم حالي = تحديث لا تثبيت أول (في التثبيت الأول لا بانر)
      if (nw.state === 'installed' && hasController()) showUpdateBanner(nw);
    });
  });
}

function registerServiceWorker() {
  if (!navigator.serviceWorker) return Promise.resolve(null);
  // إعادة التحميل فقط بعد نقر المستخدم (controllerchange يُطلَق أيضًا عند clients.claim في التثبيت الأول)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!_swUserRequestedUpdate || _swReloading) return;
    _swReloading = true;
    location.reload();
  });
  // O-2: do not reuse a long-lived HTTP-cache copy during worker update checks.
  return navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    watchServiceWorkerUpdates(reg);
    // تطبيق مثبّت يبقى مفتوحًا أيامًا: افحص التحديث عند العودة إليه
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }
    return reg;
  }).catch(() => null);
}

// --- البدء ---
init();
// v20 M-5: تسجيل عامل الخدمة عند اكتمال التحميل — كان سكربتًا سطريًا في index.html يمنعه CSP
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', function () { registerServiceWorker(); });
} else if (typeof addEventListener === 'function') {
  addEventListener('load', function () { registerServiceWorker(); });
}
