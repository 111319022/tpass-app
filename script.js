// 初始化
let trips = JSON.parse(localStorage.getItem('tpass2_trips')) || [];
const TPASS_PRICE = 1200;

const TRANSPORT_TYPES = {
    mrt: { name: '台北捷運', class: 'c-mrt' },
    bus: { name: '公車', class: 'c-bus' },
    coach: { name: '客運', class: 'c-coach' },
    tra: { name: '台鐵', class: 'c-tra' },
    tymrt: { name: '機場捷運', class: 'c-tymrt' },
    lrt: { name: '輕軌', class: 'c-lrt' },
    bike: { name: 'Ubike', class: 'c-bike' }
};

// DOM 元素
const els = {
    finalCost: document.getElementById('finalCost'),
    rawTotal: document.getElementById('rawTotal'),
    rule1Discount: document.getElementById('rule1Discount'),
    rule1Detail: document.getElementById('rule1Detail'),
    rule2Discount: document.getElementById('rule2Discount'),
    rule2Detail: document.getElementById('rule2Detail'),
    statusText: document.getElementById('statusText'),
    diffText: document.getElementById('diffText'),
    historyList: document.getElementById('historyList'),
    tripCount: document.getElementById('tripCount'),
    modal: document.getElementById('entryModal'),
    form: document.getElementById('tripForm'),
    
    // 表單動態區塊
    transportRadios: document.querySelectorAll('input[name="type"]'),
    groupRoute: document.getElementById('group-route'),
    groupStations: document.getElementById('group-stations'),
    inputRoute: document.getElementById('routeId'),
    inputStart: document.getElementById('startStation'),
    inputEnd: document.getElementById('endStation')
};

// 初始渲染
renderUI();
updateFormFields('mrt'); // 預設顯示捷運的輸入框狀態

// Toggle Modal
function toggleModal() {
    els.modal.classList.toggle('hidden');
}

// 監聽運具選擇改變，調整輸入框
els.transportRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        updateFormFields(e.target.value);
    });
});

function updateFormFields(type) {
    // 重置隱藏
    els.groupRoute.classList.add('hidden');
    els.groupStations.classList.add('hidden');

    // 邏輯判斷
    if (type === 'bus') {
        // 公車：只要編號
        els.groupRoute.classList.remove('hidden');
    } else if (type === 'coach') {
        // 客運：編號 + 起訖
        els.groupRoute.classList.remove('hidden');
        els.groupStations.classList.remove('hidden');
    } else {
        // 軌道(北捷/台鐵/機捷/輕軌) + Ubike：只要起訖
        els.groupStations.classList.remove('hidden');
    }
}

// 表單提交
els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.querySelector('input[name="type"]:checked').value;
    const price = parseFloat(document.getElementById('price').value);
    const isTransfer = document.getElementById('transfer').checked;
    
    // 取得新欄位資料
    const routeId = els.inputRoute.value.trim();
    const startStation = els.inputStart.value.trim();
    const endStation = els.inputEnd.value.trim();

    if (!price || price <= 0) return;

    trips.unshift({
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        type,
        originalPrice: price,
        paidPrice: isTransfer ? Math.max(0, price - 6) : price,
        isTransfer,
        // 儲存詳細資訊
        routeId: routeId,
        startStation: startStation,
        endStation: endStation
    });

    saveData();
    renderUI();
    
    // 重置表單但保留日期
    els.form.reset();
    els.inputRoute.value = '';
    els.inputStart.value = '';
    els.inputEnd.value = '';
    // 恢復預設選項的輸入框狀態
    document.querySelector('input[value="mrt"]').checked = true;
    updateFormFields('mrt');
    
    toggleModal();
});

// 計算邏輯 (與上版相同)
function calculate() {
    let stats = { totalPaid: 0, counts: {}, sums: {} };
    Object.keys(TRANSPORT_TYPES).forEach(k => { stats.counts[k] = 0; stats.sums[k] = 0; });

    trips.forEach(t => {
        stats.totalPaid += t.paidPrice;
        stats.counts[t.type]++;
        stats.sums[t.type] += t.originalPrice;
    });

    // 規則一：常客優惠
    let r1_cashback = 0;
    let r1_details = [];
    
    // 北捷
    const mrtCount = stats.counts.mrt;
    const mrtSum = stats.sums.mrt;
    let mrtRate = 0;
    if (mrtCount > 40) mrtRate = 0.15;
    else if (mrtCount > 20) mrtRate = 0.10;
    else if (mrtCount > 10) mrtRate = 0.05;
    if (mrtRate > 0) {
        r1_cashback += mrtSum * mrtRate;
        r1_details.push(`北捷 ${mrtCount} 趟，回饋 ${(mrtRate*100)}%`);
    }

    // 台鐵
    const traCount = stats.counts.tra;
    const traSum = stats.sums.tra;
    let traRate = 0;
    if (traCount > 40) traRate = 0.20;
    else if (traCount > 20) traRate = 0.15;
    else if (traCount > 10) traRate = 0.10;
    if (traRate > 0) {
        r1_cashback += traSum * traRate;
        r1_details.push(`台鐵 ${traCount} 趟，回饋 ${(traRate*100)}%`);
    }

    // 規則二：TPass
    let r2_cashback = 0;
    let r2_details = [];
    const railCount = stats.counts.mrt + stats.counts.tra + stats.counts.tymrt + stats.counts.lrt;
    const railSum = stats.sums.mrt + stats.sums.tra + stats.sums.tymrt + stats.sums.lrt;
    if (railCount >= 11) {
        r2_cashback += railSum * 0.02;
        r2_details.push(`軌道 ${railCount} 趟，回饋 2%`);
    }

    const busCount = stats.counts.bus + stats.counts.coach;
    const busSum = stats.sums.bus + stats.sums.coach;
    let busRate = 0;
    if (busCount > 30) busRate = 0.30;
    else if (busCount >= 11) busRate = 0.15;
    if (busRate > 0) {
        r2_cashback += busSum * busRate;
        r2_details.push(`公車客運 ${busCount} 趟，回饋 ${(busRate*100)}%`);
    }

    return {
        totalPaid: stats.totalPaid,
        r1: { amount: r1_cashback, details: r1_details },
        r2: { amount: r2_cashback, details: r2_details },
        finalCost: stats.totalPaid - r1_cashback - r2_cashback
    };
}

function renderUI() {
    const data = calculate();
    const finalVal = Math.floor(data.finalCost);

    els.finalCost.innerText = `$${finalVal}`;
    els.rawTotal.innerText = `$${Math.floor(data.totalPaid)}`;
    els.rule1Discount.innerText = `-$${Math.floor(data.r1.amount)}`;
    els.rule1Detail.innerHTML = data.r1.details.length ? data.r1.details.map(d => `<div>${d}</div>`).join('') : '<div style="opacity:0.5">尚未達標</div>';
    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length ? data.r2.details.map(d => `<div>${d}</div>`).join('') : '<div style="opacity:0.5">尚未達標</div>';
    els.tripCount.innerText = trips.length;

    const diff = TPASS_PRICE - finalVal;
    if (diff < 0) {
        els.statusText.innerText = "已回本！";
        els.statusText.className = "status-win";
        els.diffText.innerText = `倒賺 $${Math.abs(diff)} 元`;
    } else {
        els.statusText.innerText = "虧本中";
        els.statusText.className = "status-loss";
        els.diffText.innerText = `還差 $${diff} 元回本`;
    }

    // 渲染列表
    els.historyList.innerHTML = '';
    if (trips.length === 0) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">尚無行程紀錄</li>';
        return;
    }

    trips.forEach(trip => {
        const tDef = TRANSPORT_TYPES[trip.type];
        const li = document.createElement('li');
        li.className = 'history-item';
        
        // 建構標題描述
        let titleDesc = tDef.name;
        if (trip.type === 'bus') {
            // 公車：顯示編號 (若無編號顯示預設文字)
            titleDesc = trip.routeId ? `${trip.routeId}路公車` : '公車';
        } else if (trip.type === 'coach') {
            // 客運：編號 + 起訖
            const route = trip.routeId || '';
            const path = (trip.startStation && trip.endStation) ? ` (${trip.startStation}→${trip.endStation})` : '';
            titleDesc = `客運 ${route}${path}`;
        } else {
            // 軌道/Ubike：顯示起訖
            if (trip.startStation && trip.endStation) {
                titleDesc = `${trip.startStation} <i class="fa-solid fa-arrow-right" style="font-size:10px; opacity:0.5;"></i> ${trip.endStation}`;
            }
        }

        let priceHtml = '';
        if (trip.isTransfer) {
            priceHtml = `<div class="item-right"><span class="price-original">$${trip.originalPrice}</span><span class="price-display">$${trip.paidPrice}</span></div>`;
        } else {
            priceHtml = `<div class="item-right"><div class="price-display">$${trip.paidPrice}</div></div>`;
        }

        li.innerHTML = `
            <div class="item-left">
                <div class="t-icon ${tDef.class}">
                    <i class="fa-solid ${getIconClass(trip.type)}"></i>
                </div>
                <div class="item-info">
                    <h4>${titleDesc} ${trip.isTransfer ? '<i class="fa-solid fa-link" style="color:#27ae60; font-size:12px;"></i>' : ''}</h4>
                    <small>${trip.date} • ${tDef.name}</small>
                </div>
            </div>
            ${priceHtml}
            <button onclick="deleteTrip(${trip.id})" style="border:none; background:none; color:#ddd; margin-left:15px; padding:10px;"><i class="fa-solid fa-xmark"></i></button>
        `;
        els.historyList.appendChild(li);
    });
}

function getIconClass(type) {
    if(type==='mrt') return 'fa-train-subway';
    if(type==='bus') return 'fa-bus';
    if(type==='coach') return 'fa-bus-simple';
    if(type==='tra') return 'fa-train';
    if(type==='tymrt') return 'fa-plane-departure';
    if(type==='lrt') return 'fa-train-tram';
    if(type==='bike') return 'fa-bicycle';
    return 'fa-circle';
}

function saveData() { localStorage.setItem('tpass2_trips', JSON.stringify(trips)); }
window.deleteTrip = function(id) { if(confirm('刪除此紀錄？')) { trips = trips.filter(t => t.id !== id); saveData(); renderUI(); }}
window.clearData = function() { if(confirm('確定清空所有紀錄？')) { trips = []; saveData(); renderUI(); }}