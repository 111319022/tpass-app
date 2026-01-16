// js/pwa-update.js (除錯版)

if ('serviceWorker' in navigator) {
    console.log('[PWA] 準備註冊 Service Worker...');

    navigator.serviceWorker.register('./sw.js').then((registration) => {
        console.log('[PWA] 註冊成功，Scope:', registration.scope);

        // 1. 檢查是否有正在等待的新版本 (Waiting)
        if (registration.waiting) {
            console.log('[PWA] 發現已存在 waiting 的 SW，跳出提示框！');
            showUpdateNotification(registration.waiting);
            return;
        }

        // 2. 監聽是否有新版本 (Installing)
        registration.onupdatefound = () => {
            console.log('[PWA] 發現新版本正在下載中 (onupdatefound)...');
            const newWorker = registration.installing;
            
            newWorker.onstatechange = () => {
                console.log('[PWA] 新版本狀態改變:', newWorker.state);

                if (newWorker.state === 'installed') {
                    if (navigator.serviceWorker.controller) {
                        console.log('[PWA] 新版本安裝完成，且有舊版存在 -> 跳出提示框！');
                        showUpdateNotification(newWorker);
                    } else {
                        console.log('[PWA] 新版本安裝完成，但這是「第一次」安裝，不跳提示框。');
                    }
                }
            };
        };
    }).catch((err) => {
        console.error('[PWA] Service Worker 註冊失敗:', err);
    });

    // 3. 監聽更新完成後的重整
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] Controller 已變更 (controllerchange)');
        if (!refreshing) {
            console.log('[PWA] 準備重整頁面...');
            window.location.reload();
            refreshing = true;
        }
    });
} else {
    console.log('[PWA] 此瀏覽器不支援 Service Worker');
}

// 顯示更新提示框
function showUpdateNotification(worker) {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    
    if (notification && btn) {
        console.log('[PWA] UI 顯示函式被呼叫');
        notification.style.display = 'flex'; // 顯示提示框
        
        btn.addEventListener('click', () => {
            console.log('[PWA] 使用者點擊更新');
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        });
    } else {
        console.error('[PWA] 找不到 UI 元素 (update-notification 或 reload-btn)');
    }
}