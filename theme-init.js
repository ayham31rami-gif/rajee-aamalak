// v20 M-4: تهيئة الثيم مبكرًا (قبل تحميل app.js) — نفس منطق initTheme تمامًا:
// القيمة المحفوظة في localStorage مفتاح «eval_theme» أولًا، ثم تفضيل النظام (dark افتراضيًا).
// ملف خارجي ليتوافق مع CSP الصارم (script-src 'self') — يمنع وميض الخلفية وشريط العنوان
// في الوضع الفاتح قبل تحميل app.js. عند غياب الواجهات (مثل بيئة اختبار) يُتجاهل بصمت.
(function () {
  try {
    var pref = null;
    try { pref = localStorage.getItem('eval_theme'); } catch (e) {}
    var theme = pref || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0E0817' : '#F8F5FD');
  } catch (e) {}
})();
