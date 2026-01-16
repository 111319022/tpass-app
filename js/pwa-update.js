// js/pwa-update.js

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('[PWA] Service Worker 註冊成功');

            // 1. 【自動模式】啟動時自動檢查一次
            // 電腦版通常這裡就會抓到更新
            reg.update();

            // 2. 監聽更新狀態 (不管是自動還是手動觸發，只要發現新版都會跑這裡)
            monitorUpdates(reg);

            // 3. 【手動模式】綁定按鈕事件
            initManualCheck(reg);

        }).catch(err => console.error('[PWA] 註冊失敗', err));

        // 4. 當新版 SW 接管後，自動重整頁面
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload();
                refreshing = true;
            }
        });
    }
});

// 監聽是否有新版本 (核心邏輯)
function monitorUpdates(reg) {
    // A. 檢查是否已經有等待中的版本 (Waiting)
    if (reg.waiting) {
        showGlobalNotification(reg.waiting);
        updateButtonStatus("發現新版本！");
    }

    // B. 監聽是否有正在下載的版本 (Installing)
    reg.onupdatefound = () => {
        const newWorker = reg.installing;
        
        newWorker.onstatechange = () => {
            // 當新版本下載完成，進入 installed 狀態
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showGlobalNotification(newWorker);
                updateButtonStatus("發現新版本！");
            }
        };
    };
}

// 手動檢查邏輯
function initManualCheck(reg) {
    const btn = document.getElementById('checkUpdateBtn');
    const icon = document.getElementById('updateIcon');
    const text = document.getElementById('updateText');

    if (!btn) return;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // 防止選單關閉

        // UI 變更：檢查中
        icon.classList.add('fa-spin');
        text.innerText = "檢查中...";
        btn.disabled = true;
        btn.style.opacity = "0.7";

        try {
            // 強制去伺服器撈資料
            await reg.update();

            // 檢查結果
            // 如果有新版，上面的 monitorUpdates 會自動觸發並跳出黑框
            // 這裡我們只需要處理「沒有新版」的情況
            
            // 稍微延遲一點，讓使用者看得到轉圈圈 (體驗較好)
            setTimeout(() => {
                const hasUpdate = reg.installing || reg.waiting;
                
                if (!hasUpdate) {
                    // 沒更新 -> 顯示綠色打勾
                    icon.classList.remove('fa-spin');
                    icon.className = "fa-solid fa-circle-check";
                    icon.style.color = "#2ecc71";
                    text.innerText = "已是最新";

                    // 2秒後復原按鈕
                    setTimeout(() => {
                        resetButton(icon, text, btn);
                    }, 2000);
                } else {
                    // 有更新 -> 讓 monitorUpdates 去處理 UI，這裡只需復原按鈕狀態
                    // 或是可以讓按鈕顯示 "發現新版"
                    icon.classList.remove('fa-spin');
                    text.innerText = "發現新版本";
                    // 按鈕不復原，提示使用者去點黑色框框或重整
                }
            }, 800);

        } catch (error) {
            console.error('[PWA] 手動檢查失敗', error);
            text.innerText = "檢查失敗";
            setTimeout(() => resetButton(icon, text, btn), 2000);
        }
    });
}

function resetButton(icon, text, btn) {
    icon.className = "fa-solid fa-rotate";
    icon.style.color = "#3498db";
    text.innerText = "檢查更新";
    btn.disabled = false;
    btn.style.opacity = "1";
}

// 顯示黑色提示框 (全域)
function showGlobalNotification(worker) {
    const notification = document.getElementById('update-notification');
    const btn = document.getElementById('reload-btn');
    
    if (notification && btn) {
        // 如果已經顯示了就不用再做一次
        if (notification.style.display === 'flex') return;

        notification.style.display = 'flex';
        
        btn.onclick = () => {
            worker.postMessage({ action: 'skipWaiting' });
            btn.disabled = true;
            btn.innerText = "更新中...";
        };
    }
}

// 輔助：更新選單按鈕的文字 (可選)
function updateButtonStatus(msg) {
    const text = document.getElementById('updateText');
    const icon = document.getElementById('updateIcon');
    if (text && icon) {
        text.innerText = msg;
        icon.style.color = "#e74c3c"; // 變成紅色提醒
    }
}