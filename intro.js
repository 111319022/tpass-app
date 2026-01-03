import { auth, db } from "./firebase-config.js";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const slider = document.getElementById('slider');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const dotsContainer = document.getElementById('dots');
const startBtn = document.getElementById('startBtn');
const quickLoginBtn = document.getElementById('quickLoginBtn');

// [新增] 一個旗標，用來判斷是否正在執行手動登入流程
let isLoginProcessing = false;

// [修改] 檢查登入狀態 (Auth Guard)
onAuthStateChanged(auth, (user) => {
    // 只有在「使用者已登入」且「不是正在手動登入」的情況下，才自動轉址
    // 這樣如果是因為按了按鈕而觸發的登入，這裡就會被擋下，改由 handleLogin 負責轉址
    if (user && !isLoginProcessing) {
        window.location.replace("app.html");
    }
});

// === 1. 初始化邏輯 (PWA 偵測與圓點生成) ===
function initPage() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
        const pwaCard = document.getElementById('pwa-card');
        if (pwaCard) {
            pwaCard.remove(); 
        }
    }

    const cards = document.querySelectorAll('.card');
    dotsContainer.innerHTML = ''; 
    cards.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = i === 0 ? 'dot active' : 'dot';
        dotsContainer.appendChild(dot);
    });
}

initPage();

const dots = document.querySelectorAll('.dot');

// === 2. 滑動邏輯 ===
slider.addEventListener('scroll', () => {
    const scrollLeft = slider.scrollLeft;
    const width = slider.offsetWidth;
    const index = Math.round(scrollLeft / width);
    updateUI(index);
});

function updateUI(index) {
    dots.forEach((dot, i) => {
        if (i === index) dot.classList.add('active');
        else dot.classList.remove('active');
    });

    if (index === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }

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
async function handleLogin(btnElement, isQuickLogin = false) {
    // [重點修正] 按下按鈕時，立刻把旗標設為 true，鎖住上方的自動轉址
    isLoginProcessing = true;

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

        if (!isQuickLogin) {
            const selectedIdentity = document.querySelector('input[name="identity"]:checked').value;
            userData.identity = selectedIdentity;
        }

        // 這行現在一定會被執行到了，因為自動轉址被 isLoginProcessing 擋住了
        await setDoc(doc(db, "users", user.uid), userData, { merge: true });

        localStorage.setItem('hasSeenIntro', 'true');
        
        // 資料寫入完成，手動轉址
        window.location.replace("app.html");

    } catch (error) {
        console.error("Login Error:", error);
        alert("登入失敗，請檢查網路連線後重試。");
        btnElement.innerHTML = originalText;
        btnElement.disabled = false;
        btnElement.style.opacity = '1';
        
        // 失敗的話，要解除鎖定，讓之後的自動偵測恢復正常
        isLoginProcessing = false;
    }
}

startBtn.addEventListener('click', () => handleLogin(startBtn, false));
quickLoginBtn.addEventListener('click', () => handleLogin(quickLoginBtn, true));