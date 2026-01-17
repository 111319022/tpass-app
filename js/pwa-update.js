// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. 初始化手動檢查按鈕 (核彈級修復功能)
    initManualCheck();

    // 2. 註冊 Service Worker 並啟動自動偵測
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('[PWA] Service Worker 註冊成功');

            // ==========================================
            // 自動策略 A: 啟動時立刻檢查
            // ==========================================
            reg.update();

            // ==========================================
            // 自動策略 B: 當使用者從背景切回 APP 時檢查
            // (解決手機 PWA 長時間掛在後台沒更新的問題)
            // ==========================================
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    console.log('[PWA] APP 回到前台，自動檢查更新...');
                    reg.update();
                }
            });

            // ==========================================
            // 自動策略 C: 每隔 60 分鐘自動檢查一次
            // ==========================================
            setInterval(() => {
                console.log('[PWA] 定時檢查更新...');
                reg.update();
            }, 60 * 60 * 1000);

            // 啟動監聽 (只要發現新版，就跳出提示框)
            monitorUpdates(reg);

        }).catch(err => console.error('[PWA] 註冊失敗', err));

        // 當新版 SW 接管後，自動重整頁面
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload();
                refreshing = true;
            }
        });
    }
});

// 監聽更新狀態 (自動偵測的核心)
function monitorUpdates(reg) {
    // 定義發現新版時的動作：顯示黑色提示框
    const notifyUser = (worker) => {
        // 確保新版已經下載完畢 (installed) 或者是等待中 (waiting)
        // 並且目前已經有舊版在跑 (navigator.serviceWorker.controller)
        // (避免第一次安裝時也跳提示)
        if (worker && navigator.serviceWorker.controller) {
            showGlobalNotification(worker);
            
            // 順便把選單裡的按鈕變色，增加被看到的機率
            const text = document.getElementById('updateText');
            const icon = document.getElementById('updateIcon');
            if (text && icon) {
                text.innerText = "發現新版本！";
                icon.style.color = "#e74c3c";
            }
        }
    };

    // A. 檢查是否已經有等待中的版本 (Waiting)
    if (reg.waiting) {
        notifyUser(reg.waiting);
    }

    // B. 監聽是否有正在下載的版本 (Installing)
    reg.onupdatefound = () => {
        const newWorker = reg.installing;
        if (newWorker) {
            // 監聽安裝狀態改變
            newWorker.onstatechange = () => {
                if (newWorker.state === 'installed') {
                    notifyUser(newWorker);
                }
            };
        }
    };
}

// 顯示黑色全域提示框
function showGlobalNotification(worker) {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    
    if (notification && btn) {
        // 避免重複顯示
        if (notification.style.display === 'flex') return;

        notification.style.display = 'flex';
        
        btn.onclick = () => {
            // 發送指令讓新版 SW 接管
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        };
    }
}


// ============================================================
// 手動檢查邏輯 (保留您之前的核彈級強制更新)
// ============================================================
function initManualCheck() {
    const btn = document.getElementById('checkUpdateBtn');
    const icon = document.getElementById('updateIcon');
    const text = document.getElementById('updateText');

    if (!btn) return;

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.disabled) return;

        // UI 變更
        icon.classList.remove('fa-circle-check');
        icon.classList.add('fa-spin', 'fa-rotate');
        icon.style.color = "#3498db";
        text.innerText = "檢查中...";
        btn.disabled = true;
        btn.style.opacity = "0.7";

        try {
            let reg = await navigator.serviceWorker.getRegistration();

            if (!reg) {
                window.location.reload();
                return;
            }

            // 1. 如果已經有等待中的版本，直接更新
            if (reg.waiting) {
                reg.waiting.postMessage({ action: 'skipWaiting' });
                return;
            }

            // 2. 強制去伺服器檢查
            await reg.update();

            // 3. 檢查是否有新版正在下載
            const newWorker = reg.installing || reg.waiting;
            if (newWorker) {
                // 有新版 -> 跳出黑框提示 (或是直接更新也可以，這裡選擇溫柔一點)
                showGlobalNotification(newWorker);
                text.innerText = "發現新版本！";
                icon.classList.remove('fa-spin');
                icon.style.color = "#e74c3c";
                return;
            }

            // 4. 【核彈級大招】沒發現新版，但使用者硬要按 -> 強制重灌
            console.log('[PWA] 手動強制重整...');
            text.innerText = "深度重整中...";
            
            await reg.unregister();
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map(key => caches.delete(key)));
            window.location.reload(true);

        } catch (error) {
            console.error('[PWA] 手動更新失敗', error);
            window.location.reload();
        }
    });
}