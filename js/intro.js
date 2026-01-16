import { auth, db } from "./firebase-config.js";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const slider = document.getElementById('slider');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const dotsContainer = document.getElementById('dots');
const startBtn = document.getElementById('startBtn');
const quickLoginBtn = document.getElementById('quickLoginBtn');

// DOM 元素
const loadingOverlay = document.getElementById('loadingOverlay');
const mainContainer = document.getElementById('mainContainer');

// 旗標：是否正在執行手動登入
let isLoginProcessing = false;

// === 核心：權限狀態監聽 (解決閃爍問題) ===
onAuthStateChanged(auth, (user) => {
    // 情況 A: 使用者已登入，且不是剛按了按鈕
    if (user && !isLoginProcessing) {
        // 保持遮罩顯示，更新文字讓使用者安心
        if(loadingOverlay) {
            const p = loadingOverlay.querySelector('p');
            if(p) p.innerText = "歡迎回來，正在進入...";
        }
        // 立即跳轉，不顯示介紹頁
        window.location.replace("app.html");
    } 
    // 情況 B: 確定未登入
    else {
        // 隱藏 Loading 遮罩
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        // 顯示主介紹頁
        if (mainContainer) mainContainer.style.display = 'flex';
        
        // 畫面顯示後再計算寬度與點點
        initPage();
        updateUI(0);
    }
});

// === 1. 初始化邏輯 ===
function initPage() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
        const pwaCard = document.getElementById('pwa-card');
        if (pwaCard) pwaCard.remove(); 
    }

    const cards = document.querySelectorAll('.card');
    dotsContainer.innerHTML = ''; 
    cards.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = i === 0 ? 'dot active' : 'dot';
        dotsContainer.appendChild(dot);
    });
}

// === 2. 滑動邏輯 ===
slider.addEventListener('scroll', () => {
    const scrollLeft = slider.scrollLeft;
    const width = slider.offsetWidth;
    const index = Math.round(scrollLeft / width);
    updateUI(index);
});

function updateUI(index) {
    const currentDots = document.querySelectorAll('.dot');
    currentDots.forEach((dot, i) => {
        if (i === index) dot.classList.add('active');
        else dot.classList.remove('active');
    });

    if (index === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }

    if (index === currentDots.length - 1) {
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

// === 4. 登入邏輯 ===
async function handleLogin(btnElement, isQuickLogin = false) {
    isLoginProcessing = true; // 鎖住自動跳轉

    const provider = new GoogleAuthProvider();
    const originalText = btnElement.innerHTML;
    
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 處理中...';
    btnElement.disabled = true;
    btnElement.style.opacity = '0.7';

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        let userData = {
            email: user.email,
            displayName: user.displayName,
            lastLogin: new Date()
        };

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
        isLoginProcessing = false;
    }
}

startBtn.addEventListener('click', () => handleLogin(startBtn, false));
quickLoginBtn.addEventListener('click', () => handleLogin(quickLoginBtn, true));