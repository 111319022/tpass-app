// sw.js

// [重要] 每次發布新版時，請務必修改這裡的版本號 (例如: v3.0 -> v3.1)
// 這樣使用者的手機才會知道有新檔案要下載
const CACHE_NAME = 'tpass-app-v3.0'; 

// 完整的快取清單
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './app.html',        // 主程式頁面
    './admin.html',      // [新增] 後台
    './analysis.html',   // [新增] 分析頁
    './import.html',     // [新增] 匯入頁
    './trans-rule.html', // [新增] 規則說明頁
    
    // CSS 樣式表
    './css/style.css',
    './css/intro.css',
    './css/admin.css',    // [新增]
    './css/analysis.css', // [新增]

    // JavaScript 邏輯
    './js/script.js',
    './js/analysis.js',
    './js/intro.js',
    './js/import.js',
    './js/pwa-update.js',
    './js/firebase-config.js',
    './js/auth.js',
    './js/admin.js',      // [新增]
    './js/data/stations.js',
    './js/data/fares.js',

    // 資源檔
    './images/icon.png',
    './manifest.json'
];

// 1. 安裝：下載並快取檔案
self.addEventListener('install', (event) => {
    // 強制新的 Service Worker 立刻進入 waiting 狀態
    self.skipWaiting(); 
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. 啟動：清除舊快取 + [關鍵] 接管頁面
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // 清除舊版本的快取
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cache) => {
                        if (cache !== CACHE_NAME) {
                            console.log('[SW] 清除舊快取:', cache);
                            return caches.delete(cache);
                        }
                    })
                );
            }),
            // [關鍵] 讓新版 SW 立刻接管當前頁面，讓重整後能馬上讀到新檔案
            self.clients.claim() 
        ])
    );
});

// 3. 攔截請求
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

// 4. 監聽 skipWaiting 指令
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});