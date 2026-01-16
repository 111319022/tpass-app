// js/pwa-update.js

if ('serviceWorker' in navigator) {
    // 註冊 Service Worker
    navigator.serviceWorker.register('./sw.js').then((registration) => {
        
        // 1. 檢查是否已經有等待中的新 Service Worker (這發生在使用者打開 APP 但沒重整時)
        if (registration.waiting) {
            showUpdateNotification(registration.waiting);
            return;
        }

        // 2. 監聽是否有新版本被發現
        registration.onupdatefound = () => {
            const newWorker = registration.installing;
            
            newWorker.onstatechange = () => {
                // 當新版本狀態變為 'installed'，且原本就有舊版在運作 (navigator.serviceWorker.controller)
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateNotification(newWorker);
                }
            };
        };
    }).catch((err) => {
        console.error('Service Worker 註冊失敗:', err);
    });

    // 3. 監聽 controllerchange 事件：當新 Service Worker 接管後，重整頁面
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            window.location.reload();
            refreshing = true;
        }
    });
}

// 顯示更新提示框
function showUpdateNotification(worker) {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    
    if (notification && btn) {
        notification.style.display = 'flex';
        
        btn.addEventListener('click', () => {
            // 發送指令給新的 Service Worker，叫它跳過等待，立刻接管
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        });
    }
}