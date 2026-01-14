// auth.js
import { auth } from "./firebase-config.js";
import { 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// DOM 元素 (只抓取跟 Auth 有關的)
const ui = {
    section: document.getElementById('loginSection'),
    btn: document.getElementById('loginBtn'),
    info: document.getElementById('userInfo'),
    photo: document.getElementById('userPhoto'),
    name: document.getElementById('userName'), // 新介面可能不存在
    logoutBtn: document.getElementById('logoutBtn')
};

// 1. 登入功能 (加上檢查)
if (ui.btn) {
    ui.btn.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            // 登入成功後 onAuthStateChanged 會自動觸發
        } catch (error) {
            console.error("Login failed:", error);
            alert("登入失敗，請重試");
        }
    });
}

// 2. 登出功能 (加上檢查)
if (ui.logoutBtn) {
    ui.logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            
            // 登出後跳轉回首頁 (介紹頁)
            window.location.href = "index.html";
            
        } catch (error) {
            console.error("Logout failed:", error);
        }
    });
}

// 3. 初始化並監聽狀態 (匯出此函式給 script.js 用)
// callback 是一個函式，當使用者狀態改變時，我們呼叫它通知 script.js
export function initAuthListener(onUserChanged) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // === 已登入 UI 處理 ===
            // 每個元素操作前都先檢查是否存在，防止報錯
            if (ui.section) ui.section.classList.add('hidden');
            if (ui.info) ui.info.classList.remove('hidden');
            
            // [關鍵修正] 如果新介面沒有 name 欄位，這行會被跳過，不會 crash
            if (ui.name) ui.name.innerText = user.displayName;
            
            if (ui.photo) ui.photo.src = user.photoURL;
        } else {
            // === 未登入 UI 處理 ===
            if (ui.section) ui.section.classList.remove('hidden');
            if (ui.info) ui.info.classList.add('hidden');
        }

        // 通知 script.js (把 user 物件傳過去，沒登入就是 null)
        if (onUserChanged) {
            onUserChanged(user);
        }
    });
}

// 匯出取得當前使用者的 helper (備用)
export function getCurrentUser() {
    return auth.currentUser;
}