import { auth, db } from "./firebase-config.js";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const slider = document.getElementById('slider');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const dots = document.querySelectorAll('.dot');
const startBtn = document.getElementById('startBtn');

// [新增] 檢查登入狀態，若已登入則直接跳轉到主程式
onAuthStateChanged(auth, (user) => {
    if (user) {
        // 這裡假設主程式為 app.html，請確認你的檔案名稱
        window.location.href = "app.html";
    }
});

// 1. 滑動邏輯與介面更新
slider.addEventListener('scroll', () => {
    const scrollLeft = slider.scrollLeft;
    const width = slider.offsetWidth;
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

    // [修改] 最後一頁：隱藏下一頁 (使用 dots.length - 1 來動態判斷)
    if (index === dots.length - 1) {
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

// 3. 登入並儲存設定邏輯
startBtn.addEventListener('click', async () => {
    const selectedIdentity = document.querySelector('input[name="identity"]:checked').value;
    const provider = new GoogleAuthProvider();
    
    startBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 處理中...';
    startBtn.disabled = true;
    startBtn.style.opacity = '0.7';

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        await setDoc(doc(db, "users", user.uid), {
            identity: selectedIdentity,
            email: user.email,
            displayName: user.displayName,
            lastLogin: new Date()
        }, { merge: true });

        // 標記已看過介紹
        localStorage.setItem('hasSeenIntro', 'true');

        // 跳轉到主程式
        window.location.href = "app.html";

    } catch (error) {
        console.error("Login Error:", error);
        alert("登入失敗，請檢查網路連線後重試。");
        startBtn.innerHTML = '<i class="fa-brands fa-google"></i> 登入並開始';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
    }
});