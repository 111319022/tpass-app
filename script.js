import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js";
import { 
    collection, addDoc, deleteDoc, query, orderBy, onSnapshot, 
    doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === 狀態變數 ===
let currentUser = null;
let trips = [];
let unsubscribeTrips = null;
let currentPeriod = { start: null, end: null };

// [修改] 預設身分從變數管理，不再依賴全域切換函式
let currentIdentity = 'adult'; 

const FARE_CONFIG = {
    adult: { busBase: 15, transferDiscount: 8 },
    student: { busBase: 12, transferDiscount: 6 }
};

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
    // ... 原本的 DOM 保持不變 ...
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
    cycleDateRange: document.getElementById('cycleDateRange'),
    
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsForm: document.getElementById('settingsForm'),
    activationDateInput: document.getElementById('activationDate'),
    previewPeriod: document.getElementById('previewPeriod'),
    // [新增] 設定表單裡的身分 Radio
    settingsIdentityRadios: document.getElementsByName('settingsIdentity'),

    modal: document.getElementById('entryModal'),
    form: document.getElementById('tripForm'),
    tripDate: document.getElementById('tripDate'),
    transportRadios: document.querySelectorAll('input[name="type"]'),
    groupRoute: document.getElementById('group-route'),
    groupStations: document.getElementById('group-stations'),
    inputRoute: document.getElementById('routeId'),
    inputStart: document.getElementById('startStation'),
    inputEnd: document.getElementById('endStation'),
    // [新增] 轉乘標籤
    transferLabel: document.getElementById('transferLabel')
};

// === 程式入口 ===
initAuthListener(async (user) => {
    currentUser = user; 
    if (user) {
        await loadUserSettings(user.uid);
        setupRealtimeListener(user.uid);
    } else {
        if (unsubscribeTrips) unsubscribeTrips();
        trips = [];
        currentPeriod = { start: null, end: null };
        renderUI();
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">請登入以查看或記錄行程</li>';
    }
});

// === 讀取與儲存設定 ===

async function loadUserSettings(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const docSnap = await getDoc(userDocRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 1. 讀取週期
            if (data.period) {
                currentPeriod = data.period;
                if (currentPeriod.start) {
                    const d = new Date(currentPeriod.start);
                    // 格式化日期填入 input
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    els.activationDateInput.value = `${yyyy}-${mm}-${dd}`;
                    updatePreviewText(); 
                }
            }

            // 2. 讀取身分
            if (data.identity) {
                currentIdentity = data.identity;
            }
        }
        
        // 更新 UI 狀態
        updateSettingsUI();
        updateTransferLabel(); // 更新轉乘文字顯示
        
    } catch (e) {
        console.error("讀取設定失敗", e);
    }
}

// 統一儲存設定 (日期 + 身分)
async function saveSettings() {
    if (!currentUser) return;
    
    // 取得日期
    const dateVal = els.activationDateInput.value;
    let newPeriodData = currentPeriod; // 預設維持原狀
    
    if (dateVal) {
        const startDate = new Date(dateVal);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 29);
        endDate.setHours(23, 59, 59, 999);
        newPeriodData = { start: startDate.getTime(), end: endDate.getTime() };
    }

    // 取得身分
    const selectedIdentity = document.querySelector('input[name="settingsIdentity"]:checked').value;

    try {
        const userDocRef = doc(db, "users", currentUser.uid);
        await setDoc(userDocRef, { 
            period: newPeriodData,
            identity: selectedIdentity
        }, { merge: true });
        
        // 更新本地狀態
        currentPeriod = newPeriodData;
        currentIdentity = selectedIdentity;
        
        renderUI();
        updateTransferLabel();
        toggleSettingsModal();
        
    } catch (e) {
        console.error(e);
        alert("儲存設定失敗");
    }
}

// 輔助：更新設定 Modal 裡的 UI 狀態
function updateSettingsUI() {
    // 設定 Radio button 狀態
    const radio = document.querySelector(`input[name="settingsIdentity"][value="${currentIdentity}"]`);
    if (radio) radio.checked = true;
}

// 輔助：更新轉乘 Checkbox 旁的提示文字
function updateTransferLabel() {
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    els.transferLabel.innerText = `我是轉乘 (自動扣除 ${discount} 元)`;
}

// === 身分切換函式 (供 HTML 的 onchange 呼叫) ===
window.updateIdentity = function(identity) {
    currentIdentity = identity;
    updateSettingsUI(); // 同步更新設定 Modal 中的 radio 狀態
    updateTransferLabel(); // 更新轉乘標籤
    renderUI(); // 重新計算與渲染
}

// === 設定 Modal 互動 ===
els.settingsBtn.addEventListener('click', () => {
    updateSettingsUI(); // 打開前確保 UI 同步
    els.settingsModal.classList.remove('hidden');
});

window.toggleSettingsModal = function() {
    els.settingsModal.classList.toggle('hidden');
}

els.activationDateInput.addEventListener('change', updatePreviewText);

function updatePreviewText() {
    const val = els.activationDateInput.value;
    if (!val) {
        els.previewPeriod.innerText = "請選擇日期...";
        return;
    }
    const start = new Date(val);
    const end = new Date(start);
    end.setDate(start.getDate() + 29);
    const fmt = d => `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
    els.previewPeriod.innerText = `${fmt(start)} ~ ${fmt(end)}`;
}

els.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
});


// === Firestore 監聽與計算 (大部分不變) ===
// setupRealtimeListener... (略，保持原樣)
function setupRealtimeListener(uid) {
    const q = query(collection(db, "users", uid, "trips"), orderBy("createdAt", "desc"));
    unsubscribeTrips = onSnapshot(q, (snapshot) => {
        trips = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderUI();
    });
}

// === 新增行程表單邏輯 ===

window.toggleModal = function() {
    const isHidden = els.modal.classList.contains('hidden');
    if (isHidden) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        els.tripDate.value = `${yyyy}-${mm}-${dd}`;
        
        updateFormFields(document.querySelector('input[name="type"]:checked').value);
        updateTransferLabel(); // 確保轉乘金額文字正確
        els.modal.classList.remove('hidden');
    } else {
        els.modal.classList.add('hidden');
    }
}

els.transportRadios.forEach(radio => {
    radio.addEventListener('change', (e) => updateFormFields(e.target.value));
});

function updateFormFields(type) {
    els.groupRoute.classList.add('hidden');
    els.groupStations.classList.add('hidden');
    const priceInput = document.getElementById('price');
    
    if (type === 'bus') {
        els.groupRoute.classList.remove('hidden');
        
        // [關鍵修改] 只有當欄位是「空」的時候，才自動填入預設值
        // 這樣就不會覆蓋使用者手動輸入的特殊金額 (例如 30)
        if (priceInput.value === '') {
            priceInput.value = FARE_CONFIG[currentIdentity].busBase;
        }
    } else if (type === 'coach') {
        els.groupRoute.classList.remove('hidden');
        els.groupStations.classList.remove('hidden');
        priceInput.value = '';
    } else {
        els.groupStations.classList.remove('hidden');
        priceInput.value = '';
    }
}

// calculate() 與 renderUI() 保持原樣
// 記得在 calculate() 裡使用 currentIdentity 來抓 FARE_CONFIG 即可
function calculate() {
    let stats = { totalPaid: 0, counts: {}, sums: {} };
    Object.keys(TRANSPORT_TYPES).forEach(k => { stats.counts[k] = 0; stats.sums[k] = 0; });

    // [動態] 使用當前設定的身分折扣
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    // ... (Dashboard 日期範圍更新邏輯) ...
    if (currentPeriod.start && currentPeriod.end) {
        const fmt = (ts) => {
            const d = new Date(ts);
            return `${d.getMonth()+1}/${d.getDate()}`;
        };
        els.cycleDateRange.innerText = `${fmt(currentPeriod.start)} ~ ${fmt(currentPeriod.end)}`;
    } else {
        els.cycleDateRange.innerText = "請點擊右上角設定啟用日";
    }

    trips.forEach(t => {
        if (!currentPeriod.start || t.createdAt < currentPeriod.start || t.createdAt > currentPeriod.end) {
            return;
        }

        let finalPrice = t.originalPrice;
        if (t.isTransfer) {
            // [動態] 永遠使用當前身分計算折扣
            finalPrice = Math.max(0, t.originalPrice - discount);
        }

        stats.totalPaid += finalPrice;
        stats.counts[t.type]++;
        stats.sums[t.type] += t.originalPrice;
    });

    // ... (Rule 1, Rule 2 邏輯完全保持不變) ...
    // 北捷回饋...
    let r1_cashback = 0;
    let r1_details = [];
    const mrtCount = stats.counts.mrt;
    const mrtSum = stats.sums.mrt;
    let mrtRate = 0;
    if (mrtCount > 40) mrtRate = 0.15;
    else if (mrtCount > 20) mrtRate = 0.10;
    else if (mrtCount > 10) mrtRate = 0.05;
    if (mrtRate > 0) {
        const mrtCashback = mrtSum * mrtRate;
        r1_cashback += mrtCashback;
        r1_details.push(`北捷 ${mrtCount} 趟，回饋 ${(mrtRate*100)}%|$${Math.floor(mrtCashback)}`);
    }

    // 台鐵回饋...
    const traCount = stats.counts.tra;
    const traSum = stats.sums.tra;
    let traRate = 0;
    if (traCount > 40) traRate = 0.20;
    else if (traCount > 20) traRate = 0.15;
    else if (traCount > 10) traRate = 0.10;
    if (traRate > 0) {
        const traCashback = traSum * traRate;
        r1_cashback += traCashback;
        r1_details.push(`台鐵 ${traCount} 趟，回饋 ${(traRate*100)}%|$${Math.floor(traCashback)}`);
    }

    // TPass 2.0...
    let r2_cashback = 0;
    let r2_details = [];
    const railCount = stats.counts.mrt + stats.counts.tra + stats.counts.tymrt + stats.counts.lrt;
    const railSum = stats.sums.mrt + stats.sums.tra + stats.sums.tymrt + stats.sums.lrt;
    if (railCount >= 11) {
        const railCashback = railSum * 0.02;
        r2_cashback += railCashback;
        r2_details.push(`軌道 ${railCount} 趟，回饋 2%|$${Math.floor(railCashback)}`);
    }

    const busCount = stats.counts.bus + stats.counts.coach;
    const busSum = stats.sums.bus + stats.sums.coach;
    let busRate = 0;
    if (busCount > 30) busRate = 0.30;
    else if (busCount >= 11) busRate = 0.15;
    if (busRate > 0) {
        const busCashback = busSum * busRate;
        r2_cashback += busCashback;
        r2_details.push(`公車客運 ${busCount} 趟，回饋 ${(busRate*100)}%|$${Math.floor(busCashback)}`);
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
        // ... (登出狀態顯示)
        return;
    }
    const data = calculate();
    // ... (更新儀表板數字)...
    const finalVal = Math.floor(data.finalCost);
    els.finalCost.innerText = `$${finalVal}`;
    els.rawTotal.innerText = `$${Math.floor(data.totalPaid)}`;
    els.rule1Discount.innerText = `-$${Math.floor(data.r1.amount)}`;
    els.rule1Detail.innerHTML = data.r1.details.length ? data.r1.details.map(d => {
        const [text, amount] = d.split('|');
        return `<div style="display:flex; justify-content:space-between;"><span>${text}</span><span>${amount}</span></div>`;
    }).join('') : '';
    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length ? data.r2.details.map(d => {
        const [text, amount] = d.split('|');
        return `<div style="display:flex; justify-content:space-between;"><span>${text}</span><span>${amount}</span></div>`;
    }).join('') : '';
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
    
    // ... (顯示週期提示)...
    if (!currentPeriod.start) {
        const li = document.createElement('li');
        li.style.background = '#fff3cd';
        li.style.padding = '10px';
        li.style.borderRadius = '8px';
        li.style.textAlign = 'center';
        li.style.marginBottom = '15px';
        li.style.fontSize = '13px';
        li.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 請點擊右上角 <i class="fa-solid fa-gear"></i> 設定月票啟用日';
        els.historyList.appendChild(li);
    }
    
    if (trips.length === 0) {
        els.historyList.innerHTML += '<li style="text-align:center; padding:20px; color:#aaa;">尚無行程紀錄</li>';
        return;
    }

    let lastDateStr = null;
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(trip => {
        // ... (日期分隔線邏輯)...
        if (trip.dateStr !== lastDateStr) {
            const separator = document.createElement('li');
            separator.className = 'date-separator';
            const tripD = new Date(trip.dateStr);
            const today = new Date();
            const isToday = tripD.toDateString() === today.toDateString();
            separator.innerText = isToday ? `今天 (${trip.dateStr})` : trip.dateStr;
            els.historyList.appendChild(separator);
            lastDateStr = trip.dateStr;
        }

        const tDef = TRANSPORT_TYPES[trip.type] || TRANSPORT_TYPES.mrt;
        const li = document.createElement('li');
        li.className = 'history-item';
        
        const isOutOfCycle = currentPeriod.start && (trip.createdAt < currentPeriod.start || trip.createdAt > currentPeriod.end);
        if (isOutOfCycle) {
            li.style.opacity = "0.5";
            li.style.filter = "grayscale(1)";
        }

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

        // [動態顯示金額]
        const displayPaid = trip.isTransfer ? Math.max(0, trip.originalPrice - discount) : trip.originalPrice;
        
        let priceHtml = '';
        if (trip.isTransfer) {
            priceHtml = `<div class="item-right"><span class="price-original">$${trip.originalPrice}</span><span class="price-display">$${displayPaid}</span></div>`;
        } else {
            priceHtml = `<div class="item-right"><div class="price-display">$${displayPaid}</div></div>`;
        }
        
        // ... (產生 li innerHTML)...
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
// 補上遺漏的 form submit event 與 deleteTrip, getIconClass 等函式 (保持原樣即可)
els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("請先登入！");

    const type = document.querySelector('input[name="type"]:checked').value;
    const price = parseFloat(document.getElementById('price').value);
    const isTransfer = document.getElementById('transfer').checked;
    const dateInputVal = els.tripDate.value;

    if (!dateInputVal) return alert("請選擇日期");

    const selectedDate = new Date(dateInputVal);
    const now = new Date();
    selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    const dateStr = dateInputVal.replace(/-/g, '/');

    const routeId = !els.groupRoute.classList.contains('hidden') ? els.inputRoute.value.trim() : '';
    const startStation = !els.groupStations.classList.contains('hidden') ? els.inputStart.value.trim() : '';
    const endStation = !els.groupStations.classList.contains('hidden') ? els.inputEnd.value.trim() : '';

    if (!price || price <= 0) return;

    const submitBtn = els.form.querySelector('.submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "儲存中...";

    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    try {
        await addDoc(collection(db, "users", currentUser.uid, "trips"), {
            createdAt: selectedDate.getTime(),
            dateStr: dateStr,
            type,
            originalPrice: price,
            paidPrice: isTransfer ? Math.max(0, price - discount) : price,
            isTransfer,
            routeId,
            startStation,
            endStation
        });
        // ... 重置表單與 UI
        els.form.reset();
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

window.deleteTrip = async function(tripId) {
    if (!currentUser) return;
    if (confirm('刪除此紀錄？')) {
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, "trips", tripId));
        } catch (e) { console.error(e); }
    }
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