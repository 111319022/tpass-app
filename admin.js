import { db, auth } from "./firebase-config.js"; 
import { collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 

const userGrid = document.getElementById('userGrid');
const totalUsersEl = document.getElementById('totalUsers');
const activeCyclesEl = document.getElementById('activeCycles');
const profitUsersEl = document.getElementById('profitUsers');
const refreshBtn = document.getElementById('refreshBtn');

// === [設定] 管理員 Email ===
const ADMIN_EMAIL = "rayhsu63@gmail.com"; 

window.allTripsCache = {};

// 時間顯示
setInterval(() => {
    const now = new Date();
    document.getElementById('systemTime').innerText = now.toTimeString().split(' ')[0];
}, 1000);

// === 權限檢查與啟動 ===
onAuthStateChanged(auth, (user) => {
    if (user && user.email === ADMIN_EMAIL) {
        console.log("ADMIN ACCESS GRANTED");
        loadAllData();
    } else {
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

// === [修正] 計算邏輯：支援跨月拆分計算 + 英文月份 ===
function calculateProfit(trips, identity) {
    const discount = (identity === 'student') ? 6 : 8;
    
    // 1. 全域累計 (用於顯示卡片上的總數與車種統計)
    let totalOriginal = 0;
    let totalPaid = 0;
    
    let originalSums = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };
    let paidSums = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };
    let counts = { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 };

    // 用於計算優惠的月份統計 (Key: YYYY/MM)
    let monthlyStats = {};

    trips.forEach(t => {
        let op = t.isFree ? 0 : t.originalPrice;
        let pp = t.isFree ? 0 : t.paidPrice;
        
        if (pp === undefined) {
             pp = t.isTransfer ? Math.max(0, t.originalPrice - discount) : t.originalPrice;
        }

        const type = t.type || 'mrt'; 
        
        // --- A. 累加全域數據 ---
        totalOriginal += op;
        totalPaid += pp;
        
        if (originalSums[type] === undefined) originalSums[type] = 0;
        if (paidSums[type] === undefined) paidSums[type] = 0;
        if (counts[type] === undefined) counts[type] = 0;

        originalSums[type] += op;
        paidSums[type] += pp;
        counts[type]++;

        // --- B. 累加月份數據 ---
        const dateStr = t.dateStr || '';
        const monthKey = dateStr.slice(0, 7); // 取出 "YYYY/MM"

        if (monthKey) {
            if (!monthlyStats[monthKey]) {
                monthlyStats[monthKey] = {
                    counts: { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 },
                    originalSums: { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 },
                    paidSums: { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0, bike:0 }
                };
            }
            const mData = monthlyStats[monthKey];
            
            if (!mData.counts[type]) mData.counts[type] = 0;
            if (!mData.originalSums[type]) mData.originalSums[type] = 0;
            if (!mData.paidSums[type]) mData.paidSums[type] = 0;

            mData.counts[type]++;
            mData.originalSums[type] += op;
            mData.paidSums[type] += pp;
        }
    });

    // 2. 依照月份分別計算優惠，並生成詳細文字
    let r1 = 0;
    let r2 = 0;
    let r1_details = [];
    let r2_details = [];

    // 定義英文月份陣列
    const enMonthNames = ["JAN.", "FEB.", "MAR.", "APR.", "MAY.", "JUN.", "JUL.", "AUG.", "SEP.", "OCT.", "NOV.", "DEC."];

    const sortedMonths = Object.keys(monthlyStats).sort();

    sortedMonths.forEach(month => {
        const mData = monthlyStats[month];
        
        // [修改] 將月份數字轉換為英文縮寫
        // month 格式為 "YYYY/MM"，取出 MM (1~12)
        const monthIndex = parseInt(month.split('/')[1], 10) - 1; 
        const monthLabel = (monthIndex >= 0 && monthIndex < 12) ? enMonthNames[monthIndex] : 'UNK.';

        // === Rule 1: 常客回饋 (MRT/TRA) ===
        const mrtC = mData.counts.mrt || 0;
        const mrtS = mData.originalSums.mrt || 0;
        let mrtRate = 0;
        if(mrtC > 40) mrtRate = 0.15;
        else if(mrtC > 20) mrtRate = 0.10;
        else if(mrtC > 10) mrtRate = 0.05;

        if (mrtRate > 0) {
            const amt = Math.floor(mrtS * mrtRate);
            r1 += amt;
            r1_details.push({
                text: `<span class="month-badge">${monthLabel}</span>TPE MRT ${mrtC}T，REFOUND ${Math.round(mrtRate*100)}%`,
                amount: amt
            });
        }

        const traC = mData.counts.tra || 0;
        const traS = mData.originalSums.tra || 0;
        let traRate = 0;
        if(traC > 40) traRate = 0.20;
        else if(traC > 20) traRate = 0.15;
        else if(traC > 10) traRate = 0.10;
        
        if (traRate > 0) {
            const amt = Math.floor(traS * traRate);
            r1 += amt;
            r1_details.push({
                text: `<span class="month-badge">${monthLabel}</span>台鐵 ${traC} 趟，回饋 ${Math.round(traRate*100)}%`,
                amount: amt
            });
        }

        // === Rule 2: TPASS 2.0 (軌道/公車) ===
        const railC = (mData.counts.mrt||0) + (mData.counts.tra||0) + (mData.counts.tymrt||0) + (mData.counts.lrt||0);
        const railS = (mData.paidSums.mrt||0) + (mData.paidSums.tra||0) + (mData.paidSums.tymrt||0) + (mData.paidSums.lrt||0);
        
        if(railC >= 11) {
            const amt = Math.floor(railS * 0.02);
            r2 += amt;
            r2_details.push({
                text: `<span class="month-badge">${monthLabel}</span>RAILWAYS ${railC}T，REFOUND 2%`,
                amount: amt
            });
        }

        const busC = (mData.counts.bus||0) + (mData.counts.coach||0);
        const busS = (mData.paidSums.bus||0) + (mData.paidSums.coach||0);
        let busRate = 0;
        if(busC > 30) busRate = 0.30;
        else if(busC >= 11) busRate = 0.15;
        
        if (busRate > 0) {
            const amt = Math.floor(busS * busRate);
            r2 += amt;
            r2_details.push({
                text: `<span class="month-badge">${monthLabel}</span>BUSES ${busC}T，REFOUND ${Math.round(busRate*100)}%`,
                amount: amt
            });
        }
    });

    return {
        totalOriginal,
        totalPaid,
        rewards: r1 + r2,
        r1,
        r2,
        r1_details,
        r2_details,
        finalCost: totalPaid - r1 - r2,
        tripCount: trips.length,
        originalSums,
        paidSums,
        counts
    };
}

// === 生成折疊明細 HTML 的輔助函式 ===
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

    const originalDetails = generateBreakdownHtml(result.originalSums, result.counts);
    const paidDetails = generateBreakdownHtml(result.paidSums, result.counts);

    // [新增] 生成 R1 細項 HTML
    const r1DetailsHtml = result.r1_details.length > 0 ? result.r1_details.map(d => `
        <div class="reward-detail-row">
            <span>${d.text}</span>
            <span>-$${d.amount}</span>
        </div>
    `).join('') : '<div class="reward-detail-row"><span>NO_DATA</span></div>';

    // [新增] 生成 R2 細項 HTML
    const r2DetailsHtml = result.r2_details.length > 0 ? result.r2_details.map(d => `
        <div class="reward-detail-row">
            <span>${d.text}</span>
            <span>-$${d.amount}</span>
        </div>
    `).join('') : '<div class="reward-detail-row"><span>NO_DATA</span></div>';

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
            ${r1DetailsHtml}

            <div class="reward-sub-row" style="margin-top:5px;">
                <span>└ TPASS 2.0 (R2)</span>
                <span>-$${result.r2}</span>
            </div>
            ${r2DetailsHtml}

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

// === Modal 相關功能 ===
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

document.getElementById('backBtn').addEventListener('click', () => {
    window.location.href = "app.html";
});