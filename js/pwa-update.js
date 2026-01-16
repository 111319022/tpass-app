// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        // 1. 註冊 Service Worker
        navigator.serviceWorker.register('./sw.js').then((registration) => {
            console.log('[PWA] Service Worker 註冊成功');

            // [關鍵] 強制瀏覽器立刻去檢查有沒有新版 sw.js
            // 這行是解決手機 PWA "無感" 的最重要指令
            registration.update();

            // 2. 檢查是否已經有等待中的新版本 (上次下載好但沒更新的)
            if (registration.waiting) {
                console.log('[PWA] 發現已下載好的新版 (Waiting)');
                showUpdateNotification(registration.waiting);
                return;
            }

            // 3. 監聽是否有新版本正在下載
            registration.onupdatefound = () => {
                const newWorker = registration.installing;
                console.log('[PWA] 發現新版本，正在下載中...');
                
                newWorker.onstatechange = () => {
                    // 當新版本狀態變為 'installed'，且原本就有舊版在運作
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[PWA] 新版本下載完成，準備跳出提示');
                        showUpdateNotification(newWorker);
                    }
                };
            };
        }).catch((err) => {
            console.error('[PWA] 註冊失敗:', err);
        });

        // 4. 當使用者按下更新，新版接管後，自動重整頁面
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
        notification.style.display = 'flex'; // 顯示視窗
        
        // 綁定按鈕點擊事件
        btn.onclick = () => {
            // 發送 skipWaiting 指令讓新版 SW 立刻接管
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        };
    } else {
        console.error('[PWA] 錯誤：找不到更新提示框的 UI 元素');
    }
}