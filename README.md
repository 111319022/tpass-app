<div align="center">

# 🚌 基北北桃 TPASS 回本計算機 v2.0

**專為基北北桃通勤族打造 · 具備「自動查價」功能的智慧精算師**

[ **🚀 立即啟動 Web App** ](https://111319022.github.io/tpass-app/)
·
[ 🐛 回報問題 ](https://github.com/111319022/tpass-app/issues)

<br>

<img src="/images/icon.png" width="300" alt="App Screenshot" style="border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">

<br>
<br>

</div>

---

## 💡 為什麼做這個？

通勤月票 $1200 買下去，到底有沒有回本？
一般的記帳軟體太過繁瑣，且無法處理轉乘優惠、 **「北捷常客優惠」** 的階梯式回饋，更無法自動扣除 **「TPASS 2.0回饋」** 的複雜運距計算。

這個 App 的目標是讓記帳變得「無感」——**你只需要選車站，剩下的價格計算、回饋趴數、轉乘扣減，全部交給它。**

---

## ✨ 2.0 全新功能：零輸入體驗

### 🚄 北捷票價自動帶入 (Official Data)
不再需要手動輸入 $20、$30！
- **官方資料庫**：內建北捷完整票價表，選擇起訖站後，價格**自動帶入**。
- **分線路選擇**：仿照捷運 App 的 UI，先選路線 (板南線/淡水信義線...) 再選車站，手機操作超直覺。

### 🧠 智慧記憶功能 (History Learning)
針對 **台鐵 (TRA)**、**機捷 (TYMRT)** 與 **客運** 這些站點眾多的運具：
- 系統會學習你的搭乘歷史。
- 只要你輸入過一次「台北 ↔ 宜蘭」，下次選擇相同起訖點時，價格**自動填入**。

---

## 💎 核心體驗

### 🎯 只有重點，沒有廢話
- **智慧預設**：選擇公車，自動填入 $15；切換學生身分，自動變更為 $12。
- **精準轉乘**：勾選「轉乘」，系統自動扣除 $8 或 $6 優惠，比你自己算還準。

### 💳 像是你的信用卡帳單
- **多週期管理**：隨時查看「1月」還有幾天到期、「2月」已經回本多少。
- **彈性啟用**：每個週期的啟用日都能獨立設定，完美符合 TPASS 的啟用制邏輯。

### 📱 PWA 原生質感
無需下載，加入主畫面即刻使用。
- **0 秒啟動**：支援離線緩存，打開即用。
- **全螢幕**：移除瀏覽器網址列，沉浸式體驗。
- **跨平台**：iOS / Android / Desktop 通用。

---

## ⚡️ 技術核心

專案採用現代化 Web 技術，並結合自動化腳本確保資料準確性。

**Frontend**
`HTML5` &nbsp; `CSS3 (Glassmorphism UI)` &nbsp; `JavaScript (ES6+)`

**Data Engineering**
`Node.js Crawler` - 自動抓取北捷官網 API，生成最新的票價矩陣 (`fares.js`)。

**Backend Services**
`Firebase Authentication` &nbsp; `Cloud Firestore`

**DevOps**
`GitHub Actions` &nbsp; `Firebase Hosting`

---

## 📸 介面導覽

| **儀表板 (Dashboard)** | **智慧輸入 (Smart Input)** | **行程紀錄 (History)** |
|:---:|:---:|:---:|
| <img src="screenshot/screenshot_1.PNG" alt="儀表板" width="250" /> | <img src="screenshot/screenshot_3.PNG" alt="輸入畫面" width="250" /> | <img src="screenshot/screenshot_2.PNG" alt="紀錄列表" width="250" /> |
| *直觀顯示回本進度與金額* | *支援路線篩選與自動查價* | *自動依日期分組，清晰明瞭* |

> *註：截圖為開發版本，實際介面可能隨更新優化。*

---

## 🚀 快速部署與開發

如果你也想擁有自己的版本或參與開發：

### 1. Clone 專案
```bash
git clone https://github.com/111319022/tpass-app.git
cd tpass-app
```

### 2. 設定環境
將 `firebase-config.js` 替換為你自己的 Firebase Project Config。

### 3. (可選) 更新票價資料庫
若北捷票價有變動，可執行腳本重新抓取官方資料：
```bash
node fetch_fares_final_v2.js
```
這會自動生成最新的 `js/data/fares.js`。

### 4. 啟動應用
直接開啟 `index.html` 即可運行。

<div align="center">

---

Made with 🧠 by Raaay

</div>
