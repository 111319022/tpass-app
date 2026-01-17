// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. 初始化按鈕
    initManualCheck();

    // 2. 註冊 Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('[PWA] Service Worker 註冊成功');
            // 自動檢查一次
            reg.update();
            // 監聽狀態
            monitorUpdates(reg);
        }).catch(err => console.error('[PWA] 註冊失敗', err));

        // 監聽控制器變更 -> 重整頁面
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload();
                refreshing = true;
            }
        });
    }
});

function initManualCheck() {
    const btn = document.getElementById('checkUpdateBtn');
    const icon = document.getElementById('updateIcon');
    const text = document.getElementById('updateText');

    if (!btn) return;

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.disabled) return;

        // UI 變更：轉圈圈
        icon.classList.remove('fa-circle-check');
        icon.classList.add('fa-spin', 'fa-rotate');
        icon.style.color = "#3498db";
        text.innerText = "正在更新...";
        btn.disabled = true;
        btn.style.opacity = "0.7";

        try {
            // 1. 抓取 Service Worker
            let reg = await navigator.serviceWorker.getRegistration();

            // 如果沒有 SW，直接重整就會抓到新的
            if (!reg) {
                window.location.reload();
                return;
            }

            // 2. 檢查是否有「等待中」的新版 (這是最常見的情況)
            if (reg.waiting) {
                console.log('[PWA] 發現等待中的版本，直接啟用...');
                reg.waiting.postMessage({ action: 'skipWaiting' });
                return; // 後續會由 controllerchange 觸發 reload
            }

            // 3. 強制去伺服器檢查
            await reg.update();

            // 檢查是否正在安裝新版
            const newWorker = reg.installing || reg.waiting;
            if (newWorker) {
                console.log('[PWA] 發現新版本下載中...');
                // 發送 skipWaiting (如果它還在安裝，可能沒反應，但沒關係)
                newWorker.postMessage({ action: 'skipWaiting' });
                
                // 等它裝好
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed') {
                        newWorker.postMessage({ action: 'skipWaiting' });
                    }
                });
                return;
            }

            // 4. 【核彈級大招】如果都沒發現新版，但使用者按了更新 -> 強制重灌
            // 這會移除目前的 SW，逼瀏覽器下次載入時抓全新的
            console.log('[PWA] 沒發現新版，執行強制重灌...');
            text.innerText = "深度重整中...";
            
            await reg.unregister(); // 註銷 SW
            
            // 清除所有快取 (選用，但更保險)
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map(key => caches.delete(key)));

            // 強制重整
            window.location.reload(true);

        } catch (error) {
            console.error('[PWA] 更新失敗', error);
            // 出錯了也直接重整，反正就是想更新
            window.location.reload();
        }
    });
}

function monitorUpdates(reg) {
    // 這裡保留原本的自動偵測邏輯，為了顯示提示框
    const check = (worker) => {
        if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
            showGlobalNotification(worker);
        }
    };
    if (reg.waiting) check(reg.waiting);
    reg.onupdatefound = () => {
        const newWorker = reg.installing;
        if (newWorker) {
            newWorker.onstatechange = () => check(newWorker);
        }
    };
}

function showGlobalNotification(worker) {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    if (notification && btn) {
        if (notification.style.display === 'flex') return;
        notification.style.display = 'flex';
        btn.onclick = () => {
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        };
    }
}