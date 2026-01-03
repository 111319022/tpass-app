import { db } from "./firebase-config.js";
import { collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const userGrid = document.getElementById('userGrid');
const totalUsersEl = document.getElementById('totalUsers');
const activeCyclesEl = document.getElementById('activeCycles');
const profitUsersEl = document.getElementById('profitUsers');
const refreshBtn = document.getElementById('refreshBtn');

// 時間顯示
setInterval(() => {
    const now = new Date();
    document.getElementById('systemTime').innerText = now.toTimeString().split(' ')[0];
}, 1000);

// === 核心：載入所有數據 ===
async function loadAllData() {
    userGrid.innerHTML = '<div class="loading-text">SCANNING DATABASE...</div>';
    
    try {
        // 1. 抓取所有使用者
        const usersSnap = await getDocs(collection(db, "users"));
        
        let stats = { users: 0, active: 0, profit: 0 };
        let html = '';

        stats.users = usersSnap.size;

        // 使用 Promise.all 平行處理每個使用者的資料讀取
        const userPromises = usersSnap.docs.map(async (userDoc) => {
            const uid = userDoc.id;
            const userData = userDoc.data();
            
            // 找出最新週期
            let currentCycle = null;
            if (userData.cycles && userData.cycles.length > 0) {
                // 排序找出最新的 (假設 cycles 存的是 timestamp)
                const sorted = userData.cycles.sort((a, b) => b.start - a.start);
                currentCycle = sorted[0];
            } else if (userData.period) {
                currentCycle = userData.period;
            }

            if (!currentCycle) {
                return createCardHtml(userData, null, null); // 沒設定週期的用戶
            }

            stats.active++;

            // 2. 抓取該用戶、該週期的行程
            const tripsQ = query(
                collection(db, "users", uid, "trips"),
                where("createdAt", ">=", currentCycle.start),
                where("createdAt", "<=", currentCycle.end)
            );
            
            const tripsSnap = await getDocs(tripsQ);
            const trips = tripsSnap.docs.map(t => t.data());

            // 3. 計算回本狀態 (簡化版計算邏輯)
            const result = calculateProfit(trips, userData.identity || 'adult');
            
            if (result.finalCost < 1200) stats.profit++;

            return createCardHtml(userData, currentCycle, result);
        });

        const cards = await Promise.all(userPromises);
        userGrid.innerHTML = cards.join('');

        // 更新統計看板
        totalUsersEl.innerText = stats.users;
        activeCyclesEl.innerText = stats.active;
        profitUsersEl.innerText = stats.profit;

    } catch (e) {
        console.error(e);
        userGrid.innerHTML = `<div style="color:var(--neon-red); text-align:center;">ACCESS DENIED: Check Firestore Rules<br>${e.message}</div>`;
    }
}

// === 計算邏輯 (與主程式類似，但純數據處理) ===
function calculateProfit(trips, identity) {
    const discount = (identity === 'student') ? 6 : 8;
    let totalPaid = 0;
    let originalSums = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };
    let paidSums = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };
    let counts = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };

    trips.forEach(t => {
        let op = t.isFree ? 0 : t.originalPrice;
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) pp = t.isTransfer ? Math.max(0, t.originalPrice - discount) : t.originalPrice;

        const type = t.type || 'mrt'; // fallback
        
        totalPaid += pp;
        
        if (!originalSums[type]) originalSums[type] = 0;
        if (!paidSums[type]) paidSums[type] = 0;
        if (!counts[type]) counts[type] = 0;

        originalSums[type] += op;
        paidSums[type] += pp;
        counts[type]++;
    });

    // Rule 1: 常客 (原價)
    let r1 = 0;
    // 北捷
    const mrtC = counts.mrt || 0;
    const mrtS = originalSums.mrt || 0;
    if(mrtC > 40) r1 += Math.floor(mrtS * 0.15);
    else if(mrtC > 20) r1 += Math.floor(mrtS * 0.10);
    else if(mrtC > 10) r1 += Math.floor(mrtS * 0.05);
    // 台鐵
    const traC = counts.tra || 0;
    const traS = originalSums.tra || 0;
    if(traC > 40) r1 += Math.floor(traS * 0.20);
    else if(traC > 20) r1 += Math.floor(traS * 0.15);
    else if(traC > 10) r1 += Math.floor(traS * 0.10);

    // Rule 2: TPASS 2.0 (實付)
    let r2 = 0;
    const railC = (counts.mrt||0) + (counts.tra||0) + (counts.tymrt||0) + (counts.lrt||0);
    const railS = (paidSums.mrt||0) + (paidSums.tra||0) + (paidSums.tymrt||0) + (paidSums.lrt||0);
    if(railC >= 11) r2 += Math.floor(railS * 0.02);

    const busC = (counts.bus||0) + (counts.coach||0);
    const busS = (paidSums.bus||0) + (paidSums.coach||0);
    if(busC > 30) r2 += Math.floor(busS * 0.30);
    else if(busC >= 11) r2 += Math.floor(busS * 0.15);

    return {
        totalPaid,
        rewards: r1 + r2,
        finalCost: totalPaid - r1 - r2,
        tripCount: trips.length
    };
}

// === 生成卡片 HTML ===
function createCardHtml(user, cycle, result) {
    const avatar = 'https://cdn-icons-png.flaticon.com/512/149/149071.png'; // 預設頭像
    const name = user.displayName || 'Anonymous';
    const email = user.email || 'No Email';
    
    if (!cycle) {
        // 無週期用戶樣式
        return `
        <div class="user-card">
            <div class="card-status-bar"></div>
            <div class="user-header">
                <img src="${avatar}" class="user-avatar">
                <div class="user-info">
                    <h3>${name}</h3>
                    <p>${email}</p>
                </div>
            </div>
            <div class="cycle-info" style="color:#555;">NO_ACTIVE_CYCLE</div>
        </div>`;
    }

    const start = new Date(cycle.start).toLocaleDateString();
    const end = new Date(cycle.end).toLocaleDateString();
    
    const diff = 1200 - result.finalCost;
    const isWin = diff < 0; // 回本 (花費 < 1200 ??? 不對，是回本計算邏輯)
    // 修正回本邏輯：如果 最終支出 < 1200，代表 1200月票比較貴 => 虧本 (Loss)
    // 如果 最終支出 > 1200，代表 1200月票比較便宜 => 賺到 (Win)
    // 等等，你的 App 邏輯是： finalCost 是「不用月票要花的錢」。
    // 所以 finalCost > 1200 是回本 (Win)。
    
    const isProfit = result.finalCost > 1200;
    const statusClass = isProfit ? 'status-win' : 'status-loss';
    const diffText = isProfit ? `PROFIT: $${Math.abs(diff)}` : `LOSS: $${diff}`;
    const resultColor = isProfit ? 'var(--neon-green)' : 'var(--neon-red)';

    return `
    <div class="user-card ${statusClass}">
        <div class="card-status-bar"></div>
        <div class="user-header">
            <img src="${avatar}" class="user-avatar">
            <div class="user-info">
                <h3>${name}</h3>
                <p>${email}</p>
            </div>
        </div>
        
        <div class="cycle-info">
            CYCLE: ${start} -> ${end}
        </div>

        <div class="data-row">
            <span>TRIPS_LOGGED</span>
            <span class="val-money">${result.tripCount}</span>
        </div>
        <div class="data-row">
            <span>REAL_SPEND</span>
            <span class="val-money">$${result.finalCost}</span>
        </div>
        
        <div style="margin-top:15px; border-top:1px dashed #333; padding-top:10px; display:flex; justify-content:space-between; align-items:center;">
            <small style="color:#666">TPASS_STATUS</small>
            <span class="val-result" style="color:${resultColor}">${diffText}</span>
        </div>
    </div>
    `;
}

refreshBtn.addEventListener('click', loadAllData);

// Init
loadAllData();