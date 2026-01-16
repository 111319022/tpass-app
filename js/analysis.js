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

// 確保有完整的 Transport Types Key
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

// === 2. DNA 獎章 (修正後) ===
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
    // 避免沒有行程時 reduce 出錯
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

    // [修正重點]：不再計算「省下多少錢」，而是計算「超過月票門檻多少錢」
    // 邏輯：原始總價值 - 1200 (月票成本) = 倒賺金額
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
    if (maxDaily >= 6) tags.push({ text: '🔋 能量滿點', color: '#fd79e4' });

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

// === [新功能] 渲染財務細項 (折疊選單) ===
function renderFinancialBreakdown(data) {
    const container = document.getElementById('financialBreakdown');
    if (!container) return;

    const sections = [
        {   
            id: 'original',
            title: '原始票價總額',
            sub: '',
            amount: `$${data.totalOriginal}`,
            color: '#333',
            items: data.original_details
        },
        {
            id: 'paid',
            title: '實際扣款總額',
            sub: '(扣轉乘)',
            amount: `$${data.totalPaid}`,
            color: '#333',
            items: data.paid_details
        },
        {
            id: 'r1',
            title: '常客優惠回饋 (R1)',
            sub: '',
            amount: `-$${data.r1_total}`,
            color: '#e67e22',
            items: data.r1_details
        },
        {
            id: 'r2',
            title: 'TPASS 2.0 回饋 (R2)',
            sub: '',
            amount: `-$${data.r2_total}`,
            color: '#e67e22',
            items: data.r2_details
        }
    ];

    let html = '';
    sections.forEach(sec => {
        const hasItems = sec.items && sec.items.length > 0;
        const pointerClass = hasItems ? 'cursor-pointer' : '';
        const iconHtml = hasItems ? `<i class="fa-solid fa-chevron-down arrow-icon"></i>` : '';
        
        let listHtml = '';
        if (hasItems) {
            listHtml = `<div class="finance-detail hidden">`;
            sec.items.forEach(item => {
                listHtml += `
                    <div class="finance-row">
                        <span>${item.text}</span>
                        <span style="font-family:monospace;">${item.amount}</span>
                    </div>`;
            });
            listHtml += `</div>`;
        }

        html += `
            <div class="finance-item ${pointerClass}" onclick="toggleFinanceItem(this)">
                <div class="finance-header">
                    <div class="fh-left">
                        <span class="fh-title">${sec.title} <small>${sec.sub}</small></span>
                    </div>
                    <div class="fh-right">
                        <span class="fh-amount" style="color:${sec.color}">${sec.amount}</span>
                        ${iconHtml}
                    </div>
                </div>
                ${listHtml}
            </div>
        `;
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

// === 6. ROI 圖表 (修正：全部時間累計模式下的階梯門檻) ===
function renderROIChart(trips) {
    const ctx = document.getElementById('roiChart').getContext('2d');
    if (chartInstances.roi) chartInstances.roi.destroy();
    
    // 1. 準備資料結構
    const dailyData = {}; 
    const monthlyStats = {}; 
    const rebateEvents = {}; 

    let minTime, maxTime;
    if (currentSelectedCycle) { minTime = currentSelectedCycle.start; maxTime = currentSelectedCycle.end; } 
    else { 
        if(trips.length > 0) { const times = trips.map(t => t.createdAt); minTime = Math.min(...times); maxTime = Math.max(...times); }
        else { const now = new Date(); minTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); maxTime = now.getTime(); }
    }

    // 初始化每天為 0
    for (let d = minTime; d <= maxTime; d += 86400000) {
        const dateObj = new Date(d); 
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0'); 
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const key = `${yyyy}/${mm}/${dd}`; 
        dailyData[key] = 0;
    }

    // 2. 統計每日「實付金額」並收集月度數據
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

    // 3. 計算並扣除每月回饋
    Object.keys(monthlyStats).forEach(month => {
        const cSums = monthlyStats[month];
        const gCounts = globalMonthlyCounts[month] || { mrt:0, tra:0, bus:0, coach:0 };
        
        let r1 = 0, r2 = 0;

        // R1
        let mrtRate = 0;
        if (gCounts.mrt > 40) mrtRate = 0.15; else if (gCounts.mrt > 20) mrtRate = 0.10; else if (gCounts.mrt > 10) mrtRate = 0.05;
        r1 += Math.floor(cSums.originalSums.mrt * mrtRate);

        let traRate = 0;
        if (gCounts.tra > 40) traRate = 0.20; else if (gCounts.tra > 20) traRate = 0.15; else if (gCounts.tra > 10) traRate = 0.10;
        r1 += Math.floor(cSums.originalSums.tra * traRate);

        // R2
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
            // 紀錄回饋事件
            rebateEvents[targetDate] = { r1: r1, r2: r2, total: totalRebate };
        }
    });

    // 4. 產生圖表數據
    const sortedKeys = Object.keys(dailyData).sort();
    const labels = sortedKeys.map(k => k.slice(5)); 
    const cumulativeData = []; let sum = 0;
    sortedKeys.forEach(key => { sum += dailyData[key]; cumulativeData.push(sum); });
    
    // [修正] 動態計算門檻
    let thresholdData = [];
    let thresholdLabel = '回本門檻 ($1200)';
    let isStepped = false;

    if (currentSelectedCycle) {
        thresholdData = new Array(labels.length).fill(1200);
    } else {
        // 全部時間模式：計算累積門檻
        thresholdLabel = '累積月票成本';
        isStepped = true; // 設定為階梯圖
        
        // 確保週期已排序
        const sortedCycles = (cycles || []).slice().sort((a, b) => a.start - b.start);

        thresholdData = sortedKeys.map(key => {
            const dateObj = new Date(key);
            const checkTime = dateObj.getTime();
            
            // 計算在該日期之前(含)有多少週期已經開始
            // 使用 > 0 以防沒有週期時顯示 0
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
                    stepped: isStepped // 套用階梯設定
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
                        label: function(context) { 
                            return context.dataset.label + ': $' + context.raw; 
                        },
                        // Footer Callback
                        footer: function(tooltipItems) {
                            const index = tooltipItems[0].dataIndex;
                            const dateKey = sortedKeys[index]; 
                            
                            if (rebateEvents[dateKey]) {
                                const evt = rebateEvents[dateKey];
                                return [
                                    '', 
                                    `🎁 本日扣除回饋: -$${evt.total}`,
                                    `   • R1 常客: -$${evt.r1}`,
                                    `   • R2 TPASS: -$${evt.r2}`
                                ];
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

function renderRecords(trips) {
    const container = document.getElementById('recordsGrid');
    if (!container) return; container.innerHTML = '';
    const dailyStats = {}; let maxSingleTrip = { price: 0, date: '', desc: '' };
    trips.forEach(t => {
        if (!dailyStats[t.dateStr]) dailyStats[t.dateStr] = { cost: 0, count: 0 };
        dailyStats[t.dateStr].cost += (t.originalPrice || 0); dailyStats[t.dateStr].count += 1;
        if ((t.originalPrice || 0) > maxSingleTrip.price) { maxSingleTrip = { price: t.originalPrice, date: t.dateStr.slice(5), desc: LABELS[t.type] || t.type }; }
    });
    let maxCostDay = { date: '--', val: 0 }; let maxCountDay = { date: '--', val: 0 };
    Object.entries(dailyStats).forEach(([date, data]) => {
        if (data.cost > maxCostDay.val) maxCostDay = { date: date.slice(5), val: data.cost };
        if (data.count > maxCountDay.val) maxCountDay = { date: date.slice(5), val: data.count };
    });
    const records = [
        { title: "單日最高價值", val: `$${maxCostDay.val}`, sub: maxCostDay.date, icon: "fa-money-bill-1-wave", color: "#e74c3c" },
        { title: "單日最忙碌", val: `${maxCountDay.val} 趟`, sub: maxCountDay.date, icon: "fa-person-running", color: "#f39c12" },
        { title: "單筆最貴行程", val: `$${maxSingleTrip.price}`, sub: `${maxSingleTrip.date} · ${maxSingleTrip.desc}`, icon: "fa-crown", color: "#8e44ad" }
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

// 供 HTML onclick 呼叫
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