// sw.js

// [每次更新一定要改這裡]
const CACHE_NAME = 'tpass-app-v3.2'; // 改個版本號測試看看

const ASSETS_TO_CACHE = [
    // ... (您的檔案列表保持不變) ...
    './',
    './index.html',
    './app.html',
    './admin.html',
    './analysis.html',
    './import.html',
    './trans-rule.html',
    './css/style.css',
    './css/intro.css',
    './css/admin.css',
    './css/analysis.css',
    './js/script.js',
    './js/analysis.js',
    './js/intro.js',
    './js/import.js',
    './js/pwa-update.js',
    './js/firebase-config.js',
    './js/auth.js',
    './js/admin.js',
    './js/data/stations.js',
    './js/data/fares.js',
    './images/icon.png',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    // ❌ 絕對不要加 self.skipWaiting() 在這裡！
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cache) => {
                        if (cache !== CACHE_NAME) {
                            return caches.delete(cache);
                        }
                    })
                );
            }),
            self.clients.claim() // ✅ 這行一定要有
        ])
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting(); // ✅ 這裡才執行 skipWaiting
    }
});