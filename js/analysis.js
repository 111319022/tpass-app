import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js";
import { collection, query, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 定義票價配置 (用於計算轉乘)
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

const ICONS = {
    mrt: 'fa-train-subway', bus: 'fa-bus', coach: 'fa-bus-simple',
    tra: 'fa-train', tymrt: 'fa-plane-departure', lrt: 'fa-train-tram', bike: 'fa-bicycle'
};

// 全域變數
let chartInstances = {};
let allTrips = []; 
let cycles = [];   
let currentSelectedCycle = null; 
let currentIdentity = 'adult'; // 預設身份，會從 firebase 讀取覆蓋

initAuthListener(async (user) => {
    if (!user) { window.location.href = "index.html"; return; }
    
    await loadUserSettings(user.uid);
    await fetchAllTrips(user.uid);
    renderAnalysis();
});

// === 資料讀取 ===

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
            if (data.identity) {
                currentIdentity = data.identity;
            }
        }
        renderCycleSelector();
    } catch (e) {
        console.error("讀取設定失敗", e);
    }
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
        const opt = document.createElement('option');
        opt.text = "無週期設定 (顯示全部)";
        opt.value = "all";
        selector.appendChild(opt);
        return;
    }

    const allOpt = document.createElement('option');
    allOpt.value = "all";
    allOpt.text = "📅 全部時間累計";
    selector.appendChild(allOpt);

    cycles.forEach((cycle, index) => {
        const opt = document.createElement('option');
        const start = new Date(cycle.start);
        const end = new Date(cycle.end);
        const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
        
        opt.value = index; 
        opt.text = `${fmt(start)} ~ ${fmt(end)} ${index === 0 ? '(最新)' : ''}`;
        selector.appendChild(opt);
    });

    selector.selectedIndex = 1; 
    currentSelectedCycle = cycles[0];

    selector.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === "all") currentSelectedCycle = null; 
        else currentSelectedCycle = cycles[val];
        renderAnalysis(); 
    });
}

// === 主渲染邏輯 ===

function renderAnalysis() {
    let tripsToAnalyze = [];

    if (currentSelectedCycle) {
        tripsToAnalyze = allTrips.filter(t => 
            t.createdAt >= currentSelectedCycle.start && 
            t.createdAt <= currentSelectedCycle.end
        );
    } else {
        tripsToAnalyze = allTrips;
    }

    // 防呆處理：無資料時清空畫面
    if (tripsToAnalyze.length === 0) {
        const safeSetText = (id, text) => { if(document.getElementById(id)) document.getElementById(id).innerText = text; };
        const safeSetHTML = (id, html) => { if(document.getElementById(id)) document.getElementById(id).innerHTML = html; };

        safeSetText('totalTrips', '0');
        safeSetText('daysToBreakEven', '--');
        safeSetHTML('dnaTags', '<span class="dna-tag" style="background:#eee;color:#888;">此週期無資料</span>');
        safeSetHTML('transportGrid', '');
        safeSetHTML('savingsGrid', '');
        safeSetHTML('routeRanking', '');
        
        Object.values(chartInstances).forEach(chart => chart.destroy());
        return;
    }

    renderSummary(tripsToAnalyze);
    renderDNA(tripsToAnalyze);
    renderSavingsAndRewards(tripsToAnalyze); // 執行優惠計算
    renderTransportGrid(tripsToAnalyze);     // 執行運具分析
    renderRouteRanking(tripsToAnalyze);
    renderROIChart(tripsToAnalyze);
    renderRadarChart(tripsToAnalyze);
}

// === 1. 總結與回本 ===
function renderSummary(trips) {
    const totalEl = document.getElementById('totalTrips');
    const daysLabel = document.getElementById('daysToBreakEven');
    if (!totalEl || !daysLabel) return;

    totalEl.innerText = trips.length;
    
    let labelSmall = daysLabel.nextElementSibling;
    if (!labelSmall) {
        labelSmall = document.createElement('small');
        daysLabel.parentNode.appendChild(labelSmall);
    }

    const sortedTrips = [...trips].sort((a, b) => a.createdAt - b.createdAt);
    
    let cumulativeCost = 0;
    let breakEvenDate = null;
    let totalCost = 0;

    for (let t of sortedTrips) {
        cumulativeCost += (t.originalPrice || 0);
        if (cumulativeCost >= 1200 && !breakEvenDate) breakEvenDate = new Date(t.dateStr);
        totalCost += (t.originalPrice || 0);
    }

    const startDate = new Date(sortedTrips[0].dateStr);
    
    if (breakEvenDate) {
        // 已回本
        const timeDiff = breakEvenDate - startDate;
        const daysUsed = Math.floor(timeDiff / (86400000)) + 1;
        daysLabel.innerText = daysUsed;
        daysLabel.style.color = "#27ae60"; 
        labelSmall.innerText = "天回本！"; 
    } else {
        // 未回本
        const lastDate = new Date(sortedTrips[sortedTrips.length - 1].dateStr);
        const daysPassed = Math.floor((lastDate - startDate) / (86400000)) + 1;
        const avgDailySpend = totalCost / daysPassed;
        const remainingAmount = 1200 - totalCost;
        
        let estimatedDays = 99;
        if (avgDailySpend > 0) estimatedDays = Math.ceil(remainingAmount / avgDailySpend);

        if (daysPassed <= 1 && trips.length < 3) {
            daysLabel.innerText = "分析中";
            daysLabel.style.color = "#666";
            labelSmall.innerText = "";
        } else {
            daysLabel.innerText = estimatedDays;
            daysLabel.style.color = "#e67e22"; 
            labelSmall.innerText = "天回本 (預估)";
        }
    }
}

// === 2. DNA (不變) ===
function renderDNA(trips) {
    const container = document.getElementById('dnaTags');
    if (!container) return;
    container.innerHTML = '';
    const counts = {};
    let totalCost = 0;
    trips.forEach(t => {
        counts[t.type] = (counts[t.type] || 0) + 1;
        totalCost += (t.originalPrice || 0);
    });
    const topMode = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    const tags = [];
    if (topMode === 'mrt') tags.push({ text: '🚇 北捷成癮者', color: '#0070BD' });
    else if (topMode === 'bus') tags.push({ text: '🚌 公車達人', color: '#2ECC71' });
    else if (topMode === 'tra') tags.push({ text: '🚆 鐵道迷', color: '#2C3E50' });
    else if (topMode === 'tymrt') tags.push({ text: '✈️ 國門飛人', color: '#8E44AD' });
    else tags.push({ text: '🚀 混合動力', color: '#E67E22' });
    if (trips.length > 50) tags.push({ text: '🔥 狂熱通勤', color: '#e74c3c' });
    else if (trips.length > 30) tags.push({ text: '📅 規律生活', color: '#f1c40f' });
    const hours = trips.map(t => new Date(t.createdAt).getHours());
    const earlyCount = hours.filter(h => h < 8).length;
    const lateCount = hours.filter(h => h > 21).length;
    if (earlyCount > trips.length * 0.3) tags.push({ text: '☀️ 早鳥部隊', color: '#3498db' });
    if (lateCount > trips.length * 0.2) tags.push({ text: '🌙 深夜旅人', color: '#9b59b6' });
    if (totalCost > 2000) tags.push({ text: '💰 回本大師', color: '#27ae60' });
    tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'dna-tag';
        span.style.border = `1px solid ${tag.color}`;
        span.innerHTML = tag.text;
        container.appendChild(span);
    });
}

// === 3. 四大優惠與回饋 (修正 Crash 問題) ===
function renderSavingsAndRewards(trips) {
    const grid = document.getElementById('savingsGrid');
    if (!grid) return; 
    grid.innerHTML = '';

    let freeSavings = 0;
    let transferSavings = 0;
    
    // R1/R2 需要按月統計
    let cycleMonthlyStats = {}; 
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        const op = t.originalPrice || 0;
        let pp = t.isFree ? 0 : t.paidPrice;
        
        // 如果沒有存 paidPrice，手動計算補上
        if (pp === undefined) {
             pp = t.isTransfer ? Math.max(0, op - discount) : op;
        }

        // 1. 免單省下的
        if (t.isFree) {
            freeSavings += op;
        } 
        // 2. 轉乘省下的 (原價 - 實付)
        else if (t.isTransfer) {
            transferSavings += (op - pp);
        }

        // 月份統計 (For R1/R2)
        const monthKey = t.dateStr.slice(0, 7);
        if (!cycleMonthlyStats[monthKey]) {
            cycleMonthlyStats[monthKey] = { originalSums: {}, paidSums: {} };
            // 初始化
            ['mrt', 'bus', 'coach', 'tra', 'tymrt', 'lrt', 'bike'].forEach(k => {
                cycleMonthlyStats[monthKey].originalSums[k] = 0; 
                cycleMonthlyStats[monthKey].paidSums[k] = 0;
            });
        }
        cycleMonthlyStats[monthKey].originalSums[t.type] += (t.isFree ? 0 : op);
        cycleMonthlyStats[monthKey].paidSums[t.type] += pp;
    });

    // 計算全球月份計數 (決定 R1 %數)
    let globalMonthlyCounts = {};
    allTrips.forEach(t => {
        const monthKey = t.dateStr.slice(0, 7);
        if (!globalMonthlyCounts[monthKey]) {
            globalMonthlyCounts[monthKey] = { mrt: 0, tra: 0, tymrt: 0, lrt: 0, bus: 0, coach: 0, bike: 0 };
        }
        globalMonthlyCounts[monthKey][t.type]++;
    });

    // 準備計算 R1/R2 的各項總額
    let r1_mrt_total = 0;
    let r1_tra_total = 0;
    let r2_rail_total = 0;
    let r2_bus_total = 0;

    Object.keys(cycleMonthlyStats).forEach(month => {
        const gCounts = globalMonthlyCounts[month] || { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0 };
        const cSums = cycleMonthlyStats[month];

        // R1: MRT
        const mrtCount = gCounts.mrt;
        const mrtSum = cSums.originalSums.mrt;
        let mrtRate = 0;
        if (mrtCount > 40) mrtRate = 0.15;
        else if (mrtCount > 20) mrtRate = 0.10;
        else if (mrtCount > 10) mrtRate = 0.05;
        r1_mrt_total += Math.floor(mrtSum * mrtRate);

        // R1: TRA
        const traCount = gCounts.tra;
        const traSum = cSums.originalSums.tra;
        let traRate = 0;
        if (traCount > 40) traRate = 0.20;
        else if (traCount > 20) traRate = 0.15;
        else if (traCount > 10) traRate = 0.10;
        r1_tra_total += Math.floor(traSum * traRate);

        // R2: Rail (2%)
        const railCount = gCounts.mrt + gCounts.tra + gCounts.tymrt + gCounts.lrt;
        const railPaidSum = cSums.paidSums.mrt + cSums.paidSums.tra + cSums.paidSums.tymrt + cSums.paidSums.lrt;
        if (railCount >= 11) {
            r2_rail_total += Math.floor(railPaidSum * 0.02);
        }

        // R2: Bus
        const busCount = gCounts.bus + gCounts.coach;
        const busPaidSum = cSums.paidSums.bus + cSums.paidSums.coach;
        let busRate = 0;
        if (busCount > 30) busRate = 0.30;
        else if (busCount >= 11) busRate = 0.15;
        r2_bus_total += Math.floor(busPaidSum * busRate);
    });

    const r1_total = r1_mrt_total + r1_tra_total;
    const r2_total = r2_rail_total + r2_bus_total;

    const r1_desc = `北捷 $${r1_mrt_total} · 台鐵 $${r1_tra_total}`;
    const r2_desc = `軌道 $${r2_rail_total} · 公車 $${r2_bus_total}`;

    const cardsData = [
        { title: "轉乘優惠省下", amount: transferSavings, class: "transfer", desc: "轉乘折扣累積" },
        { title: "免單省下金額", amount: freeSavings, class: "free", desc: "所得到的免費搭乘！" },
        { title: "常客回饋 (R1)", amount: r1_total, class: "r1", desc: r1_desc },
        { title: "TPASS 2.0 (R2)", amount: r2_total, class: "r2", desc: r2_desc }
    ];

    cardsData.forEach(d => {
        const div = document.createElement('div');
        div.className = `saving-card ${d.class}`;
        div.innerHTML = `
            <h4>${d.title}</h4>
            <div class="amount">$${d.amount}</div>
            <div class="detail" style="opacity:0.8;">${d.desc}</div>
        `;
        grid.appendChild(div);
    });
}

// === 4. 運具深度透視 (改用實際扣款) ===
function renderTransportGrid(trips) {
    const grid = document.getElementById('transportGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    let totalAllPaid = 0;
    const stats = {};
    
    trips.forEach(t => {
        if (!stats[t.type]) stats[t.type] = { count: 0, cost: 0, maxPrice: 0 };
        
        // 抓取實際扣款
        let pp = t.isFree ? 0 : t.paidPrice;
        if (pp === undefined) {
             pp = t.isTransfer ? Math.max(0, (t.originalPrice||0) - discount) : (t.originalPrice||0);
        }

        stats[t.type].count++;
        stats[t.type].cost += pp; // 累加實際扣款
        totalAllPaid += pp;

        // 最高單價 (顯示原價比較合理)
        const op = t.originalPrice || 0;
        if (op > stats[t.type].maxPrice) stats[t.type].maxPrice = op;
    });

    const sortedTypes = Object.keys(stats).sort((a, b) => stats[b].cost - stats[a].cost);

    sortedTypes.forEach(type => {
        const s = stats[type];
        if (s.count === 0) return;

        const avg = Math.round(s.cost / s.count);
        // 計算佔比 (基於總實際花費)
        const percent = totalAllPaid > 0 ? Math.round((s.cost / totalAllPaid) * 100) : 0;
        
        const color = COLORS[type];
        const icon = ICONS[type];
        const name = LABELS[type];

        const card = document.createElement('div');
        card.className = 't-card';
        card.style.borderLeftColor = color;
        
        card.innerHTML = `
            <div class="t-card-header">
                <div class="t-name" style="color:${color}"><i class="fa-solid ${icon}"></i> ${name}</div>
                <span class="t-count">${s.count} 趟</span>
            </div>
            
            <div class="t-stat-main">
                $${s.cost} <small>實付</small>
            </div>

            <div class="t-progress-bg">
                <div class="t-progress-bar" style="width: ${percent}%; background: ${color};"></div>
            </div>
            <div style="text-align:right; font-size:10px; color:#999; margin-bottom:8px;">
                佔總花費 ${percent}%
            </div>

            <div class="t-detail-grid">
                <div><span>平均實付</span><b>$${avg}</b></div>
                <div><span>最高原價</span><b>$${s.maxPrice}</b></div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// // === 5. 熱門路線排行榜 (整合起訖站與路線編號) ===
function renderRouteRanking(trips) {
    const list = document.getElementById('routeRanking');
    if (!list) return;
    list.innerHTML = '';

    const routes = {};

    trips.forEach(t => {
        let key = '';
        let displayName = '';
        let typeIcon = '';

        // 邏輯 A: 公車/客運 -> 優先使用 Route ID
        if ((t.type === 'bus' || t.type === 'coach') && t.routeId) {
            key = `${t.type}_${t.routeId}`;
            displayName = `${t.routeId} 路${t.type === 'coach' ? '客運' : '公車'}`;
            typeIcon = t.type === 'coach' ? 'fa-bus-simple' : 'fa-bus';
        } 
        // 邏輯 B: 軌道運輸 (捷運/台鐵) -> 使用 起訖站
        else if (t.startStation && t.endStation) {
            // 自動排序起訖站，讓 A->B 和 B->A 視為同一條
            const stations = [t.startStation, t.endStation].sort();
            key = `stations_${stations.join('_')}`;
            displayName = `${stations[0]} ↔ ${stations[1]}`;
            typeIcon = ICONS[t.type] || 'fa-train'; // 使用對應運具 icon
        }
        // 邏輯 C: 其他 (Ubike 或資料不全) -> 使用運具名稱
        else {
            key = `type_${t.type}`;
            displayName = LABELS[t.type] || t.type;
            typeIcon = ICONS[t.type] || 'fa-circle';
        }

        if (!routes[key]) {
            routes[key] = { 
                name: displayName, 
                count: 0, 
                totalCost: 0,
                icon: typeIcon,
                color: COLORS[t.type] || '#666'
            };
        }
        
        routes[key].count++;
        // 累加實際花費 (paidPrice)，如果沒有則用原價
        const cost = (t.paidPrice !== undefined) ? t.paidPrice : t.originalPrice;
        routes[key].totalCost += (cost || 0);
    });

    // 排序：依照搭乘次數 (高 -> 低)
    const sortedRoutes = Object.values(routes)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5); // 取前五名

    if (sortedRoutes.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#ccc;padding:10px;">尚無足夠資料分析路線</div>';
        return;
    }

    sortedRoutes.forEach((item, index) => {
        const rank = index + 1;
        const div = document.createElement('div');
        div.className = 'route-item';
        
        // 增加 Icon 顯示，讓列表更直觀
        div.innerHTML = `
            <div class="route-rank top-${rank}">${rank}</div>
            <div class="route-icon" style="color:${item.color}; margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid ${item.icon}"></i>
            </div>
            <div class="route-info">
                <div class="route-name">${item.name}</div>
                <div class="route-detail">累計 ${item.count} 趟</div>
            </div>
            <div class="route-total">$${item.totalCost}</div>
        `;
        list.appendChild(div);
    });
}

// === 6. 圖表 (修正日期排序錯亂問題) ===
function renderROIChart(trips) {
    const ctx = document.getElementById('roiChart').getContext('2d');
    
    if (chartInstances.roi) {
        chartInstances.roi.destroy();
    }

    // 使用 YYYY/MM/DD 作為 Key，確保跨年時排序正確
    const dailyData = {};
    let minTime, maxTime;

    // 1. 決定時間範圍
    if (currentSelectedCycle) {
        minTime = currentSelectedCycle.start;
        maxTime = currentSelectedCycle.end;
    } else {
        if (trips.length > 0) {
            const times = trips.map(t => t.createdAt);
            minTime = Math.min(...times);
            maxTime = Math.max(...times);
        } else {
            // 無資料時預設顯示本月
            const now = new Date();
            minTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            maxTime = now.getTime();
        }
    }

    // 2. 初始化每一天 (填入 0)
    for (let d = minTime; d <= maxTime; d += 86400000) {
        const dateObj = new Date(d);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        
        // [關鍵修正] Key 包含年份：YYYY/MM/DD
        const key = `${yyyy}/${mm}/${dd}`;
        dailyData[key] = 0;
    }

    // 3. 填入數據
    trips.forEach(t => {
        // t.dateStr 格式通常為 YYYY/MM/DD，直接匹配即可
        // 如果格式不一致，這裡會自動忽略，確保數據安全
        if (dailyData[t.dateStr] !== undefined) {
            dailyData[t.dateStr] += (t.originalPrice || 0);
        }
    });

    // 4. 排序 Key (因為有年份，所以 2025/12 會排在 2026/01 前面)
    const sortedKeys = Object.keys(dailyData).sort();
    
    // 5. 產生圖表用的 Labels (這時候再把年份切掉，只顯示 MM/DD)
    const labels = sortedKeys.map(k => k.slice(5)); // 切掉前5字元 (YYYY/)
    
    // 6. 計算累積金額
    const cumulativeData = [];
    let sum = 0;
    sortedKeys.forEach(key => {
        sum += dailyData[key];
        cumulativeData.push(sum);
    });

    const thresholdData = new Array(labels.length).fill(1200);

    chartInstances.roi = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '累積價值',
                    data: cumulativeData,
                    borderColor: '#6c5ce7',
                    backgroundColor: 'rgba(108, 92, 231, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2
                },
                {
                    label: '回本門檻 ($1200)',
                    data: thresholdData,
                    borderColor: '#ff7675',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.raw;
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true }
            }
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