// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 請填入你的 Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyAlROIhAfrT_dRWhidPDLDStVbwx_HeqfE",
  authDomain: "tpass-app.firebaseapp.com",
  projectId: "tpass-app",
  storageBucket: "tpass-app.firebasestorage.app",
  messagingSenderId: "164241450430",
  appId: "1:164241450430:web:dae3a489e5b944357ac5ef",
  measurementId: "G-L4060JVBWH"
};

const app = initializeApp(firebaseConfig);

// 匯出 auth 和 db 供其他模組使用
export const auth = getAuth(app);
export const db = getFirestore(app);