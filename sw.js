// sw.js

// [重要] 每次發布新版時，請修改這裡的版本號 (例如: v1 -> v2)
const CACHE_NAME = 'tpass-app-v2.1';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './app.html',
    './analysis.html',
    './import.html',
    './css/style.css',
    './css/intro.css',
    './js/script.js',
    './js/analysis.js',
    './js/intro.js',
    './js/import.js',
    './js/firebase-config.js',
    './js/auth.js',
    './js/data/stations.js',
    './js/data/fares.js',
    './images/icon.png',
    './manifest.json'
];

// 安裝 Service Worker 並快取資源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 啟動 Service Worker 並清除舊快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

// 攔截請求：有快取讀快取，沒快取讀網路
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

// [核心] 監聽 skipWaiting 指令，強制讓新版 Service Worker 接管
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});