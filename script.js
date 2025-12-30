// script.js
import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js"; // 引入剛寫好的 Auth 模組
import { 
    collection, 
    addDoc, 
    deleteDoc, 
    query, 
    orderBy, 
    onSnapshot, 
    doc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === 狀態變數 ===
let currentUser = null;
let trips = [];
let unsubscribeTrips = null;

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

// === DOM ===
const els = {
    // 這裡只需要計算與 CRUD 相關的 DOM，Auth 相關的已移走
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
    transportRadios: document.querySelectorAll('input[name="type"]'),
    groupRoute: document.getElementById('group-route'),
    groupStations: document.getElementById('group-stations'),
    inputRoute: document.getElementById('routeId'),
    inputStart: document.getElementById('startStation'),
    inputEnd: document.getElementById('endStation')
};

// === 程式入口 ===
// 這裡是最關鍵的連接點！
initAuthListener((user) => {
    currentUser = user; // 更新本地的使用者狀態

    if (user) {
        // 使用者登入了 -> 開始監聽資料庫
        setupRealtimeListener(user.uid);
    } else {
        // 使用者登出了 -> 清空資料、停止監聽
        if (unsubscribeTrips) unsubscribeTrips();
        trips = [];
        renderUI();
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">請登入以查看或記錄行程</li>';
    }
});

// 初始化表單狀態
updateFormFields('mrt');

// === Firestore 邏輯 ===

function setupRealtimeListener(uid) {
    const q = query(
        collection(db, "users", uid, "trips"), 
        orderBy("createdAt", "desc")
    );

    unsubscribeTrips = onSnapshot(q, (snapshot) => {
        trips = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        renderUI();
    }, (error) => {
        console.error("Data fetch error:", error);
    });
}

// === 表單與互動邏輯 ===

window.toggleModal = function() {
    els.modal.classList.toggle('hidden');
}

els.transportRadios.forEach(radio => {
    radio.addEventListener('change', (e) => updateFormFields(e.target.value));
});

function updateFormFields(type) {
    els.groupRoute.classList.add('hidden');
    els.groupStations.classList.add('hidden');
    if (type === 'bus') {
        els.groupRoute.classList.remove('hidden');
    } else if (type === 'coach') {
        els.groupRoute.classList.remove('hidden');
        els.groupStations.classList.remove('hidden');
    } else {
        els.groupStations.classList.remove('hidden');
    }
}

// 新增行程
els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("請先登入！");

    const type = document.querySelector('input[name="type"]:checked').value;
    const price = parseFloat(document.getElementById('price').value);
    const isTransfer = document.getElementById('transfer').checked;
    
    // 欄位防呆：若隱藏則為空字串
    const routeId = !els.groupRoute.classList.contains('hidden') ? els.inputRoute.value.trim() : '';
    const startStation = !els.groupStations.classList.contains('hidden') ? els.inputStart.value.trim() : '';
    const endStation = !els.groupStations.classList.contains('hidden') ? els.inputEnd.value.trim() : '';

    if (!price || price <= 0) return;

    const submitBtn = els.form.querySelector('.submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "儲存中...";

    try {
        await addDoc(collection(db, "users", currentUser.uid, "trips"), {
            createdAt: Date.now(),
            dateStr: new Date().toLocaleDateString(),
            type,
            originalPrice: price,
            paidPrice: isTransfer ? Math.max(0, price - 6) : price,
            isTransfer,
            routeId,
            startStation,
            endStation
        });

        els.form.reset();
        // 恢復預設 UI
        document.querySelector('input[value="mrt"]').checked = true;
        updateFormFields('mrt');
        window.toggleModal();

    } catch (e) {
        console.error(e);
        alert("儲存失敗");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "加入計算";
    }
});

// 刪除行程
window.deleteTrip = async function(tripId) {
    if (!currentUser) return;
    if (confirm('刪除此紀錄？')) {
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, "trips", tripId));
        } catch (e) {
            console.error(e);
        }
    }
}

// === 計算與渲染 (邏輯完全不變) ===
function calculate() {
    let stats = { totalPaid: 0, counts: {}, sums: {} };
    Object.keys(TRANSPORT_TYPES).forEach(k => { stats.counts[k] = 0; stats.sums[k] = 0; });

    trips.forEach(t => {
        stats.totalPaid += t.paidPrice;
        stats.counts[t.type]++;
        stats.sums[t.type] += t.originalPrice;
    });

    // Rule 1: 常客優惠 (北捷/台鐵)
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

    // Rule 2: TPass 2.0 (公路總局)
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
    if (!currentUser) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">請先登入</li>';
        els.finalCost.innerText = '$0';
        els.rawTotal.innerText = '$0';
        els.statusText.innerText = "請先登入";
        els.statusText.className = "status-neutral";
        return;
    }

    const data = calculate();
    const finalVal = Math.floor(data.finalCost);

    els.finalCost.innerText = `$${finalVal}`;
    els.rawTotal.innerText = `$${Math.floor(data.totalPaid)}`;
    
    els.rule1Discount.innerText = `-$${Math.floor(data.r1.amount)}`;
    els.rule1Detail.innerHTML = data.r1.details.length ? data.r1.details.map(d => `<div>${d}</div>`).join('') : '';
    
    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length ? data.r2.details.map(d => `<div>${d}</div>`).join('') : '';
    
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

    els.historyList.innerHTML = '';
    if (trips.length === 0) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">尚無行程紀錄</li>';
        return;
    }

    trips.forEach(trip => {
        const tDef = TRANSPORT_TYPES[trip.type] || TRANSPORT_TYPES.mrt;
        const li = document.createElement('li');
        li.className = 'history-item';
        
        // 標題與描述邏輯
        let titleDesc = tDef.name;
        if (trip.type === 'bus') {
            titleDesc = trip.routeId ? `${trip.routeId}路公車` : '公車';
        } else if (trip.type === 'coach') {
            const route = trip.routeId || '';
            const path = (trip.startStation && trip.endStation) ? ` (${trip.startStation}→${trip.endStation})` : '';
            titleDesc = `客運 ${route}${path}`;
        } else {
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
                    <small>${trip.dateStr} • ${tDef.name}</small>
                </div>
            </div>
            ${priceHtml}
            <button onclick="window.deleteTrip('${trip.id}')" style="border:none; background:none; color:#ddd; margin-left:15px; padding:10px;"><i class="fa-solid fa-xmark"></i></button>
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