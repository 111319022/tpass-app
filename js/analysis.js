// js/analysis.js

import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js";
import { collection, query, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === 定義票價與設定 ===
const FARE_CONFIG = {
    adult: { busBase: 15, transferDiscount: 8 },
    student: { busBase: 12, transferDiscount: 6 }
};

const COLORS = {
    mrt: '#0070BD', bus: '#2ECC71', coach: '#16A085',
    tra: '#2C3E50', tymrt: '#8E44AD', lrt: '#F39C12', bike: '#D35400'
};

const LABELS = {
    mrt: '北捷', bus: '公車', coach: '客運', tra: '台鐵',
    tymrt: '機捷', lrt: '輕軌', bike: 'Ubike'
};

const TRANSPORT_TYPES = {
    mrt: 'mrt', bus: 'bus', coach: 'coach',
    tra: 'tra', tymrt: 'tymrt', lrt: 'lrt', bike: 'bike'
};

const ICONS = {
    mrt: 'fa-train-subway', bus: 'fa-bus', coach: 'fa-bus-simple',
    tra: 'fa-train', tymrt: 'fa-plane-departure', lrt: 'fa-train-tram', bike: 'fa-bicycle'
};

// === 全域變數 ===
let chartInstances = {};
let allTrips = []; 
let cycles = [];   
let currentSelectedCycle = null; 
let currentIdentity = 'adult'; 

// === 初始化 ===
initAuthListener(async (user) => {
    if (!user) { window.location.href = "index.html"; return; }
    await loadUserSettings(user.uid);
    await fetchAllTrips(user.uid);
    renderAnalysis();
});

// === 讀取設定與資料 ===
async function loadUserSettings(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.cycles && Array.isArray(data.cycles)) {
                cycles = data.cycles.sort((a, b) => b.start - a.start);
            } else if (data.period) {
                cycles = [data.period];
            }
            if (data.identity) currentIdentity = data.identity;
        }
        renderCycleSelector();
    } catch (e) { console.error("讀取設定失敗", e); }
}

async function fetchAllTrips(uid) {
    const q = query(collection(db, "users", uid, "trips"), orderBy("createdAt", "asc"));
    const snapshot = await getDocs(q);
    allTrips = snapshot.docs.map(doc => doc.data());
}

function renderCycleSelector() {
    const selector = document.getElementById('cycleSelector');
    if(!selector) return;
    selector.innerHTML = '';
    if (cycles.length === 0) {
        const opt = document.createElement('option'); opt.text = "無週期設定 (顯示全部)"; opt.value = "all"; selector.appendChild(opt); return;
    }
    const allOpt = document.createElement('option'); allOpt.value = "all"; allOpt.text = "📅 全部時間累計"; selector.appendChild(allOpt);
    cycles.forEach((cycle, index) => {
        const opt = document.createElement('option');
        const start = new Date(cycle.start); const end = new Date(cycle.end);
        const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
        opt.value = index; opt.text = `${fmt(start)} ~ ${fmt(end)} ${index === 0 ? '(最新)' : ''}`;
        selector.appendChild(opt);
    });
    selector.selectedIndex = 1; currentSelectedCycle = cycles[0];
    selector.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === "all") currentSelectedCycle = null; else currentSelectedCycle = cycles[val];
        renderAnalysis(); 
    });
}

// === 核心：財務計算函式 ===
function calculateFinancials(trips) {
    let totalOriginal = 0;
    let totalPaid = 0;
    let freeSavings = 0;
    let transferSavings = 0;
    
    let typeOriginalSums = {}; 
    let typePaidSums = {};
    let typeCounts = {};
    
    Object.keys(TRANSPORT_TYPES).forEach(k => { 
        typeOriginalSums[k] = 0; 
        typePaidSums[k] = 0; 
        typeCounts[k] = 0; 
    });

    let cycleMonthlyStats = {}; 
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        const op = t.originalPrice || 0;
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) pp = t.isTransfer ? Math.max(0, op - discount) : op;

        totalOriginal += op;
        totalPaid += pp;

        if (typePaidSums[t.type] !== undefined) {
            typeOriginalSums[t.type] += op; 
            typePaidSums[t.type] += pp;     
            typeCounts[t.type]++;
        }

        if (t.isFree) freeSavings += op;
        else if (t.isTransfer) transferSavings += (op - pp);

        const monthKey = t.dateStr.slice(0, 7);
        if (!cycleMonthlyStats[monthKey]) {
            cycleMonthlyStats[monthKey] = { originalSums: {}, paidSums: {} };
            ['mrt', 'bus', 'coach', 'tra', 'tymrt', 'lrt', 'bike'].forEach(k => {
                cycleMonthlyStats[monthKey].originalSums[k] = 0; 
                cycleMonthlyStats[monthKey].paidSums[k] = 0;
            });
        }
        cycleMonthlyStats[monthKey].originalSums[t.type] += (t.isFree ? 0 : op);
        cycleMonthlyStats[monthKey].paidSums[t.type] += pp;
    });

    let globalMonthlyCounts = {};
    allTrips.forEach(t => {
        const monthKey = t.dateStr.slice(0, 7);
        if (!globalMonthlyCounts[monthKey]) globalMonthlyCounts[monthKey] = { mrt: 0, tra: 0, tymrt: 0, lrt: 0, bus: 0, coach: 0, bike: 0 };
        globalMonthlyCounts[monthKey][t.type]++;
    });

    let r1_mrt_total = 0, r1_tra_total = 0, r2_rail_total = 0, r2_bus_total = 0;
    let r1_details = [];
    let r2_details = [];

    const sortedMonths = Object.keys(cycleMonthlyStats).sort();

    sortedMonths.forEach(month => {
        const monthLabel = `${month.split('/')[1]}月`;
        const gCounts = globalMonthlyCounts[month] || { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0 };
        const cSums = cycleMonthlyStats[month];

        // R1
        const mrtCount = gCounts.mrt;
        const mrtSum = cSums.originalSums.mrt;
        let mrtRate = 0;
        if (mrtCount > 40) mrtRate = 0.15; else if (mrtCount > 20) mrtRate = 0.10; else if (mrtCount > 10) mrtRate = 0.05;
        const mrtRebate = Math.floor(mrtSum * mrtRate);
        r1_mrt_total += mrtRebate;
        if (mrtRebate > 0) {
            r1_details.push({ text: `<span class="m-badge">${monthLabel}</span> 北捷累計 ${mrtCount} 趟 (${Math.round(mrtRate*100)}%)`, amount: `-$${mrtRebate}` });
        }

        const traCount = gCounts.tra;
        const traSum = cSums.originalSums.tra;
        let traRate = 0;
        if (traCount > 40) traRate = 0.20; else if (traCount > 20) traRate = 0.15; else if (traCount > 10) traRate = 0.10;
        const traRebate = Math.floor(traSum * traRate);
        r1_tra_total += traRebate;
        if (traRebate > 0) {
            r1_details.push({ text: `<span class="m-badge">${monthLabel}</span> 台鐵累計 ${traCount} 趟 (${Math.round(traRate*100)}%)`, amount: `-$${traRebate}` });
        }

        // R2
        const railCount = gCounts.mrt + gCounts.tra + gCounts.tymrt + gCounts.lrt;
        const railPaidSum = cSums.paidSums.mrt + cSums.paidSums.tra + cSums.paidSums.tymrt + cSums.paidSums.lrt;
        if (railCount >= 11) {
            const railRebate = Math.floor(railPaidSum * 0.02);
            r2_rail_total += railRebate;
            if (railRebate > 0) {
                r2_details.push({ text: `<span class="m-badge">${monthLabel}</span> 軌道累計 ${railCount} 趟 (2%)`, amount: `-$${railRebate}` });
            }
        }

        const busCount = gCounts.bus + gCounts.coach;
        const busPaidSum = cSums.paidSums.bus + cSums.paidSums.coach;
        let busRate = 0;
        if (busCount > 30) busRate = 0.30; else if (busCount >= 11) busRate = 0.15;
        const busRebate = Math.floor(busPaidSum * busRate);
        r2_bus_total += busRebate;
        if (busRebate > 0) {
            r2_details.push({ text: `<span class="m-badge">${monthLabel}</span> 公車累計 ${busCount} 趟 (${Math.round(busRate*100)}%)`, amount: `-$${busRebate}` });
        }
    });

    const r1_total = r1_mrt_total + r1_tra_total;
    const r2_total = r2_rail_total + r2_bus_total;

    let original_details = [];
    Object.keys(typeOriginalSums).sort((a,b) => typeOriginalSums[b] - typeOriginalSums[a]).forEach(type => {
        if (typeOriginalSums[type] > 0) {
            original_details.push({
                text: `${LABELS[type]} (${typeCounts[type]} 趟)`,
                amount: `$${typeOriginalSums[type]}`
            });
        }
    });

    let paid_details = [];
    Object.keys(typePaidSums).sort((a,b) => typePaidSums[b] - typePaidSums[a]).forEach(type => {
        if (typePaidSums[type] > 0) {
            paid_details.push({
                text: `${LABELS[type]} (${typeCounts[type]} 趟)`,
                amount: `$${typePaidSums[type]}`
            });
        }
    });

    return {
        totalOriginal,
        totalPaid,
        freeSavings,
        transferSavings,
        r1_total,
        r2_total,
        r1_desc: `北捷 $${r1_mrt_total} · 台鐵 $${r1_tra_total}`,
        r2_desc: `軌道 $${r2_rail_total} · 公車 $${r2_bus_total}`,
        original_details, 
        paid_details,
        r1_details,
        r2_details
    };
}

// === 主渲染函式 ===
function renderAnalysis() {
    let tripsToAnalyze = [];
    if (currentSelectedCycle) {
        tripsToAnalyze = allTrips.filter(t => t.createdAt >= currentSelectedCycle.start && t.createdAt <= currentSelectedCycle.end);
    } else {
        tripsToAnalyze = allTrips;
    }

    if (tripsToAnalyze.length === 0) {
        const setHtml = (id, val) => { if(document.getElementById(id)) document.getElementById(id).innerHTML = val; };
        setHtml('totalTrips', '0');
        setHtml('daysToBreakEven', '--');
        setHtml('dnaTags', '<span class="dna-tag" style="background:#eee;color:#888;">此週期無資料</span>');
        setHtml('vsContainer', ''); 
        setHtml('financialBreakdown', ''); 
        setHtml('transportGrid', '');
        setHtml('savingsGrid', '');
        setHtml('recordsGrid', '');
        setHtml('heatmapContainer', '');
        setHtml('weekStatsContainer', '');
        setHtml('routeRanking', '');
        Object.values(chartInstances).forEach(chart => chart.destroy());
        return;
    }

    const financeData = calculateFinancials(tripsToAnalyze);

    renderSummary(tripsToAnalyze);
    renderVsBlock(financeData); // [新增] 渲染 VS 區塊
    renderDNA(tripsToAnalyze, financeData);
    renderFinancialBreakdown(financeData); 
    renderSavingsAndRewards(financeData);
    renderTransportGrid(tripsToAnalyze);     
    renderRouteRanking(tripsToAnalyze);
    renderROIChart(tripsToAnalyze); 
    renderRadarChart(tripsToAnalyze);
    renderRecords(tripsToAnalyze);
    renderHeatmap(tripsToAnalyze);
    renderWeekStats(tripsToAnalyze);

    // [新增] 初始化分享按鈕 (傳入數據)
    initShareButton(financeData, tripsToAnalyze);
}

// === 1. 總結與回本 ===
function renderSummary(trips) {
    const totalEl = document.getElementById('totalTrips');
    const daysLabel = document.getElementById('daysToBreakEven');
    if (!totalEl || !daysLabel) return;
    totalEl.innerText = trips.length;
    let labelSmall = daysLabel.nextElementSibling;
    if (!labelSmall) { labelSmall = document.createElement('small'); daysLabel.parentNode.appendChild(labelSmall); }
    const sortedTrips = [...trips].sort((a, b) => a.createdAt - b.createdAt);
    let cumulativeCost = 0; let breakEvenDate = null; let totalCost = 0;
    for (let t of sortedTrips) {
        cumulativeCost += (t.originalPrice || 0);
        if (cumulativeCost >= 1200 && !breakEvenDate) breakEvenDate = new Date(t.dateStr);
        totalCost += (t.originalPrice || 0);
    }
    const startDate = new Date(sortedTrips[0].dateStr);
    if (breakEvenDate) {
        const timeDiff = breakEvenDate - startDate;
        const daysUsed = Math.floor(timeDiff / (86400000)) + 1;
        daysLabel.innerText = daysUsed; daysLabel.style.color = "#27ae60"; labelSmall.innerText = "天回本！"; 
    } else {
        const lastDate = new Date(sortedTrips[sortedTrips.length - 1].dateStr);
        const daysPassed = Math.floor((lastDate - startDate) / (86400000)) + 1;
        const avgDailySpend = totalCost / daysPassed;
        const remainingAmount = 1200 - totalCost;
        let estimatedDays = 99;
        if (avgDailySpend > 0) estimatedDays = Math.ceil(remainingAmount / avgDailySpend);
        if (daysPassed <= 1 && trips.length < 3) {
            daysLabel.innerText = "分析中"; daysLabel.style.color = "#666"; labelSmall.innerText = "";
        } else {
            daysLabel.innerText = estimatedDays; daysLabel.style.color = "#e67e22"; labelSmall.innerText = "天回本 (預估)";
        }
    }
}

// === [修正] 渲染實際總支出 vs 月票區塊 ===
function renderVsBlock(financeData) {
    const container = document.getElementById('vsContainer');
    if (!container) return;

    // 計算 TPASS 成本
    let tpassCost = 1200;
    if (!currentSelectedCycle) { 
        tpassCost = Math.max(cycles.length, 1) * 1200;
    }

    // [核心修正 1] 實際淨支出 = 實際扣款 - R1回饋 - R2回饋
    // 這才是您真正從口袋付出去的錢
    const netActualCost = financeData.totalPaid - financeData.r1_total - financeData.r2_total;
    
    // [核心修正 2] 差額 = 淨支出 - TPASS成本
    // 如果 淨支出(3000) > TPASS(1200) => 差額 +1800 => 代表買TPASS省了1800 (WIN)
    // 如果 淨支出(1000) < TPASS(1200) => 差額 -200 => 代表買TPASS多花了200 (LOSS)
    const diff = netActualCost - tpassCost;
    
    let statusBg = diff > 0 ? '#27ae60' : '#c0392b';
    let statusText = diff > 0 ? `省下 $${diff}` : `倒貼 $${Math.abs(diff)}`;
    let statusIcon = diff > 0 ? '🎉 已回本！' : '💸 尚未回本';
    
    // 背景漸層：回本(綠)、未回本(紅)
    let bgGradient = diff > 0 
        ? "linear-gradient(135deg, #1d976c, #93f9b9)"
        : "linear-gradient(135deg, #cb2d3e, #ef473a)";

    container.innerHTML = `
        <div style="background: #2d3436; border-radius: 20px; padding: 20px; color: white; box-shadow: 0 5px 15px rgba(0,0,0,0.2); position: relative; overflow: hidden;">
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0.15; background:${bgGradient}; z-index:0;"></div>
            
            <div style="display: flex; justify-content: space-around; align-items: center; position: relative; z-index: 2;">
                <div style="text-align: center;">
                    <div style="font-size: 12px; opacity: 0.8; margin-bottom: 5px;">實際總支出 (扣回饋)</div>
                    <div style="font-size: 24px; font-weight: bold;">$${netActualCost}</div>
                </div>
                <div style="font-size: 20px; font-weight: 900; font-style: italic; opacity: 0.5;">VS</div>
                <div style="text-align: center;">
                    <div style="font-size: 12px; opacity: 0.8; margin-bottom: 5px;">TPASS 成本</div>
                    <div style="font-size: 24px; font-weight: bold;">$${tpassCost}</div>
                </div>
            </div>
            
            <div style="margin-top: 15px; background: rgba(0,0,0,0.2); border-radius: 12px; padding: 8px; text-align: center; backdrop-filter: blur(5px); position: relative; z-index: 2;">
                <span style="font-weight: bold; color: ${diff > 0 ? '#2ecc71' : '#ff7675'};">
                    ${statusIcon} ${statusText}
                </span>
            </div>

            <div style="position: absolute; bottom: -10px; right: -10px; font-size: 80px; font-weight: 900; color: white; opacity: 0.05; pointer-events: none;">
                ${diff > 0 ? 'WIN' : 'LOSS'}
            </div>
        </div>
    `;
}

// === 2. DNA 獎章 ===
function renderDNA(trips, financeData) {
    const container = document.getElementById('dnaTags');
    if (!container) return;
    container.innerHTML = '';

    const counts = {};
    const hours = [];
    const dailyCounts = {};

    trips.forEach(t => {
        counts[t.type] = (counts[t.type] || 0) + 1;
        hours.push(new Date(t.createdAt).getHours());
        dailyCounts[t.dateStr] = (dailyCounts[t.dateStr] || 0) + 1;
    });

    const totalTrips = trips.length;
    const topMode = Object.keys(counts).length > 0 
        ? Object.keys(counts).reduce((a, b) => (counts[a] || 0) > (counts[b] || 0) ? a : b)
        : '';
        
    const tags = [];

    if (topMode === 'mrt') tags.push({ text: '🚇 北捷成癮者', color: '#00d2ff' });
    else if (topMode === 'bus') tags.push({ text: '🚌 公車達人', color: '#2ecc71' });
    else if (topMode === 'tra') tags.push({ text: '🚆 鐵道迷', color: '#bdc3c7' });
    else if (topMode === 'tymrt') tags.push({ text: '✈️ 國門飛人', color: '#9b59b6' });
    else if (topMode) tags.push({ text: '🚀 混合動力', color: '#f1c40f' });

    if (totalTrips > 100) tags.push({ text: '🔥 狂熱通勤', color: '#ff7675' });
    else if (totalTrips > 50) tags.push({ text: '📅 規律生活', color: '#55efc4' });

    const profit = financeData.totalOriginal - 1200;
    if (profit > 1200) tags.push({ text: '💸 倒賺省長', color: '#ffeaa7' }); 
    else if (profit > 0) tags.push({ text: '💰 回本大師', color: '#55efc4' });

    const earlyCount = hours.filter(h => h < 8).length;
    const lateCount = hours.filter(h => h > 21).length;
    const lunchCount = hours.filter(h => h >= 11 && h <= 13).length;

    if (earlyCount > totalTrips * 0.3) tags.push({ text: '☀️ 早鳥部隊', color: '#74b9ff' });
    if (lateCount > totalTrips * 0.2) tags.push({ text: '🌙 深夜旅人', color: '#a29bfe' });
    if (lunchCount > totalTrips * 0.15) tags.push({ text: '🍱 午間遊俠', color: '#ffb8b8' });

    const railCount = (counts.mrt || 0) + (counts.tra || 0) + (counts.tymrt || 0) + (counts.lrt || 0);
    if (railCount > totalTrips * 0.8) tags.push({ text: '🚉 軌道之友', color: '#81ecec' });
    
    if (counts.bike > 10) tags.push({ text: '🚴 腳動力先鋒', color: '#55efc4' });
    if (counts.coach > 5) tags.push({ text: '🏙️ 跨區移動者', color: '#fab1a0' });

    const maxDaily = Math.max(...Object.values(dailyCounts));
    if (maxDaily >= 10) tags.push({ text: '🔋 能量滿點', color: '#fd79e4' });

    tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'dna-tag';
        span.style.background = 'rgba(255, 255, 255, 0.15)'; 
        span.style.color = tag.color;
        span.style.border = 'none'; 
        span.style.fontWeight = 'bold';
        span.style.textShadow = '0px 1px 2px rgba(0,0,0,0.2)';
        span.innerHTML = tag.text;
        container.appendChild(span);
    });
}

// === 渲染財務細項 ===
function renderFinancialBreakdown(data) {
    const container = document.getElementById('financialBreakdown');
    if (!container) return;

    const sections = [
        { id: 'original', title: '原始票價總額', sub: '', amount: `$${data.totalOriginal}`, color: '#333', items: data.original_details },
        { id: 'paid', title: '實際扣款總額', sub: '(扣轉乘)', amount: `$${data.totalPaid}`, color: '#333', items: data.paid_details },
        { id: 'r1', title: '常客優惠回饋 (R1)', sub: '', amount: `-$${data.r1_total}`, color: '#e67e22', items: data.r1_details },
        { id: 'r2', title: 'TPASS 2.0 回饋 (R2)', sub: '', amount: `-$${data.r2_total}`, color: '#e67e22', items: data.r2_details }
    ];

    let html = '';
    sections.forEach(sec => {
        const hasItems = sec.items && sec.items.length > 0;
        const pointerClass = hasItems ? 'cursor-pointer' : '';
        const iconHtml = hasItems ? `<i class="fa-solid fa-chevron-down arrow-icon"></i>` : '';
        let listHtml = '';
        if (hasItems) {
            listHtml = `<div class="finance-detail hidden">`;
            sec.items.forEach(item => { listHtml += `<div class="finance-row"><span>${item.text}</span><span style="font-family:monospace;">${item.amount}</span></div>`; });
            listHtml += `</div>`;
        }
        html += `<div class="finance-item ${pointerClass}" onclick="toggleFinanceItem(this)"><div class="finance-header"><div class="fh-left"><span class="fh-title">${sec.title} <small>${sec.sub}</small></span></div><div class="fh-right"><span class="fh-amount" style="color:${sec.color}">${sec.amount}</span>${iconHtml}</div></div>${listHtml}</div>`;
    });
    container.innerHTML = html;
}

// === 3. 優惠與回饋 ===
function renderSavingsAndRewards(data) {
    const grid = document.getElementById('savingsGrid');
    if (!grid) return; grid.innerHTML = '';
    const cardsData = [
        { title: "轉乘優惠省下", amount: data.transferSavings, class: "transfer", desc: "轉乘折扣累積" },
        { title: "免單省下金額", amount: data.freeSavings, class: "free", desc: "所得到的免費搭乘！" },
        { title: "常客回饋 (R1)", amount: data.r1_total, class: "r1", desc: data.r1_desc },
        { title: "TPASS 2.0 (R2)", amount: data.r2_total, class: "r2", desc: data.r2_desc }
    ];
    cardsData.forEach(d => {
        const div = document.createElement('div'); div.className = `saving-card ${d.class}`;
        div.innerHTML = `<h4>${d.title}</h4><div class="amount">$${d.amount}</div><div class="detail" style="opacity:0.8;">${d.desc}</div>`;
        grid.appendChild(div);
    });
}

// === 4. 運具深度透視 ===
function renderTransportGrid(trips) {
    const grid = document.getElementById('transportGrid');
    if (!grid) return; grid.innerHTML = '';
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    let totalAllPaid = 0; const stats = {};
    trips.forEach(t => {
        if (!stats[t.type]) stats[t.type] = { count: 0, cost: 0, maxPrice: 0 };
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) pp = t.isTransfer ? Math.max(0, (t.originalPrice||0) - discount) : (t.originalPrice||0);
        stats[t.type].count++; stats[t.type].cost += pp; totalAllPaid += pp;
        const op = t.originalPrice || 0; if (op > stats[t.type].maxPrice) stats[t.type].maxPrice = op;
    });
    const sortedTypes = Object.keys(stats).sort((a, b) => stats[b].cost - stats[a].cost);
    sortedTypes.forEach(type => {
        const s = stats[type]; if (s.count === 0) return;
        const avg = Math.round(s.cost / s.count);
        const percent = totalAllPaid > 0 ? Math.round((s.cost / totalAllPaid) * 100) : 0;
        const color = COLORS[type]; const icon = ICONS[type]; const name = LABELS[type];
        const card = document.createElement('div'); card.className = 't-card'; card.style.borderLeftColor = color;
        card.innerHTML = `<div class="t-card-header"><div class="t-name" style="color:${color}"><i class="fa-solid ${icon}"></i> ${name}</div><span class="t-count">${s.count} 趟</span></div><div class="t-stat-main">$${s.cost} <small>實付</small></div><div class="t-progress-bg"><div class="t-progress-bar" style="width: ${percent}%; background: ${color};"></div></div><div style="text-align:right; font-size:10px; color:#999; margin-bottom:8px;">佔總花費 ${percent}%</div><div class="t-detail-grid"><div><span>平均實付</span><b>$${avg}</b></div><div><span>最高原價</span><b>$${s.maxPrice}</b></div></div>`;
        grid.appendChild(card);
    });
}

// === 5. 熱門路線 ===
function renderRouteRanking(trips) {
    const list = document.getElementById('routeRanking');
    if (!list) return; list.innerHTML = '';
    const routes = {};
    trips.forEach(t => {
        let key = ''; let displayName = ''; let typeIcon = '';
        if ((t.type === 'bus' || t.type === 'coach') && t.routeId) {
            key = `${t.type}_${t.routeId}`; displayName = `${t.routeId} 路${t.type === 'coach' ? '客運' : '公車'}`; typeIcon = t.type === 'coach' ? 'fa-bus-simple' : 'fa-bus';
        } else if (t.startStation && t.endStation) {
            const stations = [t.startStation, t.endStation].sort();
            key = `stations_${stations.join('_')}`; displayName = `${stations[0]} ↔ ${stations[1]}`; typeIcon = ICONS[t.type] || 'fa-train';
        } else {
            key = `type_${t.type}`; displayName = LABELS[t.type] || t.type; typeIcon = ICONS[t.type] || 'fa-circle';
        }
        if (!routes[key]) routes[key] = { name: displayName, count: 0, totalCost: 0, icon: typeIcon, color: COLORS[t.type] || '#666' };
        routes[key].count++; const cost = (t.paidPrice !== undefined) ? t.paidPrice : t.originalPrice; routes[key].totalCost += (cost || 0);
    });
    const sortedRoutes = Object.values(routes).sort((a, b) => b.count - a.count).slice(0, 5);
    if (sortedRoutes.length === 0) { list.innerHTML = '<div style="text-align:center;color:#ccc;padding:10px;">尚無足夠資料分析路線</div>'; return; }
    sortedRoutes.forEach((item, index) => {
        const rank = index + 1; const div = document.createElement('div'); div.className = 'route-item';
        div.innerHTML = `<div class="route-rank top-${rank}">${rank}</div><div class="route-icon" style="color:${item.color}; margin-right:10px; width:20px; text-align:center;"><i class="fa-solid ${item.icon}"></i></div><div class="route-info"><div class="route-name">${item.name}</div><div class="route-detail">累計 ${item.count} 趟</div></div><div class="route-total">$${item.totalCost}</div>`;
        list.appendChild(div);
    });
}

// === 6. ROI 圖表 ===
function renderROIChart(trips) {
    const ctx = document.getElementById('roiChart').getContext('2d');
    if (chartInstances.roi) chartInstances.roi.destroy();
    
    const dailyData = {}; 
    const monthlyStats = {}; 
    const rebateEvents = {}; 

    let minTime, maxTime;
    if (currentSelectedCycle) { minTime = currentSelectedCycle.start; maxTime = currentSelectedCycle.end; } 
    else { 
        if(trips.length > 0) { const times = trips.map(t => t.createdAt); minTime = Math.min(...times); maxTime = Math.max(...times); }
        else { const now = new Date(); minTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); maxTime = now.getTime(); }
    }

    for (let d = minTime; d <= maxTime; d += 86400000) {
        const dateObj = new Date(d); 
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0'); 
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const key = `${yyyy}/${mm}/${dd}`; 
        dailyData[key] = 0;
    }

    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    let globalMonthlyCounts = {}; 

    allTrips.forEach(t => {
        const monthKey = t.dateStr.slice(0, 7);
        if (!globalMonthlyCounts[monthKey]) globalMonthlyCounts[monthKey] = { mrt: 0, tra: 0, tymrt: 0, lrt: 0, bus: 0, coach: 0, bike: 0 };
        globalMonthlyCounts[monthKey][t.type]++;
    });

    trips.forEach(t => {
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) pp = t.isTransfer ? Math.max(0, (t.originalPrice||0) - discount) : (t.originalPrice||0);
        if (dailyData[t.dateStr] !== undefined) dailyData[t.dateStr] += pp;

        const monthKey = t.dateStr.slice(0, 7);
        if (!monthlyStats[monthKey]) {
            monthlyStats[monthKey] = { originalSums: {}, paidSums: {} };
            ['mrt', 'bus', 'coach', 'tra', 'tymrt', 'lrt', 'bike'].forEach(k => {
                monthlyStats[monthKey].originalSums[k] = 0; 
                monthlyStats[monthKey].paidSums[k] = 0;
            });
        }
        monthlyStats[monthKey].originalSums[t.type] += (t.isFree ? 0 : (t.originalPrice||0));
        monthlyStats[monthKey].paidSums[t.type] += pp;
    });

    Object.keys(monthlyStats).forEach(month => {
        const cSums = monthlyStats[month];
        const gCounts = globalMonthlyCounts[month] || { mrt:0, tra:0, bus:0, coach:0 };
        let r1 = 0, r2 = 0;
        let mrtRate = 0;
        if (gCounts.mrt > 40) mrtRate = 0.15; else if (gCounts.mrt > 20) mrtRate = 0.10; else if (gCounts.mrt > 10) mrtRate = 0.05;
        r1 += Math.floor(cSums.originalSums.mrt * mrtRate);
        let traRate = 0;
        if (gCounts.tra > 40) traRate = 0.20; else if (gCounts.tra > 20) traRate = 0.15; else if (gCounts.tra > 10) traRate = 0.10;
        r1 += Math.floor(cSums.originalSums.tra * traRate);
        const railCount = gCounts.mrt + gCounts.tra + gCounts.tymrt + gCounts.lrt;
        const railPaidSum = cSums.paidSums.mrt + cSums.paidSums.tra + cSums.paidSums.tymrt + cSums.paidSums.lrt;
        if (railCount >= 11) r2 += Math.floor(railPaidSum * 0.02);
        const busCount = gCounts.bus + gCounts.coach;
        const busPaidSum = cSums.paidSums.bus + cSums.paidSums.coach;
        let busRate = 0;
        if (busCount > 30) busRate = 0.30; else if (busCount >= 11) busRate = 0.15;
        r2 += Math.floor(busPaidSum * busRate);
        const totalRebate = r1 + r2;
        const tripsInMonth = trips.filter(t => t.dateStr.startsWith(month));
        let targetDate;
        if (tripsInMonth.length > 0) {
            tripsInMonth.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
            targetDate = tripsInMonth[tripsInMonth.length - 1].dateStr;
        } else {
            const datesInCycle = Object.keys(dailyData).filter(d => d.startsWith(month)).sort();
            if (datesInCycle.length > 0) {
                targetDate = datesInCycle[datesInCycle.length - 1];
            }
        }
        if (targetDate && dailyData[targetDate] !== undefined) {
            dailyData[targetDate] -= totalRebate;
            rebateEvents[targetDate] = { r1: r1, r2: r2, total: totalRebate };
        }
    });

    const sortedKeys = Object.keys(dailyData).sort();
    const labels = sortedKeys.map(k => k.slice(5)); 
    const cumulativeData = []; let sum = 0;
    sortedKeys.forEach(key => { sum += dailyData[key]; cumulativeData.push(sum); });
    
    let thresholdData = [];
    let thresholdLabel = '回本門檻 ($1200)';
    let isStepped = false;

    if (currentSelectedCycle) {
        thresholdData = new Array(labels.length).fill(1200);
    } else {
        thresholdLabel = '累積月票成本';
        isStepped = true; 
        const sortedCycles = (cycles || []).slice().sort((a, b) => a.start - b.start);
        thresholdData = sortedKeys.map(key => {
            const dateObj = new Date(key);
            const checkTime = dateObj.getTime();
            const activeCycles = sortedCycles.filter(c => c.start <= checkTime).length;
            return Math.max(activeCycles, 1) * 1200; 
        });
    }

    chartInstances.roi = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: '累積實際花費', data: cumulativeData, borderColor: '#6c5ce7', backgroundColor: 'rgba(108, 92, 231, 0.1)', fill: true, tension: 0.4, pointRadius: 2 },
                { 
                    label: thresholdLabel, 
                    data: thresholdData, 
                    borderColor: '#ff7675', 
                    borderDash: [5, 5], 
                    pointRadius: 0, 
                    borderWidth: 2,
                    stepped: isStepped 
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, 
            interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { position: 'bottom' }, 
                tooltip: { 
                    callbacks: { 
                        label: function(context) { return context.dataset.label + ': $' + context.raw; },
                        footer: function(tooltipItems) {
                            const index = tooltipItems[0].dataIndex;
                            const dateKey = sortedKeys[index]; 
                            if (rebateEvents[dateKey]) {
                                const evt = rebateEvents[dateKey];
                                return ['', `🎁 本日扣除回饋: -$${evt.total}`, `   • R1 常客: -$${evt.r1}`, `   • R2 TPASS: -$${evt.r2}`];
                            }
                            return [];
                        }
                    } 
                } 
            },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderRadarChart(trips) {
    const ctx = document.getElementById('radarChart').getContext('2d');
    if (chartInstances.radar) chartInstances.radar.destroy();
    let stats = [0, 0, 0, 0, 0, 0]; 
    trips.forEach(t => {
        const date = new Date(t.createdAt);
        const day = date.getDay(); 
        const hour = date.getHours(); 
        if (day === 0 || day === 6) stats[1]++; else stats[0]++;
        if (hour >= 6 && hour < 12) stats[2]++; else if (hour >= 12 && hour < 18) stats[3]++; else if (hour >= 18 && hour <= 23) stats[4]++; else stats[5]++;
    });
    chartInstances.radar = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['平日出勤', '假日出遊', '上午時段', '下午時段', '晚上時段', '深夜清晨'],
            datasets: [{ label: '行程頻率', data: stats, fill: true, backgroundColor: 'rgba(52, 152, 219, 0.2)', borderColor: '#3498db', pointBackgroundColor: '#3498db', pointBorderColor: '#fff', pointHoverBackgroundColor: '#fff', pointHoverBorderColor: '#3498db' }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { angleLines: { display: true }, suggestedMin: 0 } }, plugins: { legend: { display: false } } }
    });
}

// === 7. 單日記錄 (修正為實際扣款) ===
function renderRecords(trips) {
    const container = document.getElementById('recordsGrid');
    if (!container) return; container.innerHTML = '';
    
    const dailyStats = {}; 
    let maxSingleTrip = { price: 0, date: '', desc: '' };
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        // [修正] 計算單筆實際扣款金額
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) pp = t.isTransfer ? Math.max(0, (t.originalPrice||0) - discount) : (t.originalPrice||0);

        if (!dailyStats[t.dateStr]) dailyStats[t.dateStr] = { cost: 0, count: 0 };
        dailyStats[t.dateStr].cost += pp; // 累計實際扣款
        dailyStats[t.dateStr].count += 1;
        
        // 找最貴單筆 (實際扣款)
        if (pp > maxSingleTrip.price) { 
            maxSingleTrip = { price: pp, date: t.dateStr.slice(5), desc: LABELS[t.type] || t.type }; 
        }
    });

    let maxCostDay = { date: '--', val: 0 }; 
    let maxCountDay = { date: '--', val: 0 };
    
    Object.entries(dailyStats).forEach(([date, data]) => {
        if (data.cost > maxCostDay.val) maxCostDay = { date: date.slice(5), val: data.cost };
        if (data.count > maxCountDay.val) maxCountDay = { date: date.slice(5), val: data.count };
    });

    const records = [
        // [修正] 標題加上「實付」以示區別
        { title: "單日最高實付", val: `$${maxCostDay.val}`, sub: maxCostDay.date, icon: "fa-money-bill-1-wave", color: "#e74c3c" },
        { title: "單日最忙碌", val: `${maxCountDay.val} 趟`, sub: maxCountDay.date, icon: "fa-person-running", color: "#f39c12" },
        { title: "單筆最貴實付", val: `$${maxSingleTrip.price}`, sub: `${maxSingleTrip.date} · ${maxSingleTrip.desc}`, icon: "fa-crown", color: "#8e44ad" }
    ];

    records.forEach(r => {
        const div = document.createElement('div'); div.className = 'record-card';
        div.innerHTML = `<div class="rec-icon" style="background:${r.color}20; color:${r.color}"><i class="fa-solid ${r.icon}"></i></div><div class="rec-info"><small>${r.title}</small><div class="rec-val">${r.val}</div><div class="rec-sub">${r.sub}</div></div>`;
        container.appendChild(div);
    });
}

function renderHeatmap(trips) {
    const container = document.getElementById('heatmapContainer');
    if (!container) return; container.innerHTML = '';
    const dailyCost = {}; let minTime, maxTime;
    if (currentSelectedCycle) { minTime = currentSelectedCycle.start; maxTime = currentSelectedCycle.end; } 
    else { const now = new Date(); minTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); maxTime = now.getTime(); }
    trips.forEach(t => { if (!dailyCost[t.dateStr]) dailyCost[t.dateStr] = 0; dailyCost[t.dateStr] += (t.originalPrice || 0); });
    for (let d = minTime; d <= maxTime; d += 86400000) {
        const dateObj = new Date(d); const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0'); const dd = String(dateObj.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}/${mm}/${dd}`; const cost = dailyCost[dateStr] || 0;
        let level = 0; if (cost > 200) level = 4; else if (cost > 100) level = 3; else if (cost > 50) level = 2; else if (cost > 0) level = 1;
        const cell = document.createElement('div'); cell.className = `heatmap-cell level-${level}`; cell.title = `${dateStr.slice(5)}: $${cost}`; 
        if (new Date(d).toDateString() === new Date().toDateString()) cell.style.border = "1px solid #333";
        container.appendChild(cell);
    }
}

function renderWeekStats(trips) {
    const container = document.getElementById('weekStatsContainer');
    if (!container) return; container.innerHTML = '';
    let weekdayVal = 0; let weekendVal = 0;
    trips.forEach(t => {
        const date = new Date(t.createdAt); const day = date.getDay(); const val = t.originalPrice || 0;
        if (day === 0 || day === 6) weekendVal += val; else weekdayVal += val;
    });
    const total = weekdayVal + weekendVal;
    const wdPct = total > 0 ? Math.round((weekdayVal / total) * 100) : 0;
    const wePct = total > 0 ? 100 - wdPct : 0;
    container.innerHTML = `<div class="week-stat-bar"><div class="ws-segment weekday" style="width:${wdPct}%"></div><div class="ws-segment weekend" style="width:${wePct}%"></div></div><div class="week-stat-labels"><div class="ws-label"><span class="dot weekday"></span> 平日貢獻 $${weekdayVal} <small>(${wdPct}%)</small></div><div class="ws-label"><span class="dot weekend"></span> 假日貢獻 $${weekendVal} <small>(${wePct}%)</small></div></div><div class="week-insight">${getWeekInsight(wdPct, weekendVal)}</div>`;
}

function getWeekInsight(wdPct, weekendVal) {
    if (weekendVal > 500) return "🔥 週末戰士！您在假日充分利用了 TPASS！";
    if (wdPct > 90) return "💼 您是標準的上班通勤族，假日都在休息嗎？";
    if (wdPct > 60) return "⚖️ 工作與生活平衡，假日偶爾也會出門晃晃。";
    return "🚀 數據分析中...";
}

window.toggleFinanceItem = function(el) {
    const detail = el.querySelector('.finance-detail');
    const arrow = el.querySelector('.arrow-icon');
    if (detail) {
        detail.classList.toggle('hidden');
        if (arrow) {
            if (detail.classList.contains('hidden')) {
                arrow.style.transform = 'rotate(0deg)';
            } else {
                arrow.style.transform = 'rotate(180deg)';
            }
        }
    }
}

// === [新增] 社交分享功能 ===
function initShareButton(financeData, trips) {
    const btn = document.getElementById('shareBtn');
    if (!btn) return;

    // 避免重複綁定 (移除舊的 listener 比較麻煩，這裡用簡單的覆蓋 onclick)
    btn.onclick = async () => {
        const originalHtml = btn.innerHTML;
        // 變成轉圈圈圖示
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; 
        btn.disabled = true;

        try {
            await generateAndShareImage(financeData, trips);
        } catch (err) {
            console.error('Share failed:', err);
            alert('分享圖片製作失敗，請稍後再試。');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    };
}

// [修正版] analysis.js - 修正回本邏輯
async function generateAndShareImage(data, trips) {
    const container = document.getElementById('shareCardContainer'); 
    const card = document.getElementById('shareCard');
    const tpassCost = 1200; 
    
    // 1. 基礎數據計算
    let finalCost = data.finalCost;
    if (finalCost === undefined) {
        // 相容性處理
        const r1 = data.r1 ? data.r1.amount : (data.r1_total || 0);
        const r2 = data.r2 ? data.r2.amount : (data.r2_total || 0);
        finalCost = data.totalPaid - r1 - r2;
    }
    const diff = finalCost - tpassCost; // 正數=省下, 負數=虧損
    
    // --- 填入基本資訊 ---
    if (trips.length > 0) {
        const sortedTrips = [...trips].sort((a,b) => a.createdAt - b.createdAt);
        const start = new Date(sortedTrips[0].createdAt);
        const end = new Date(sortedTrips[sortedTrips.length - 1].createdAt);
        const dateElem = document.getElementById('scDate');
        if (dateElem) {
            dateElem.innerText = `${start.getMonth()+1}/${start.getDate()} ~ ${end.getMonth()+1}/${end.getDate()}`;
        }
    }
    const totalElem = document.getElementById('scTotal');
    if (totalElem) {
        totalElem.innerText = `$${Math.floor(finalCost)}`;
    }
    
    // --- 結果框 ---
    const resBox = document.getElementById('scResultBox');
    const resText = document.getElementById('scResultText');
    const resIcon = resBox.querySelector('i');
    resBox.classList.remove('sc-win', 'sc-loss');
    
    if (diff >= 0) {
        resBox.classList.add('sc-win');
        resIcon.className = "fa-solid fa-check-circle";
        resText.innerText = `已回本！省下 $${Math.floor(diff)}`;
    } else {
        resBox.classList.add('sc-loss');
        resIcon.className = "fa-solid fa-person-running";
        resText.innerText = `尚未回本 (差 $${Math.floor(Math.abs(diff))})`;
    }

    // === [新增功能] 填入運具詳細列表 ===
    const listContainer = document.getElementById('scTransportList');
    if (listContainer && data.paid_details && data.paid_details.length > 0) {
        listContainer.innerHTML = '';
        
        // 定義顯示名稱與圖示
        const typeConfig = {
            mrt: { label: '北捷', icon: 'fa-train-subway', color: '#0070BD' },
            bus: { label: '公車', icon: 'fa-bus', color: '#2ECC71' },
            coach: { label: '客運', icon: 'fa-bus-simple', color: '#16A085' },
            tra: { label: '台鐵', icon: 'fa-train', color: '#2C3E50' },
            tymrt: { label: '機捷', icon: 'fa-plane-departure', color: '#8E44AD' },
            lrt: { label: '輕軌', icon: 'fa-train-tram', color: '#F39C12' },
            bike: { label: 'Ubike', icon: 'fa-bicycle', color: '#D35400' }
        };

        // 顯示前 4 項的實付明細
        const displayCount = Math.min(4, data.paid_details.length);
        for (let i = 0; i < displayCount; i++) {
            const detail = data.paid_details[i];
            const div = document.createElement('div');
            div.className = 'sc-row';
            
            // 從 detail.text 中提取運具名稱和趟數，例如："北捷 (25 趟)"
            const match = detail.text.match(/^(.+?)\s*\((\d+)\s*趟\)/);
            const typeName = match ? match[1] : detail.text;
            const tripCount = match ? match[2] : '?';
            
            // 找對應的 typeConfig
            let config = null;
            for (const [key, cfg] of Object.entries(typeConfig)) {
                if (cfg.label === typeName) {
                    config = cfg;
                    break;
                }
            }
            config = config || { label: typeName, icon: 'fa-circle', color: '#555' };
            
            // 從 detail.amount 提取金額，例如："$500"
            const amount = detail.amount.replace('$', '');
            
            div.innerHTML = `
                <span style="color:${config.color}"><i class="fa-solid ${config.icon}"></i> ${config.label}</span>
                <b>${tripCount}</b>
                <small>$${amount}</small>
            `;
            listContainer.appendChild(div);
        }
        
        // 如果項目超過 4 個，顯示「...及其他」
        if (data.paid_details.length > 4) {
             const moreDiv = document.createElement('div');
             moreDiv.className = 'sc-row';
             moreDiv.style.justifyContent = 'center';
             moreDiv.style.opacity = '0.5';
             moreDiv.style.fontSize = '10px';
             moreDiv.innerText = '...及其他細項';
             listContainer.appendChild(moreDiv);
        }
    }

    // === [新增功能] 填入回饋金資訊 ===
    const rewardsContainer = document.getElementById('scRewardsInfo');
    if (rewardsContainer) {
        // 從 data 取得 R1 和 R2 的金額
        const r1 = data.r1_total || 0;
        const r2 = data.r2_total || 0;
        const totalRewards = r1 + r2;

        if (totalRewards > 0) {
            rewardsContainer.style.display = 'block';
            let rewardsHTML = '';
            
            // 顯示 R1（常客回饋）
            if (r1 > 0) {
                rewardsHTML += `<div class="sc-reward-row"><span>常客回饋</span><span>-$${Math.floor(r1)}</span></div>`;
            }
            
            // 顯示 R2（TPASS回饋）
            if (r2 > 0) {
                rewardsHTML += `<div class="sc-reward-row"><span>TPASS回饋</span><span>-$${Math.floor(r2)}</span></div>`;
            }
            
            // 總計
            rewardsHTML += `<div class="sc-reward-row sc-reward-total"><span><i class="fa-solid fa-coins"></i> 合計回饋</span><span>-$${Math.floor(totalRewards)}</span></div>`;
            
            rewardsContainer.innerHTML = rewardsHTML;
        } else {
            rewardsContainer.style.display = 'none'; // 沒有回饋就隱藏
        }
    }

    // --- (以下維持不變：DNA 標籤與截圖邏輯) ---
    const sourceTags = document.getElementById('dnaTags');
    const targetTags = document.getElementById('scTags');
    targetTags.innerHTML = '';
    if (sourceTags) {
        const tags = sourceTags.querySelectorAll('.dna-tag');
        if (tags.length === 0) {
             targetTags.innerHTML = '<span style="font-size:12px; color:#aaa;">分析中...</span>';
        } else {
            tags.forEach((tag, index) => {
                if (index < 4) { // 這裡可以控制標籤數量
                    const clone = tag.cloneNode(true);
                    targetTags.appendChild(clone);
                }
            });
        }
    }

    let canvas;
    try {
        container.classList.add('show');
        await new Promise(r => setTimeout(r, 100));
        canvas = await html2canvas(card, {
            scale: 3, 
            useCORS: true, 
            backgroundColor: null
        });
    } catch (e) {
        console.error("截圖失敗:", e);
        throw e;
    } finally {
        container.classList.remove('show');
    }

    return new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
            if (!blob) { reject(new Error('Canvas is empty')); return; }
            const file = new File([blob], "tpass-report.png", { type: "image/png" });
            if (navigator.share && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: '我的 TPASS 通勤戰績',
                        text: `這個月我實際花了 $${Math.floor(finalCost)}，${diff >= 0 ? '省下了 $' + Math.floor(diff) : '還差 $' + Math.floor(Math.abs(diff))}！ #TPASS計算機`
                    });
                    resolve(); 
                } catch (err) { if (err.name !== 'AbortError') reject(err); else resolve(); }
            } else {
                try {
                    const link = document.createElement('a');
                    link.download = 'tpass-report.png';
                    link.href = canvas.toDataURL();
                    link.click();
                    alert('圖片已下載！您可以手動分享到社群軟體。');
                    resolve();
                } catch (e) { reject(e); }
            }
        }, 'image/png');
    });
}