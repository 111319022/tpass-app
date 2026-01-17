// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. 初始化手動檢查按鈕
    initManualCheck();

    // 2. 註冊 Service Worker 並啟動自動偵測
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('[PWA] Service Worker 註冊成功');

            // 自動策略 A: 啟動時立刻檢查
            reg.update();

            // 自動策略 B: 切回前台時檢查
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    console.log('[PWA] APP 回到前台，自動檢查更新...');
                    reg.update();
                }
            });

            // 自動策略 C: 定時檢查 (每小時)
            setInterval(() => {
                reg.update();
            }, 60 * 60 * 1000);

            // 啟動監聽
            monitorUpdates(reg);

        }).catch(err => console.error('[PWA] 註冊失敗', err));

        // 監聽控制器變更 -> 自動重整
        // (雖然下面的按鈕會強制重整，但保留這個以防萬一)
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload(true); // 改用 true 強制忽略快取
                refreshing = true;
            }
        });
    }
});

// 監聽更新狀態
function monitorUpdates(reg) {
    const notifyUser = (worker) => {
        if (worker && navigator.serviceWorker.controller) {
            showGlobalNotification(); // 顯示暴力重整按鈕
            
            // 讓選單裡的按鈕也變色
            const text = document.getElementById('updateText');
            const icon = document.getElementById('updateIcon');
            if (text && icon) {
                text.innerText = "發現新版本！";
                icon.style.color = "#e74c3c";
            }
        }
    };

    if (reg.waiting) notifyUser(reg.waiting);

    reg.onupdatefound = () => {
        const newWorker = reg.installing;
        if (newWorker) {
            newWorker.onstatechange = () => {
                if (newWorker.state === 'installed') {
                    notifyUser(newWorker);
                }
            };
        }
    };
}

// ============================================================
// [關鍵修改] 顯示黑色全域提示框 - 點擊後執行「核彈級重整」
// ============================================================
function showGlobalNotification() {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    
    if (notification && btn) {
        if (notification.style.display === 'flex') return;

        notification.style.display = 'flex';
        
        btn.onclick = async () => {
            btn.disabled = true;
            btn.innerText = "更新中...";

            // 這裡不發送 skipWaiting，而是直接執行「核彈級重整」
            // 確保行為跟手動檢查按鈕完全一致
            try {
                // 1. 取得並註銷目前的 SW
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    await reg.unregister();
                }

                // 2. 清除所有快取 (Cache Storage)
                const cacheKeys = await caches.keys();
                await Promise.all(cacheKeys.map(key => caches.delete(key)));

                // 3. 強制重載頁面 (忽略瀏覽器快取)
                window.location.reload(true);
                
            } catch (err) {
                console.error('[PWA] Update failed, forcing reload', err);
                window.location.reload(true);
            }
        };
    }
}


// ============================================================
// 手動檢查邏輯 (維持原本的強力模式)
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
                window.location.reload(true);
                return;
            }

            // 強制去伺服器檢查
            await reg.update();

            // 檢查結果
            const newWorker = reg.installing || reg.waiting;
            
            if (newWorker) {
                // 如果發現新版，直接呼叫上面的暴力視窗
                showGlobalNotification(); 
                text.innerText = "發現新版本！";
                icon.classList.remove('fa-spin');
                icon.style.color = "#e74c3c";
                return;
            }

            // 如果沒發現新版，但使用者硬按 -> 執行核彈重整
            console.log('[PWA] 手動強制重整...');
            text.innerText = "深度重整中...";
            
            await reg.unregister();
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map(key => caches.delete(key)));
            window.location.reload(true);

        } catch (error) {
            console.error('[PWA] 手動更新失敗', error);
            window.location.reload(true);
        }
    });
}