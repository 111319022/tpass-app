import { db, auth } from "./firebase-config.js";
import { collection, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const btnDownload = document.getElementById('btnDownloadTemplate');
const csvInput = document.getElementById('csvInput');
const logArea = document.getElementById('logArea');
let currentUser = null;

// 1. 權限檢查
onAuthStateChanged(auth, (user) => {
    if (!user) {
        alert("請先登入");
        window.location.href = "index.html";
    }
    currentUser = user;
});

// 2. 下載範本功能 (新增「票種」欄位)
btnDownload.addEventListener('click', () => {
    const headers = [
        "日期(YYYY/MM/DD)", 
        "時間(HH:MM)", 
        "運具(mrt/bus...)", 
        "原始金額", 
        "是否轉乘(y/n)", 
        "是否免費(y/n)", 
        "起點站", 
        "終點站", 
        "路線(公車/客運)", 
        "備註",
        "票種(adult/student)" // [新增] 第 11 欄
    ];

    // 範例資料：新增學生票範例
    const examples = [
        ["2026/01/28", "08:30", "mrt", "20", "n", "n", "市政府", "台北車站", "", "全票", "adult"],
        ["2026/01/28", "08:50", "bus", "12", "y", "n", "", "", "307", "學生票轉乘", "student"], // 學生票轉乘範例
        ["2026/01/28", "18:00", "bike", "10", "n", "y", "捷運信義安和站", "通化街夜市", "", "前30分免費", "adult"]
    ];
    
    let csvContent = "\uFEFF" + [headers, ...examples].map(e => e.join(",")).join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "tpass_student_import_template.csv";
    link.click();
});

// 3. 檔案上傳處理
csvInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    log("正在讀取檔案...", "info");
    const reader = new FileReader();
    
    reader.onload = async (event) => {
        const text = event.target.result;
        await processCSV(text);
    };
    
    reader.readAsText(file);
    e.target.value = '';
});

// 4. 解析與匯入核心邏輯
async function processCSV(csvText) {
    const lines = csvText.split(/\r\n|\n/);
    const tripsToAdd = [];
    let failCount = 0;

    const typeMap = {
        'mrt': 'mrt', '捷運': 'mrt', '北捷': 'mrt',
        'bus': 'bus', '公車': 'bus',
        'tra': 'tra', '台鐵': 'tra', '火車': 'tra',
        'bike': 'bike', 'ubike': 'bike', '腳踏車': 'bike',
        'tymrt': 'tymrt', '機捷': 'tymrt',
        'coach': 'coach', '客運': 'coach',
        'lrt': 'lrt', '輕軌': 'lrt'
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        
        if (cols.length < 4) {
            log(`略過無效行 ${i + 1}: ${line}`, "warn");
            continue;
        }

        try {
            // 解析欄位
            const dateStr = cols[0].trim().replace(/-/g, '/');
            const timeStr = cols[1].trim();
            const typeRaw = cols[2].trim().toLowerCase();
            const originalPrice = parseFloat(cols[3].trim());
            
            const isYes = (val) => val && ['y', 'yes', '1', '是', 'true'].includes(val.trim().toLowerCase());

            const isTransfer = cols[4] ? isYes(cols[4]) : false;
            const isFree = cols[5] ? isYes(cols[5]) : false;
            
            const startStation = cols[6] ? cols[6].trim() : '';
            const endStation = cols[7] ? cols[7].trim() : '';
            const routeId = cols[8] ? cols[8].trim() : '';
            const note = cols[9] ? cols[9].trim() : '';
            
            // [新增] 票種解析
            const identityRaw = cols[10] ? cols[10].trim().toLowerCase() : 'adult';
            const isStudent = ['student', '學生', 'stu'].includes(identityRaw);

            // 邏輯處理
            const type = typeMap[typeRaw] || 'mrt';
            
            // [修正] 轉乘折扣邏輯
            // 成人: 8元, 學生: 6元
            const discount = isStudent ? 6 : 8;
            
            let paidPrice = originalPrice;

            if (isFree) {
                paidPrice = 0;
            } else if (isTransfer) {
                paidPrice = Math.max(0, originalPrice - discount);
            }

            const fullDate = new Date(`${dateStr} ${timeStr}`);
            if (isNaN(fullDate.getTime())) throw new Error("日期時間格式錯誤");

            tripsToAdd.push({
                createdAt: fullDate.getTime(),
                dateStr: dateStr,
                timeStr: timeStr.length === 5 ? timeStr + ":00" : timeStr,
                type: type,
                originalPrice: originalPrice,
                paidPrice: paidPrice,
                isTransfer: isTransfer,
                isFree: isFree,
                startStation: startStation,
                endStation: endStation,
                routeId: routeId,
                note: note
                // 這裡不需要存 identity 到資料庫，因為我們已經算出正確的 paidPrice 了
            });

        } catch (err) {
            log(`行 ${i + 1} 解析失敗: ${err.message}`, "error");
            failCount++;
        }
    }

    if (tripsToAdd.length === 0) {
        log("沒有可匯入的資料，請檢查 CSV 格式。", "warn");
        return;
    }

    log(`解析完成，準備匯入 ${tripsToAdd.length} 筆資料...`, "info");
    await batchUpload(tripsToAdd);
}

// 5. 批次上傳 (保持不變)
async function batchUpload(trips) {
    const CHUNK_SIZE = 450;
    const chunks = [];
    
    for (let i = 0; i < trips.length; i += CHUNK_SIZE) {
        chunks.push(trips.slice(i, i + CHUNK_SIZE));
    }

    let totalUploaded = 0;

    for (let i = 0; i < chunks.length; i++) {
        const batch = writeBatch(db);
        const chunk = chunks[i];

        chunk.forEach(trip => {
            const newRef = doc(collection(db, "users", currentUser.uid, "trips"));
            batch.set(newRef, trip);
        });

        try {
            await batch.commit();
            totalUploaded += chunk.length;
            log(`已寫入批次 ${i + 1}/${chunks.length} (${totalUploaded} / ${trips.length})`, "success");
        } catch (e) {
            console.error(e);
            log(`批次 ${i + 1} 寫入失敗: ${e.message}`, "error");
        }
    }

    log(`🎉 匯入作業結束！成功新增 ${totalUploaded} 筆行程。`, "success");
    
    setTimeout(() => {
        if(confirm("匯入成功！是否回到主畫面？")) {
            window.location.href = "app.html";
        }
    }, 1500);
}

function log(msg, type) {
    logArea.style.display = 'block';
    const color = type === 'error' ? '#ff7675' : (type === 'success' ? '#55efc4' : '#dfe6e9');
    logArea.innerHTML += `<div style="color:${color}; margin-bottom:4px; border-bottom:1px dashed #444; padding-bottom:2px;">[${new Date().toLocaleTimeString()}] ${msg}</div>`;
    logArea.scrollTop = logArea.scrollHeight;
}