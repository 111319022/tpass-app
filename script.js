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

// === 票價設定檔 ===
// 這邊讓你方便調整金額，不用改一堆 code
const FARE_CONFIG = {
    adult: {
        busBase: 15,    // 公車全票一段
        transferDiscount: 8 // 全票轉乘優惠
    },
    student: {
        busBase: 12,    // 公車學生票
        transferDiscount: 6 // 學生票轉乘優惠
    }
};

// 預設身分
let currentIdentity = 'adult';

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
    tripDate: document.getElementById('tripDate'),
    tripTime: document.getElementById('tripTime'),
    modal: document.getElementById('entryModal'),
    form: document.getElementById('tripForm'),
    transportRadios: document.querySelectorAll('input[name="type"]'),
    groupRoute: document.getElementById('group-route'),
    groupStations: document.getElementById('group-stations'),
    inputRoute: document.getElementById('routeId'),
    inputStart: document.getElementById('startStation'),
    inputEnd: document.getElementById('endStation'),
    transferLabel: document.getElementById('transferLabel')
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

// === 身分切換功能 ===
// 掛載到 window 讓 HTML onclick 呼叫
window.updateIdentity = function(type) {
    currentIdentity = type;
    
    // 更新轉乘標籤文字
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    if (els.transferLabel) {
        els.transferLabel.textContent = `我是轉乘 (自動 -${discount}元)`;
    }
    
    // 重新渲染介面 (因為計算邏輯會改變)
    renderUI();
    
    // 同時更新表單的建議票價 (如果正在選公車)
    const selectedType = document.querySelector('input[name="type"]:checked')?.value;
    if (selectedType) {
        updateFormFields(selectedType);
    }
    
    console.log("切換身分為:", type);
}

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
    const isHidden = els.modal.classList.contains('hidden');
    
    if (isHidden) {
        // 當打開 Modal 時，預設設定為「今天」和「現在時間」
        const now = new Date();
        
        // 設定日期 (YYYY-MM-DD)
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        els.tripDate.value = `${yyyy}-${mm}-${dd}`;
        
        // 設定時間 (HH:MM)
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        els.tripTime.value = `${hh}:${min}`;
        
        els.modal.classList.remove('hidden');
    } else {
        els.modal.classList.add('hidden');
    }
}

els.transportRadios.forEach(radio => {
    radio.addEventListener('change', (e) => updateFormFields(e.target.value));
});

function updateFormFields(type) {
    const priceInput = document.getElementById('price');
    const currentVal = priceInput.value;
    
    els.groupRoute.classList.add('hidden');
    els.groupStations.classList.add('hidden');
    
    if (type === 'bus') {
        els.groupRoute.classList.remove('hidden');
        
        // 自動填入建議票價
        const suggestedPrice = FARE_CONFIG[currentIdentity].busBase;
        // 只有當欄位是空的，或剛好等於另一種票價時才自動改
        if (!currentVal || currentVal == '15' || currentVal == '12') {
            priceInput.value = suggestedPrice;
        }
    } else if (type === 'coach') {
        els.groupRoute.classList.remove('hidden');
        els.groupStations.classList.remove('hidden');
        priceInput.value = ''; // 客運票價變異大，清空讓使用者填
    } else {
        els.groupStations.classList.remove('hidden');
        // 捷運/台鐵票價不固定，但不清空，保留使用者的輸入
    }
}

// 新增行程
els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("請先登入！");

    const type = document.querySelector('input[name="type"]:checked').value;
    const price = parseFloat(document.getElementById('price').value);
    const isTransfer = document.getElementById('transfer').checked;
    
    // 取得使用者選擇的日期和時間
    const dateInputVal = els.tripDate.value; // "2023-12-30"
    const timeInputVal = els.tripTime.value; // "14:30"
    if (!dateInputVal) return alert("請選擇日期");
    if (!timeInputVal) return alert("請選擇時間");

    // 建立 Date 物件 (用於排序與顯示)
    const selectedDate = new Date(`${dateInputVal}T${timeInputVal}:00`);

    // 格式化顯示用字串 (YYYY/MM/DD HH:MM)
    const dateStr = dateInputVal.replace(/-/g, '/');
    const timeStr = timeInputVal;
    
    // 欄位防呆：若隱藏則為空字串
    const routeId = !els.groupRoute.classList.contains('hidden') ? els.inputRoute.value.trim() : '';
    const startStation = !els.groupStations.classList.contains('hidden') ? els.inputStart.value.trim() : '';
    const endStation = !els.groupStations.classList.contains('hidden') ? els.inputEnd.value.trim() : '';

    if (!price || price <= 0) return;

    const submitBtn = els.form.querySelector('.submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "儲存中...";

    // 根據當前身分取得轉乘優惠金額
    const transferDiscount = FARE_CONFIG[currentIdentity].transferDiscount;

    try {
        await addDoc(collection(db, "users", currentUser.uid, "trips"), {
            createdAt: selectedDate.getTime(),
            dateStr: dateStr,
            timeStr: timeStr,
            type,
            originalPrice: price,
            paidPrice: isTransfer ? Math.max(0, price - transferDiscount) : price,
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

// === 計算與渲染 ===
function calculate() {
    let stats = { totalPaid: 0, counts: {}, sums: {} };
    Object.keys(TRANSPORT_TYPES).forEach(k => { stats.counts[k] = 0; stats.sums[k] = 0; });

    // 取得當前身分的轉乘優惠金額
    const currentTransferDiscount = FARE_CONFIG[currentIdentity].transferDiscount;
    const busSuggestedPrice = FARE_CONFIG[currentIdentity].busBase;

    trips.forEach(t => {
        // [修改] 動態調整公車的原價 (根據當前身分)
        let adjustedOriginalPrice = t.originalPrice;
        if (t.type === 'bus' && (t.originalPrice === 12 || t.originalPrice === 15)) {
            // 如果是標準公車票價，用當前身分的建議價格替代
            adjustedOriginalPrice = busSuggestedPrice;
        }
        
        // 根據當前身分重新計算實際支付金額
        let calculatedPaid = adjustedOriginalPrice;
        
        if (t.isTransfer) {
            // 使用當前設定的優惠金額
            calculatedPaid = Math.max(0, adjustedOriginalPrice - currentTransferDiscount);
        }

        stats.totalPaid += calculatedPaid;
        stats.counts[t.type]++;
        stats.sums[t.type] += adjustedOriginalPrice;
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
        const mrtCashback = mrtSum * mrtRate;
        r1_cashback += mrtCashback;
        r1_details.push({
            text: `北捷 ${mrtCount} 趨，回饋 ${(mrtRate*100)}%`,
            amount: `-$${Math.floor(mrtCashback)}`
        });
    }

    // 台鐵
    const traCount = stats.counts.tra;
    const traSum = stats.sums.tra;
    let traRate = 0;
    if (traCount > 40) traRate = 0.20;
    else if (traCount > 20) traRate = 0.15;
    else if (traCount > 10) traRate = 0.10;
    if (traRate > 0) {
        const traCashback = traSum * traRate;
        r1_cashback += traCashback;
        r1_details.push({
            text: `台鐵 ${traCount} 趨，回饋 ${(traRate*100)}%`,
            amount: `-$${Math.floor(traCashback)}`
        });
    }

    // Rule 2: TPass 2.0 (公路總局)
    let r2_cashback = 0;
    let r2_details = [];
    const railCount = stats.counts.mrt + stats.counts.tra + stats.counts.tymrt + stats.counts.lrt;
    const railSum = stats.sums.mrt + stats.sums.tra + stats.sums.tymrt + stats.sums.lrt;
    if (railCount >= 11) {
        const railCashback = railSum * 0.02;
        r2_cashback += railCashback;
        r2_details.push({
            text: `軒道 ${railCount} 趨，回饋 2%`,
            amount: `-$${Math.floor(railCashback)}`
        });
    }

    const busCount = stats.counts.bus + stats.counts.coach;
    const busSum = stats.sums.bus + stats.sums.coach;
    let busRate = 0;
    if (busCount > 30) busRate = 0.30;
    else if (busCount >= 11) busRate = 0.15;
    if (busRate > 0) {
        const busCashback = busSum * busRate;
        r2_cashback += busCashback;
        r2_details.push({
            text: `公車客運 ${busCount} 趨，回饋 ${(busRate*100)}%`,
            amount: `-$${Math.floor(busCashback)}`
        });
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
    els.rule1Detail.innerHTML = data.r1.details.length ? data.r1.details.map(d => `<div style="display:flex; justify-content:space-between; padding:2px 0;"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') : '';
    
    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length ? data.r2.details.map(d => `<div style="display:flex; justify-content:space-between; padding:2px 0;"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') : '';
    
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

    let lastDateStr = null; // 用來記錄上一筆資料的日期

    trips.forEach(trip => {
        // 檢查是否需要插入日期分隔線
        if (trip.dateStr !== lastDateStr) {
            const separator = document.createElement('li');
            separator.className = 'date-separator';
            
            // 判斷是否為今天，顯示得更人性化
            const tripDate = new Date(trip.dateStr);
            const today = new Date();
            const isToday = tripDate.toDateString() === today.toDateString();
            
            separator.innerText = isToday ? `今天 (${trip.dateStr})` : trip.dateStr;
            els.historyList.appendChild(separator);
            
            lastDateStr = trip.dateStr;
        }

        const tDef = TRANSPORT_TYPES[trip.type] || TRANSPORT_TYPES.mrt;
        const li = document.createElement('li');
        li.className = 'history-item';
        
        // 標題與描述邏輯
        let titleDesc = tDef.name;
        if (trip.type === 'bus') {
            titleDesc = trip.routeId ? `${trip.routeId}公車` : '公車';
        } else if (trip.type === 'coach') {
            const route = trip.routeId || '';
            const path = (trip.startStation && trip.endStation) ? ` (${trip.startStation}→${trip.endStation})` : '';
            titleDesc = `客運 ${route}${path}`;
        } else {
            if (trip.startStation && trip.endStation) {
                titleDesc = `${trip.startStation} <i class="fa-solid fa-arrow-right" style="font-size:10px; opacity:0.5;"></i> ${trip.endStation}`;
            }
        }

        // [修改] 根據身分動態調整公車原價並計算顯示金額
        let displayOriginalPrice = trip.originalPrice;
        const busSuggestedPrice = FARE_CONFIG[currentIdentity].busBase;
        
        // 如果是標準公車票價 (12 或 15)，根據當前身分調整
        if (trip.type === 'bus' && (trip.originalPrice === 12 || trip.originalPrice === 15)) {
            displayOriginalPrice = busSuggestedPrice;
        }

        // 計算轉乘後的顯示金額
        const discount = FARE_CONFIG[currentIdentity].transferDiscount;
        const displayPaid = trip.isTransfer ? Math.max(0, displayOriginalPrice - discount) : displayOriginalPrice;

        let priceHtml = '';
        if (trip.isTransfer) {
            priceHtml = `<div class="item-right"><span class="price-original">$${displayOriginalPrice}</span><span class="price-display">$${displayPaid}</span></div>`;
        } else {
            priceHtml = `<div class="item-right"><div class="price-display">$${displayPaid}</div></div>`;
        }

        li.innerHTML = `
            <div class="item-left">
                <div class="t-icon ${tDef.class}">
                    <i class="fa-solid ${getIconClass(trip.type)}"></i>
                </div>
                <div class="item-info">
                    <h4>${titleDesc} ${trip.isTransfer ? '<i class="fa-solid fa-link" style="color:#27ae60; font-size:12px;"></i>' : ''}</h4>
                    <small>${tDef.name}</small>
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