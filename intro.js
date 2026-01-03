import { auth, db } from "./firebase-config.js";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const slider = document.getElementById('slider');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const dotsContainer = document.getElementById('dots');
const startBtn = document.getElementById('startBtn');
const quickLoginBtn = document.getElementById('quickLoginBtn');

// [新增] 檢查登入狀態 (Auth Guard)
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.replace("app.html");
    }
});

// === 1. 初始化邏輯 (PWA 偵測與圓點生成) ===
function initPage() {
    // 偵測是否為 PWA 模式 (Standalone)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
        const pwaCard = document.getElementById('pwa-card');
        if (pwaCard) {
            pwaCard.remove(); // 移除 PWA 安裝教學卡片
        }
    }

    // 根據現在剩餘的卡片數量，動態生成圓點
    const cards = document.querySelectorAll('.card');
    dotsContainer.innerHTML = ''; // 清空
    cards.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = i === 0 ? 'dot active' : 'dot';
        dotsContainer.appendChild(dot);
    });
}

// 執行初始化
initPage();

// 重新抓取生成的圓點
const dots = document.querySelectorAll('.dot');

// === 2. 滑動邏輯 ===
slider.addEventListener('scroll', () => {
    const scrollLeft = slider.scrollLeft;
    const width = slider.offsetWidth;
    const index = Math.round(scrollLeft / width);

    updateUI(index);
});

function updateUI(index) {
    // 更新圓點狀態
    dots.forEach((dot, i) => {
        if (i === index) dot.classList.add('active');
        else dot.classList.remove('active');
    });

    // 按鈕顯示控制
    if (index === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }

    // 使用 dots.length 動態判斷最後一頁
    if (index === dots.length - 1) {
        nextBtn.classList.add('hidden');
    } else {
        nextBtn.classList.remove('hidden');
    }
}

// === 3. 導航按鈕 ===
nextBtn.addEventListener('click', () => {
    const width = slider.offsetWidth;
    slider.scrollBy({ left: width, behavior: 'smooth' });
});

prevBtn.addEventListener('click', () => {
    const width = slider.offsetWidth;
    slider.scrollBy({ left: -width, behavior: 'smooth' });
});

// === 4. 登入邏輯封裝 ===
// isQuickLogin: 如果是 true，就不會寫入「身分設定」，避免老手被強制洗成預設值
async function handleLogin(btnElement, isQuickLogin = false) {
    const provider = new GoogleAuthProvider();
    const originalText = btnElement.innerHTML;
    
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 處理中...';
    btnElement.disabled = true;
    btnElement.style.opacity = '0.7';

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        // 準備要寫入的資料
        let userData = {
            email: user.email,
            displayName: user.displayName,
            lastLogin: new Date()
        };

        // 只有在「完整流程」(最後一頁) 登入時，才寫入選擇的身分
        // 這樣「直接登入」的老手，身分設定會維持原本資料庫的樣子
        if (!isQuickLogin) {
            const selectedIdentity = document.querySelector('input[name="identity"]:checked').value;
            userData.identity = selectedIdentity;
        }

        await setDoc(doc(db, "users", user.uid), userData, { merge: true });

        localStorage.setItem('hasSeenIntro', 'true');
        window.location.replace("app.html");

    } catch (error) {
        console.error("Login Error:", error);
        alert("登入失敗，請檢查網路連線後重試。");
        btnElement.innerHTML = originalText;
        btnElement.disabled = false;
        btnElement.style.opacity = '1';
    }
}

// 綁定最後一頁的「開始使用」按鈕 (會更新身分)
startBtn.addEventListener('click', () => handleLogin(startBtn, false));

// 綁定第一頁的「直接登入」按鈕 (不會更新身分)
quickLoginBtn.addEventListener('click', () => handleLogin(quickLoginBtn, true));

await setDoc(doc(db, "users", user.uid), {
    // ...略
    email: user.email,          // 這裡會補寫入 email
    displayName: user.displayName // 這裡會補寫入 名字
}, { merge: true }); // merge: true 代表更新現有資料