# 🏛️ بنك المعلومات - دليل الرفع على Firebase

## هيكل المشروع

```
bank-almaloomat/
├── public/
│   ├── index.html     ← الصفحة الرئيسية
│   ├── style.css      ← جميع الأنماط والتصميم
│   └── script.js      ← جميع منطق اللعبة
│
├── firebase.json      ← إعدادات Firebase Hosting
├── .firebaserc        ← ربط المشروع (bank-almaloomat-game)
├── .firebaseignore    ← ⭐ استبعاد node_modules وغيرها
└── README.md          ← هذا الملف
```

## خطوات الرفع على Firebase

### 1. تثبيت Firebase CLI (مرة واحدة فقط)
```bash
npm install -g firebase-tools
```

### 2. تسجيل الدخول
```bash
firebase login
```

### 3. الرفع 🚀
```bash
firebase deploy
```

## ملاحظات مهمة

- **مشكلة الـ 174,000 ملف** محلولة الآن بفضل ملف `.firebaseignore`
- عند الرفع سيتم نقل **3 ملفات فقط** من مجلد `public/`
- لا تحتاج لـ `npm install` لأن المشروع **Vanilla JS** بدون مكتبات خارجية

## مميزات النسخة المحسّنة

- ✅ خط Tajawal العربي الأجمل من Google Fonts
- ✅ كود منظم في ملفات منفصلة (HTML / CSS / JS)
- ✅ تصميم متجاوب (Responsive) للجوال
- ✅ تعليقات واضحة في كل ملف
- ✅ جاهز للرفع مباشرة بـ `firebase deploy`
