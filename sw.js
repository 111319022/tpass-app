// sw.js

// [重要] 每次發布新版時，請務必修改這裡的版本號
const CACHE_NAME = 'tpass-app-v3.9'; 

// 完整的快取清單
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './app.html',        
    './admin.html',      
    './analysis.html',   
    './import.html',     
    './trans-rule.html', 
    
    // CSS
    './css/style.css',
    './css/intro.css',
    './css/admin.css',    
    './css/analysis.css', 

    // JS
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

    // Images
    './images/icon.png',
    './manifest.json'
];

// 1. 安裝：只下載檔案，不強制接管
self.addEventListener('install', (event) => {
    // ❌ [移除這行] self.skipWaiting(); 
    // 我們不希望自動接管，要等使用者點擊按鈕才接管

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. 啟動：清除舊快取 + 接管頁面
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // 清除舊快取
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cache) => {
                        if (cache !== CACHE_NAME) {
                            return caches.delete(cache);
                        }
                    })
                );
            }),
            // 讓新版 SW 啟動後立刻接管當前頁面 (這是在使用者按了更新按鈕之後才會發生)
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

// 4. [關鍵] 監聽 skipWaiting 指令
// 只有當使用者點擊 UI 上的按鈕，發送這個訊息時，才執行 skipWaiting
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});