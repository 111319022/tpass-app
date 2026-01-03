import { auth, db } from "./firebase-config.js";
import { signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const slider = document.getElementById('slider');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const dots = document.querySelectorAll('.dot');
const startBtn = document.getElementById('startBtn');

// 1. 滑動邏輯與介面更新
slider.addEventListener('scroll', () => {
    const scrollLeft = slider.scrollLeft;
    const width = slider.offsetWidth;
    // 使用 Math.round 確保滑過一半就算下一頁
    const index = Math.round(scrollLeft / width);

    updateUI(index);
});

function updateUI(index) {
    // 更新原點
    dots.forEach((dot, i) => {
        if (i === index) dot.classList.add('active');
        else dot.classList.remove('active');
    });

    // 控制按鈕顯示
    // 第一頁：隱藏上一頁
    if (index === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }

    // 最後一頁 (index 3)：隱藏下一頁
    if (index === 3) {
        nextBtn.classList.add('hidden');
    } else {
        nextBtn.classList.remove('hidden');
    }
}

// 2. 按鈕點擊功能
nextBtn.addEventListener('click', () => {
    const width = slider.offsetWidth;
    slider.scrollBy({ left: width, behavior: 'smooth' });
});

prevBtn.addEventListener('click', () => {
    const width = slider.offsetWidth;
    slider.scrollBy({ left: -width, behavior: 'smooth' });
});

// 3. 登入並儲存設定邏輯 (保持不變)
startBtn.addEventListener('click', async () => {
    const selectedIdentity = document.querySelector('input[name="identity"]:checked').value;
    const provider = new GoogleAuthProvider();
    
    startBtn.innerText = "登入處理中...";
    startBtn.disabled = true;

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        await setDoc(doc(db, "users", user.uid), {
            identity: selectedIdentity,
            email: user.email,
            displayName: user.displayName
        }, { merge: true });

        // 設定 localStorage 標記已看過介紹 (可選)
        localStorage.setItem('hasSeenIntro', 'true');

        window.location.href = "index.html";

    } catch (error) {
        console.error("Login Error:", error);
        alert("登入失敗，請重試");
        startBtn.innerText = "登入並開始";
        startBtn.disabled = false;
    }
});

