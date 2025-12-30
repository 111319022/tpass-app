# 🚀 基北北桃 TPASS 回本計算機 (Web App)

![TPASS Banner](https://img.shields.io/badge/TPASS-回本計算機-blue?style=for-the-badge&logo=appveyor)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%26%20Firestore-orange?style=for-the-badge&logo=firebase)
![GitHub Actions](https://img.shields.io/badge/CI/CD-GitHub%20Actions-green?style=for-the-badge&logo=github-actions)

> **「這張月票買了真的有划算嗎？」** > 專為基北北桃通勤族設計，不僅幫你記帳，更精準套用最新 **TPASS 2.0 優惠規則**，讓數據告訴你什麼時候開始「倒賺」！

🔗 **立即體驗：** [https://111319022.github.io/tpass-app/](https://111319022.github.io/tpass-app/)

---

## ✨ 核心特色

| 📊 精準計算 | 📅 多週期管理 | 👤 身分切換 | ☁️ 雲端同步 |
| :--- | :--- | :--- | :--- |
| 自動套用北捷常客與 TPASS 2.0 規則。 | 支援自定義啟用日，跨月、空窗期完美處理。 | 學生票與全票一鍵切換，轉乘金額精準扣除。 | 使用 Firebase 雲端存檔，多裝置同步紀錄。 |

---

## 📸 介面預覽

<div align="center">
  <img src="https://via.placeholder.com/280x560?text=Dashboard+View" width="30%" alt="Dashboard" />
  <img src="https://via.placeholder.com/280x560?text=History+List" width="30%" alt="History" />
  <img src="https://via.placeholder.com/280x560?text=Settings+Modal" width="30%" alt="Settings" />
  <p><i>(建議上傳真實截圖替換上方占位圖，這會讓 README 更有吸引力！)</i></p>
</div>

---

## 🔥 功能亮點

### 1. 智慧回本分析
系統會根據你的行程，自動算出：
- **規則一：** 北捷與台鐵的階梯式常客優惠金額。
- **規則二：** TPASS 2.0 (軌道 2% / 公車客運最高 30%) 回饋。
- **結果：** 直接對比 $1200 票價，告訴你還差多少錢回本。

### 2. 多週期帳單系統
效法信用卡 App，你可以：
- 查看 **當前週期** 的即時數據。
- 切換回 **歷史週期** 查看過往的通勤支出紀錄。
- 每個週期獨立設定起始日，符合 TPASS 啟用制邏輯。

### 3. PWA 近原生體驗
支援 **「加入主畫面」**，在 iOS/Android 上享受無網址列、全螢幕的 App 級操作感。

---

## 🛠 技術棧

- **Frontend:** HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6+)
- **Backend:** Firebase Authentication, Cloud Firestore
- **Deployment:** Firebase Hosting, GitHub Actions (CI/CD)
- **Icons:** FontAwesome 6

---

## 🚀 快速開始

如果你想在本地運行此專案：

1. **複製倉庫**
   ```bash
   git clone [https://github.com/111319022/tpass-app.git](https://github.com/111319022/tpass-app.git)
