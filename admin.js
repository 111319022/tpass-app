import { db, auth } from "./firebase-config.js"; // [修改] 引入 auth
import { collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; // [新增] 引入監聽器

const userGrid = document.getElementById('userGrid');
const totalUsersEl = document.getElementById('totalUsers');
const activeCyclesEl = document.getElementById('activeCycles');
const profitUsersEl = document.getElementById('profitUsers');
const refreshBtn = document.getElementById('refreshBtn');

// === [設定] 管理員 Email ===
// 請確認這裡填寫的是您要用來管理後台的 Google 帳號 Email
const ADMIN_EMAIL = "rayhsu63@gmail.com"; 

window.allTripsCache = {};

// 時間顯示
setInterval(() => {
    const now = new Date();
    document.getElementById('systemTime').innerText = now.toTimeString().split(' ')[0];
}, 1000);

// === [新增] 權限檢查與啟動 ===
// 只有在確認身分後，才執行 loadAllData
onAuthStateChanged(auth, (user) => {
    if (user && user.email === ADMIN_EMAIL) {
        // 是管理員，允許載入資料
        console.log("ADMIN ACCESS GRANTED");
        loadAllData();
    } else {
        // 不是管理員，或沒登入 -> 踢回首頁
        alert("ACCESS DENIED: 權限不足，無法訪問後台");
        window.location.replace("index.html");
    }
});

// === 核心：載入所有數據 ===
async function loadAllData() {
    userGrid.innerHTML = '<div class="loading-text">SCANNING DATABASE...</div>';
    window.allTripsCache = {}; 
    
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        
        let stats = { users: 0, active: 0, profit: 0 };
        stats.users = usersSnap.size;

        const userPromises = usersSnap.docs.map(async (userDoc) => {
            const uid = userDoc.id;
            const userData = userDoc.data();
            
            let currentCycle = null;
            if (userData.cycles && userData.cycles.length > 0) {
                const sorted = userData.cycles.sort((a, b) => b.start - a.start);
                currentCycle = sorted[0];
            } else if (userData.period) {
                currentCycle = userData.period;
            }

            if (!currentCycle) {
                return createCardHtml(uid, userData, null, null);
            }

            stats.active++;

            const tripsQ = query(
                collection(db, "users", uid, "trips"),
                where("createdAt", ">=", currentCycle.start),
                where("createdAt", "<=", currentCycle.end),
                orderBy("createdAt", "desc")
            );
            
            const tripsSnap = await getDocs(tripsQ);
            const trips = tripsSnap.docs.map(t => t.data());

            window.allTripsCache[uid] = trips;

            const result = calculateProfit(trips, userData.identity || 'adult');
            
            if (result.finalCost > 1200) stats.profit++;

            return createCardHtml(uid, userData, currentCycle, result);
        });

        const cards = await Promise.all(userPromises);
        userGrid.innerHTML = cards.join('');

        totalUsersEl.innerText = stats.users;
        activeCyclesEl.innerText = stats.active;
        profitUsersEl.innerText = stats.profit;

    } catch (e) {
        console.error(e);
        userGrid.innerHTML = `<div style="color:var(--neon-red); text-align:center;">ACCESS DENIED<br>${e.message}</div>`;
    }
}

// === 計算邏輯 (更新：回傳詳細 breakdown) ===
function calculateProfit(trips, identity) {
    const discount = (identity === 'student') ? 6 : 8;
    
    let totalOriginal = 0;
    let totalPaid = 0;
    
    let originalSums = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };
    let paidSums = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };
    let counts = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };

    trips.forEach(t => {
        let op = t.isFree ? 0 : t.originalPrice;
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) pp = t.isTransfer ? Math.max(0, t.originalPrice - discount) : t.originalPrice;

        const type = t.type || 'mrt'; 
        
        totalOriginal += op;
        totalPaid += pp;
        
        if (!originalSums[type]) originalSums[type] = 0;
        if (!paidSums[type]) paidSums[type] = 0;
        if (!counts[type]) counts[type] = 0;

        originalSums[type] += op;
        paidSums[type] += pp;
        counts[type]++;
    });

    // Rule 1: 常客回饋
    let r1 = 0;
    const mrtC = counts.mrt || 0;
    const mrtS = originalSums.mrt || 0;
    if(mrtC > 40) r1 += Math.floor(mrtS * 0.15);
    else if(mrtC > 20) r1 += Math.floor(mrtS * 0.10);
    else if(mrtC > 10) r1 += Math.floor(mrtS * 0.05);

    const traC = counts.tra || 0;
    const traS = originalSums.tra || 0;
    if(traC > 40) r1 += Math.floor(traS * 0.20);
    else if(traC > 20) r1 += Math.floor(traS * 0.15);
    else if(traC > 10) r1 += Math.floor(traS * 0.10);

    // Rule 2: TPASS 2.0
    let r2 = 0;
    const railC = (counts.mrt||0) + (counts.tra||0) + (counts.tymrt||0) + (counts.lrt||0);
    const railS = (paidSums.mrt||0) + (paidSums.tra||0) + (paidSums.tymrt||0) + (paidSums.lrt||0);
    if(railC >= 11) r2 += Math.floor(railS * 0.02);

    const busC = (counts.bus||0) + (counts.coach||0);
    const busS = (paidSums.bus||0) + (paidSums.coach||0);
    if(busC > 30) r2 += Math.floor(busS * 0.30);
    else if(busC >= 11) r2 += Math.floor(busS * 0.15);

    return {
        totalOriginal,
        totalPaid,
        rewards: r1 + r2,
        r1,
        r2,
        finalCost: totalPaid - r1 - r2,
        tripCount: trips.length,
        // [新增] 回傳明細供顯示
        originalSums,
        paidSums,
        counts
    };
}

// === [新增] 生成折疊明細 HTML 的輔助函式 ===
function generateBreakdownHtml(sums, counts) {
    let html = '';
    const typeNames = {
        mrt: 'MRT', bus: 'BUS', coach: 'HIGHWAY BUS', tra: 'TRA', 
        tymrt: 'TYMRT', lrt: 'LRT', bike: 'UBIKE'
    };

    for (const [key, val] of Object.entries(sums)) {
        if (val > 0) {
            html += `
            <div class="breakdown-row">
                <span>${typeNames[key]} (${counts[key]}T)</span>
                <span>$${val}</span>
            </div>`;
        }
    }
    return html || '<div class="breakdown-row"><span>NO_DATA</span></div>';
}

// === 生成卡片 HTML ===
function createCardHtml(uid, user, cycle, result) {
    const avatar = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    const name = user.displayName || 'Anonymous';
    const email = user.email || 'No Email';
    
    if (!cycle) {
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
    const isProfit = result.finalCost > 1200;
    const statusClass = isProfit ? 'status-win' : 'status-loss';
    const diffText = isProfit ? `PROFIT: $${Math.abs(diff)}` : `LOSS: $${diff}`;
    const resultColor = isProfit ? 'var(--neon-green)' : 'var(--neon-red)';

    // 生成明細
    const originalDetails = generateBreakdownHtml(result.originalSums, result.counts);
    const paidDetails = generateBreakdownHtml(result.paidSums, result.counts);

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

        <div class="data-group">
            <div class="data-row" style="margin-bottom:10px;">
                <span>TOTAL_TRIPS</span>
                <span class="val-money">${result.tripCount}</span>
            </div>

            <details class="price-details">
                <summary>
                    <span>ORIGINAL_PRICE</span>
                    <span class="val-money">$${result.totalOriginal}</span>
                </summary>
                <div class="breakdown-list">
                    ${originalDetails}
                </div>
            </details>

            <details class="price-details">
                <summary>
                    <span>ACTUAL_PAID</span>
                    <span class="val-money">$${result.totalPaid}</span>
                </summary>
                <div class="breakdown-list">
                    ${paidDetails}
                </div>
            </details>

            <div class="data-row" style="margin-top:10px;">
                <span>REWARDS_TOTAL</span>
                <span class="val-money" style="color:var(--neon-purple)">-$${result.rewards}</span>
            </div>
            <div class="reward-sub-row">
                <span>└ LOYALTY (R1)</span>
                <span>-$${result.r1}</span>
            </div>
            <div class="reward-sub-row">
                <span>└ TPASS 2.0 (R2)</span>
                <span>-$${result.r2}</span>
            </div>

            <div class="data-row" style="border-top:1px solid #333; margin-top:10px; padding-top:10px;">
                <span>REAL_SPEND</span>
                <span class="val-money" style="font-size:15px;">$${result.finalCost}</span>
            </div>
        </div>
        
        <div class="status-footer">
            <span class="val-result" style="color:${resultColor}">${diffText}</span>
        </div>

        <button class="view-logs-btn" onclick="openLogModal('${uid}', '${name}')">
            <i class="fa-solid fa-list-ul"></i> CMD: VIEW_LOGS
        </button>
    </div>
    `;
}

// === Modal 相關功能 (保持不變) ===
window.openLogModal = function(uid, name) {
    const modal = document.getElementById('logModal');
    const modalTitle = document.getElementById('modalUserName');
    const listBody = document.getElementById('modalLogList');
    
    modalTitle.innerText = `LOGS: ${name}`;
    listBody.innerHTML = '';

    const trips = window.allTripsCache[uid] || [];

    if (trips.length === 0) {
        listBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#555;">NO_DATA_FOUND</td></tr>';
    } else {
        trips.forEach(t => {
            const date = new Date(t.createdAt);
            const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
            
            let routeInfo = t.routeId || '';
            if (t.startStation && t.endStation) routeInfo += ` ${t.startStation}→${t.endStation}`;
            if (!routeInfo) routeInfo = '-';

            const typeMap = {
                mrt: 'MRT', bus: 'BUS', coach: 'HIGHWAY BUS', tra: 'TRA', tymrt: 'TYMRT', lrt: 'LRT', bike: 'UBIKE'
            };
            const typeStr = typeMap[t.type] || t.type.toUpperCase();

            const org = t.originalPrice;
            const pd = t.isFree ? 0 : (t.paidPrice !== undefined ? t.paidPrice : org);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${dateStr}</td>
                <td><span class="type-badge">${typeStr}</span></td>
                <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${routeInfo}</td>
                <td>$${org} / <span style="color:#aaa">$${pd}</span></td>
            `;
            listBody.appendChild(row);
        });
    }
    modal.classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('logModal').classList.add('hidden');
}

refreshBtn.addEventListener('click', loadAllData);

// [新增] 回到 App 按鈕監聽
document.getElementById('backBtn').addEventListener('click', () => {
    window.location.href = "app.html";
});