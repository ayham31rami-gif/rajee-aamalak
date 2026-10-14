// عامل خدمة لنظام تقييم الأعمال الفنية — العمل دون اتصال (الفكرة 31)
// إصدار الكاش: v30 — صقل البطاقات والتنقل والأرقام والمقارنة؛ لا تغيير لمفاتيح المكتبة أو حساب الدرجات.
// الاستراتيجية (قرار محسوم): «الكاش أولًا + بانر تحديث» — لا تحويل إلى الشبكة أولًا.
const CACHE_NAME = 'eval-v2-cache-v30';
// v20 B-08: كاش مؤقت للتحديث الخلفي — يُحذف عند تنشيط إصدار جديد (لا يُخدَم منه أبدًا)
const UPDATE_CACHE = 'eval-v2-update-tmp-v30';
// v20 B-09: كاش الخطوط منفصل ولا يُحذف عند رفع رقم الإصدار (الخطوط لا تتغير مع الكود)
const FONT_CACHE = 'eval-v2-fonts-v1';  // ثابت عبر الإصدارات — لا يُحذف عند الترقية
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
// v20 B-09: الخطوط السبعة انتقلت من CORE_ASSETS إلى FONT_ASSETS — كاش مستقل لا يُحذف عند رفع رقم الإصدار.
// كانت الخطوط داخل CORE_ASSETS تُحذف ويُعاد تنزيلها (204 KB) مع كل رفع إصدار.
const CORE_ASSETS = [
  './',
  'index.html',
  'theme-init.js',  // v20 M-4: تهيئة الثيم مبكرًا (ملف خارجي — يواكف CSP)
  'styles.css',
  'app.js',
  'system-data.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
];
const FONT_ASSETS = [
  'fonts/cairo-400.woff2',
  'fonts/cairo-500.woff2',
  'fonts/cairo-600.woff2',
  'fonts/cairo-700.woff2',
  'fonts/tajawal-400.woff2',
  'fonts/tajawal-500.woff2',
  'fonts/tajawal-700.woff2',
];

self.addEventListener('install', (e) => {
  // م8(ب): cache:'reload' يتخطى كاش HTTP الافتراضي فلا يُخزَّن ملف قديم داخل كاش جديد.
  // addAll ترفض الاستجابات غير الناجحة (404/5xx) فيفشل التثبيت بدل تخزين نسخة معطوبة.
  // لا skipWaiting هنا: الإصدار الجديد ينتظر نقرة المستخدم على البانر (م7) — راجع مستمع message.
  // v20 B-09: الخطوط تُخزَّن في FONT_CACHE المستقل — يُفحص كل خط قبل تنزيله؛ الترقيات التالية
  // تجد الخطوط موجودة فلا يُعاد تنزيل 204 KB مع كل رفع إصدار (كان `addAll` يعيد تنزيلها كل مرة).
  e.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME)
        .then((c) => Promise.all(CORE_ASSETS.map(async (u) => {
          const req = new Request(u, { cache: 'reload' });
          const res = await fetch(req);
          if (!res) throw new Error('no response: ' + u);
          if (res.redirected) {
            // iPhone-FIX: /index.html يعيد توجيه 308 إلى الجذر؛ تخزين إعادة التوجيه يمنع العمل دون اتصال
            // لأن Safari يرفض خدمة redirect من عامل الخدمة. نخزّن الاستجابة النهائية تحت المفتاح الأصلي.
            const final = await fetch(new Request(res.url || u, { cache: 'reload' }));
            if (!final || !final.ok) throw new Error('redirect follow failed: ' + u);
            await c.put(req, final.clone());
          } else {
            if (!res.ok) throw new Error('install fetch failed: ' + u);
            await c.put(req, res.clone());
          }
        }))),
      caches.open(FONT_CACHE).then((fc) =>
        Promise.all(FONT_ASSETS.map(async (u) => {
          const hit = await fc.match(u);
          if (hit) return; // موجود بالفعل — لا تنزيل
          const res = await fetch(new Request(u, { cache: 'reload' }));
          if (!res.ok) throw new Error('font fetch failed: ' + u);
          await fc.put(u, res.clone());
        }))
      ),
    ])
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING' || (e.data && e.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== FONT_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // v20 B-09: الخطوط المضمّنة (نفس أصل التطبيق) تُخدم من FONT_CACHE — كاش أولًا ثم الشبكة.
  // لا يُخزَّن إلا الناجح (res.ok). الترقيات لا تحذفها فلا يُعاد تنزيل 204 KB مع كل رفع إصدار.
  if (url.origin === location.origin && url.pathname.indexOf('/fonts/') !== -1 && FONT_ASSETS.some(fa => url.pathname.endsWith(fa.replace('fonts/', '')))) {
    e.respondWith(
      caches.open(FONT_CACHE).then((fc) =>
        fc.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.ok) fc.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // خطوط Google: كاش أولًا ثم الشبكة؛ لا يُخزَّن إلا الناجح (res.ok — يتطلب طلب CORS)
  if (url.origin !== location.origin) {
    if (FONT_HOSTS.indexOf(url.hostname) === -1) return; // أي أصل آخر: تمرير للشبكة كما هو
    e.respondWith(
      caches.open(FONT_CACHE).then((fc) =>
        fc.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.ok) fc.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // v20 B-08: الكاش أولًا فقط — لا تحديث خلفي. كانت `caches.match` تبحث في كل الكاشات (بما فيها
  // الكاش المؤقت) فكان يمكن خدمة أصول جديدة خلف البانر، والكتابة في CACHE_NAME نفسه تنقض
  // «الإصدار الجديد ينتظر نقرة المستخدم» ويمكن أن تخلط app.js جديد مع system-data.js قديم.
  // الآن: البحث في CACHE_NAME الحالي تحديدًا؛ أي تنزيل جديد يحدث فقط أثناء تثبيت عامل الإصدار الجديد.
  e.respondWith(
    caches.open(CACHE_NAME).then((c) =>
      c.match(req, { ignoreSearch: true }).then((cached) =>
        cached || fetch(req).catch(() => (req.mode === 'navigate' ? c.match('index.html') : undefined) || Response.error())
      )
    )
  );
});
