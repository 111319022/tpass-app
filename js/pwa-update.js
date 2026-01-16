// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. 初始化手動檢查按鈕 (優先執行)
    initManualCheck();

    // 2. 註冊 Service Worker (標準流程)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('[PWA] Service Worker 註冊成功');

            // 自動檢查更新 (靜默執行)
            reg.update();

            // 監聽更新狀態
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

// 手動檢查邏輯 (PWA 強力修正版)
function initManualCheck() {
    const btn = document.getElementById('checkUpdateBtn');
    const icon = document.getElementById('updateIcon');
    const text = document.getElementById('updateText');

    if (!btn) return;

    const handleClick = async (e) => {
        // 防止事件冒泡與預設行為
        e.preventDefault(); 
        e.stopPropagation();

        if (btn.disabled) return;

        // UI 變更：檢查中
        icon.classList.remove('fa-circle-check');
        icon.classList.add('fa-spin', 'fa-rotate');
        icon.style.color = "#3498db";
        text.innerText = "檢查中...";
        btn.disabled = true;
        btn.style.opacity = "0.7";

        try {
            // [關鍵修正 1] 改用 getRegistration()，不要用 .ready (會卡死)
            let reg = await navigator.serviceWorker.getRegistration();

            // [關鍵修正 2] 如果不幸抓不到 (極少見)，嘗試重新註冊一次來獲取
            if (!reg) {
                console.log('[PWA] 找不到 reg，嘗試重新獲取...');
                reg = await navigator.serviceWorker.register('./sw.js');
            }

            if (!reg) {
                throw new Error("無法獲取 Service Worker");
            }

            // 強制去伺服器撈資料
            await reg.update();

            // 稍微延遲一點，讓使用者看得到轉圈圈
            setTimeout(() => {
                const hasUpdate = reg.installing || reg.waiting;
                
                if (hasUpdate) {
                    // A. 發現新版
                    text.innerText = "發現新版本！";
                    icon.classList.remove('fa-spin');
                    // 這裡交給 monitorUpdates 處理跳出視窗
                    // 為了保險，我們手動再觸發一次顯示視窗邏輯
                    showGlobalNotification(hasUpdate);
                    updateButtonStatus("發現新版本！");
                } else {
                    // B. 沒更新
                    icon.classList.remove('fa-spin', 'fa-rotate');
                    icon.className = "fa-solid fa-circle-check"; // 變成打勾
                    icon.style.color = "#2ecc71";
                    text.innerText = "已是最新";

                    // 2秒後復原按鈕
                    setTimeout(() => {
                        resetButton(icon, text, btn);
                    }, 2000);
                }
            }, 800);

        } catch (error) {
            console.error('[PWA] 手動檢查失敗', error);
            // 讓使用者知道出錯了
            text.innerText = "檢查失敗";
            icon.classList.remove('fa-spin');
            icon.style.color = "#e74c3c";
            
            setTimeout(() => resetButton(icon, text, btn), 2000);
        }
    };

    // 綁定點擊事件
    btn.addEventListener('click', handleClick);
}

function resetButton(icon, text, btn) {
    icon.className = "fa-solid fa-rotate";
    icon.style.color = "#3498db";
    text.innerText = "檢查更新";
    btn.disabled = false;
    btn.style.opacity = "1";
}

// 監聽是否有新版本
function monitorUpdates(reg) {
    // 封裝檢查邏輯
    const checkState = (worker) => {
        if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
            showGlobalNotification(worker);
            updateButtonStatus("發現新版本！");
        }
    };

    // A. 檢查 Waiting
    if (reg.waiting) {
        showGlobalNotification(reg.waiting);
        updateButtonStatus("發現新版本！");
    }

    // B. 監聽 Installing
    reg.onupdatefound = () => {
        const newWorker = reg.installing;
        if (newWorker) {
            newWorker.onstatechange = () => checkState(newWorker);
        }
    };
}

// 顯示黑色提示框
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

function updateButtonStatus(msg) {
    const text = document.getElementById('updateText');
    const icon = document.getElementById('updateIcon');
    if (text && icon) {
        text.innerText = msg;
        icon.classList.remove('fa-spin');
        icon.style.color = "#e74c3c";
    }
}