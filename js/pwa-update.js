// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        
        // 註冊 SW
        navigator.serviceWorker.register('./sw.js').then((registration) => {
            console.log('[PWA] Service Worker 註冊成功');

            // ==========================================
            // 策略 1: 啟動時，強制立刻檢查
            // ==========================================
            registration.update();

            // ==========================================
            // 策略 2: 偵測「等待中」的 SW (上次下載好但沒更新的)
            // ==========================================
            if (registration.waiting) {
                console.log('[PWA] 發現已下載好的新版 (Waiting)');
                showUpdateNotification(registration.waiting);
            }

            // ==========================================
            // 策略 3: 監聽是否有新版本正在下載
            // ==========================================
            registration.onupdatefound = () => {
                const newWorker = registration.installing;
                
                newWorker.onstatechange = () => {
                    // 當新版本狀態變為 'installed'，且原本就有舊版在運作
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[PWA] 新版本下載完成，跳出提示');
                        showUpdateNotification(newWorker);
                    }
                };
            };

            // ==========================================
            // 策略 4: [新功能] 當使用者切換回 APP 時，再次檢查
            // (解決手機瀏覽器偷懶不檢查的問題)
            // ==========================================
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    console.log('[PWA] APP回到前台，再次觸發更新檢查...');
                    registration.update();
                }
            });

            // ==========================================
            // 策略 5: [新功能] 每小時自動檢查一次
            // ==========================================
            setInterval(() => {
                console.log('[PWA] 定時檢查更新...');
                registration.update();
            }, 60 * 60 * 1000); // 60分鐘

        }).catch((err) => {
            console.error('[PWA] 註冊失敗:', err);
        });

        // 當新版接管後，自動重整頁面
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload();
                refreshing = true;
            }
        });
    }
});

// 顯示 UI 的函式
function showUpdateNotification(worker) {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    
    if (notification && btn) {
        // 避免重複顯示
        if (notification.style.display === 'flex') return;

        notification.style.display = 'flex'; // 顯示視窗
        
        // 綁定按鈕點擊事件
        btn.onclick = () => {
            // 發送 skipWaiting 指令讓新版 SW 立刻接管
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        };
    }
}