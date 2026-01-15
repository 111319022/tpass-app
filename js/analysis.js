// js/analysis.js
import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js";
import { collection, query, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let allTrips = []; // 所有的行程
let cycles = [];   // 所有的週期設定
let currentSelectedCycle = null; // 當前選中的週期

initAuthListener(async (user) => {
    if (!user) { window.location.href = "index.html"; return; }
    
    // 1. 先讀取週期設定
    await loadUserSettings(user.uid);
    
    // 2. 再讀取所有行程資料
    await fetchAllTrips(user.uid);

    // 3. 初始渲染
    renderAnalysis();
});

// === 資料讀取 ===

async function loadUserSettings(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.cycles && Array.isArray(data.cycles)) {
                // 排序：新的在前
                cycles = data.cycles.sort((a, b) => b.start - a.start);
            } else if (data.period) {
                cycles = [data.period];
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

// === 週期選擇器 ===

function renderCycleSelector() {
    const selector = document.getElementById('cycleSelector');
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

    // 預設選中最新週期 (index 0)
    selector.selectedIndex = 1; 
    currentSelectedCycle = cycles[0];

    selector.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === "all") {
            currentSelectedCycle = null; 
        } else {
            currentSelectedCycle = cycles[val];
        }
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

    if (tripsToAnalyze.length === 0) {
        document.getElementById('totalTrips').innerText = "0";
        document.getElementById('daysToBreakEven').innerText = "--";
        document.getElementById('dnaTags').innerHTML = '<span class="dna-tag" style="background:#eee;color:#888;">此週期無資料</span>';
        document.getElementById('transportGrid').innerHTML = '';
        document.getElementById('routeRanking').innerHTML = '';
        Object.values(chartInstances).forEach(chart => chart.destroy());
        return;
    }

    // 依序執行分析
    renderSummary(tripsToAnalyze);
    renderDNA(tripsToAnalyze);
    renderTransportGrid(tripsToAnalyze);
    renderRouteRanking(tripsToAnalyze);
    
    renderROIChart(tripsToAnalyze);
    renderRadarChart(tripsToAnalyze);
}

// === 1. 總結與回本邏輯 (升級版) ===

function renderSummary(trips) {
    document.getElementById('totalTrips').innerText = trips.length;
    
    const daysLabel = document.getElementById('daysToBreakEven');
    const labelSmall = daysLabel.nextElementSibling; // 抓取後面的 <small> 標籤

    // 1. 先排序確保日期正確
    const sortedTrips = [...trips].sort((a, b) => a.createdAt - b.createdAt);
    
    let cumulativeCost = 0;
    let breakEvenDate = null;
    let totalCost = 0;

    // 2. 尋找回本的那一天
    for (let t of sortedTrips) {
        cumulativeCost += (t.originalPrice || 0);
        if (cumulativeCost >= 1200 && !breakEvenDate) {
            breakEvenDate = new Date(t.dateStr);
        }
        totalCost += (t.originalPrice || 0);
    }

    const startDate = new Date(sortedTrips[0].dateStr);
    
    if (breakEvenDate) {
        // --- 情境 A: 已回本 ---
        // 計算從第一筆到回本那天，過了幾天
        // 公式：(回本日 - 第一天) + 1
        const timeDiff = breakEvenDate - startDate;
        const daysUsed = Math.floor(timeDiff / (86400000)) + 1;

        daysLabel.innerText = daysUsed;
        daysLabel.style.color = "#27ae60"; // 綠色
        labelSmall.innerText = "天回本！"; // 更改單位文字
    } else {
        // --- 情境 B: 尚未回本 ---
        // 使用目前的平均日消費來預估
        const lastDate = new Date(sortedTrips[sortedTrips.length - 1].dateStr);
        
        // 已經過了幾天
        const daysPassed = Math.floor((lastDate - startDate) / (86400000)) + 1;
        
        // 平均每天花多少
        const avgDailySpend = totalCost / daysPassed;
        const remainingAmount = 1200 - totalCost;

        let estimatedDays = 99;
        if (avgDailySpend > 0) {
            estimatedDays = Math.ceil(remainingAmount / avgDailySpend);
        }

        // 防呆：如果只記了一天，預測會不準
        if (daysPassed <= 1 && trips.length < 3) {
            daysLabel.innerText = "分析中";
            daysLabel.style.color = "#666";
            labelSmall.innerText = "";
        } else {
            daysLabel.innerText = estimatedDays;
            daysLabel.style.color = "#e67e22"; // 橘色
            labelSmall.innerText = "天回本 (預估)";
        }
    }
}

// === 2. DNA 標籤 (不變) ===
function renderDNA(trips) {
    const container = document.getElementById('dnaTags');
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

// === 3. 運具深度透視 (全面升級版) ===

function renderTransportGrid(trips) {
    const grid = document.getElementById('transportGrid');
    grid.innerHTML = '';

    // 1. 先計算總花費 (算百分比用)
    const totalAllCost = trips.reduce((sum, t) => sum + (t.originalPrice || 0), 0);

    // 2. 分類統計
    const stats = {};
    trips.forEach(t => {
        if (!stats[t.type]) {
            stats[t.type] = { count: 0, cost: 0, maxPrice: 0 };
        }
        const p = t.originalPrice || 0;
        stats[t.type].count++;
        stats[t.type].cost += p;
        if (p > stats[t.type].maxPrice) {
            stats[t.type].maxPrice = p;
        }
    });

    const sortedTypes = Object.keys(stats).sort((a, b) => stats[b].cost - stats[a].cost);

    sortedTypes.forEach(type => {
        const s = stats[type];
        if (s.count === 0) return;

        const avg = Math.round(s.cost / s.count);
        // 計算佔比
        const percent = totalAllCost > 0 ? Math.round((s.cost / totalAllCost) * 100) : 0;
        
        const color = COLORS[type];
        const icon = ICONS[type];
        const name = LABELS[type];

        const card = document.createElement('div');
        card.className = 't-card';
        card.style.borderLeftColor = color;
        
        // 產生更豐富的 HTML
        card.innerHTML = `
            <div class="t-card-header">
                <div class="t-name" style="color:${color}">
                    <i class="fa-solid ${icon}"></i> ${name}
                </div>
                <span class="t-count">${s.count} 趟</span>
            </div>
            
            <div class="t-stat-main">
                $${s.cost} <small>總計</small>
            </div>

            <div class="t-progress-bg">
                <div class="t-progress-bar" style="width: ${percent}%; background: ${color};"></div>
            </div>
            <div style="text-align:right; font-size:10px; color:#999; margin-bottom:8px;">
                佔總花費 ${percent}%
            </div>

            <div class="t-detail-grid">
                <div>
                    <span>平均</span>
                    <b>$${avg}</b>
                </div>
                <div>
                    <span>最高</span>
                    <b>$${s.maxPrice}</b>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// === 4. 熱門路線 (不變) ===
function renderRouteRanking(trips) {
    const list = document.getElementById('routeRanking');
    list.innerHTML = '';

    const routes = {};
    trips.forEach(t => {
        if (!t.startStation || !t.endStation) return;
        const key = [t.startStation, t.endStation].sort().join(' ↔ ');
        if (!routes[key]) routes[key] = { count: 0, totalCost: 0 };
        routes[key].count++;
        routes[key].totalCost += (t.originalPrice || 0);
    });

    const sortedRoutes = Object.entries(routes)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5); 

    if (sortedRoutes.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#ccc;">尚無足夠資料分析路線</div>';
        return;
    }

    sortedRoutes.forEach((item, index) => {
        const name = item[0];
        const data = item[1];
        const rank = index + 1;
        
        const div = document.createElement('div');
        div.className = 'route-item';
        div.innerHTML = `
            <div class="route-rank top-${rank}">${rank}</div>
            <div class="route-info">
                <div class="route-name">${name}</div>
                <div class="route-detail">累計 ${data.count} 趟</div>
            </div>
            <div class="route-total">$${data.totalCost}</div>
        `;
        list.appendChild(div);
    });
}

// === 5. 圖表 (不變) ===
function renderROIChart(trips) {
    const ctx = document.getElementById('roiChart').getContext('2d');
    
    if (chartInstances.roi) {
        chartInstances.roi.destroy();
    }

    const dailyData = {};
    let minTime, maxTime;

    if (currentSelectedCycle) {
        minTime = currentSelectedCycle.start;
        maxTime = currentSelectedCycle.end;
    } else {
        const times = trips.map(t => t.createdAt);
        minTime = Math.min(...times);
        maxTime = Math.max(...times);
    }

    for (let d = minTime; d <= maxTime; d += 86400000) {
        const dateObj = new Date(d);
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const key = `${mm}/${dd}`;
        dailyData[key] = 0;
    }

    trips.forEach(t => {
        const d = new Date(t.dateStr); 
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const key = `${mm}/${dd}`;
        
        if (dailyData[key] !== undefined) {
            dailyData[key] += (t.originalPrice || 0);
        }
    });

    const labels = Object.keys(dailyData).sort(); 
    
    const cumulativeData = [];
    let sum = 0;
    labels.forEach(dateKey => {
        sum += dailyData[dateKey];
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

    if (chartInstances.radar) {
        chartInstances.radar.destroy();
    }

    let stats = [0, 0, 0, 0, 0, 0]; 
    
    trips.forEach(t => {
        const date = new Date(t.createdAt);
        const day = date.getDay(); 
        const hour = date.getHours(); 

        if (day === 0 || day === 6) stats[1]++;
        else stats[0]++;

        if (hour >= 6 && hour < 12) stats[2]++;
        else if (hour >= 12 && hour < 18) stats[3]++;
        else if (hour >= 18 && hour <= 23) stats[4]++;
        else stats[5]++;
    });

    chartInstances.radar = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['平日出勤', '假日出遊', '上午時段', '下午時段', '晚上時段', '深夜清晨'],
            datasets: [{
                label: '行程頻率',
                data: stats,
                fill: true,
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                borderColor: '#3498db',
                pointBackgroundColor: '#3498db',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#3498db'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { display: true },
                    suggestedMin: 0
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}