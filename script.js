import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js";
import { 
    collection, addDoc, deleteDoc, query, orderBy, onSnapshot, 
    doc, setDoc, getDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === 狀態變數 ===
let currentUser = null;
let trips = [];
let unsubscribeTrips = null;

// 週期管理
let cycles = []; 
let currentSelectedCycle = null; 

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
    // 儀表板與統計
    finalCost: document.getElementById('finalCost'),
    
    // [新增] 明細折疊區塊相關 ID
    displayOriginalTotal: document.getElementById('displayOriginalTotal'),
    listOriginalDetails: document.getElementById('listOriginalDetails'),
    displayPaidTotal: document.getElementById('displayPaidTotal'),
    listPaidDetails: document.getElementById('listPaidDetails'),

    // 優惠規則區塊
    rule1Discount: document.getElementById('rule1Discount'),
    rule1Detail: document.getElementById('rule1Detail'),
    rule2Discount: document.getElementById('rule2Discount'),
    rule2Detail: document.getElementById('rule2Detail'),
    
    statusText: document.getElementById('statusText'),
    diffText: document.getElementById('diffText'),
    historyList: document.getElementById('historyList'),
    tripCount: document.getElementById('tripCount'),
    
    // 週期選擇
    cycleSelector: document.getElementById('cycleSelector'),

    // 設定 Modal
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsForm: document.getElementById('settingsForm'),
    newCycleDate: document.getElementById('newCycleDate'),
    btnAddCycle: document.getElementById('btnAddCycle'),
    cycleList: document.getElementById('cycleList'),

    // 新增行程 Modal
    modal: document.getElementById('entryModal'),
    form: document.getElementById('tripForm'),
    tripDate: document.getElementById('tripDate'),
    tripTime: document.getElementById('tripTime'),
    transportRadios: document.querySelectorAll('input[name="type"]'),
    groupRoute: document.getElementById('group-route'),
    groupStations: document.getElementById('group-stations'),
    inputRoute: document.getElementById('routeId'),
    inputStart: document.getElementById('startStation'),
    inputEnd: document.getElementById('endStation'),
    transferLabel: document.getElementById('transferLabel'),

    // 編輯 Modal 相關元素
    editModal: document.getElementById('editModal'),
    editForm: document.getElementById('editForm'),
    editTripId: document.getElementById('editTripId'),
    editDate: document.getElementById('editDate'),
    editTime: document.getElementById('editTime'),
    editPrice: document.getElementById('editPrice'),
    editTransfer: document.getElementById('editTransfer'),
    editNote: document.getElementById('editNote'),
    editRouteId: document.getElementById('editRouteId'),
    editStart: document.getElementById('editStart'),
    editEnd: document.getElementById('editEnd'),
    editGroupRoute: document.getElementById('edit-group-route'),
    editGroupStations: document.getElementById('edit-group-stations'),
    editTransferLabel: document.getElementById('editTransferLabel'),
    btnDeleteTrip: document.getElementById('btnDeleteTrip'),
    editTransportRadios: document.querySelectorAll('input[name="editType"]')
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
        cycles = [];
        currentSelectedCycle = null;
        renderUI();
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">請登入以查看或記錄行程</li>';
    }
});

// === 讀取設定 (身分 + 週期列表) ===
async function loadUserSettings(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const docSnap = await getDoc(userDocRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 讀取週期列表
            if (data.cycles && Array.isArray(data.cycles)) {
                cycles = data.cycles.sort((a, b) => b.start - a.start);
            } else if (data.period) {
                cycles = [data.period];
            }

            // 讀取身分
            if (data.identity) {
                currentIdentity = data.identity;
            }
        }
        
        // 更新 UI
        renderCycleSelector(); 
        updateSettingsUI();    
        updateTransferLabel(); 
        
    } catch (e) {
        console.error("讀取設定失敗", e);
    }
}

// === 週期管理邏輯 ===

function renderCycleSelector() {
    els.cycleSelector.innerHTML = '';
    
    if (cycles.length === 0) {
        const opt = document.createElement('option');
        opt.text = "尚未設定週期";
        els.cycleSelector.appendChild(opt);
        currentSelectedCycle = null;
        return;
    }

    cycles.forEach((cycle, index) => {
        const opt = document.createElement('option');
        const start = new Date(cycle.start);
        const end = new Date(cycle.end);
        const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
        
        opt.value = index; 
        opt.text = `${fmt(start)} ~ ${fmt(end)} ${index === 0 ? '(最新)' : ''}`;
        els.cycleSelector.appendChild(opt);
    });

    els.cycleSelector.selectedIndex = 0;
    currentSelectedCycle = cycles[0];
}

els.cycleSelector.addEventListener('change', (e) => {
    const index = e.target.value;
    if (cycles[index]) {
        currentSelectedCycle = cycles[index];
        renderUI(); 
    }
});

els.btnAddCycle.addEventListener('click', async () => {
    const dateVal = els.newCycleDate.value;
    if (!dateVal) return alert("請選擇日期");
    
    const startDate = new Date(dateVal);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 29);
    endDate.setHours(23, 59, 59, 999);

    const newCycle = {
        id: Date.now(), 
        start: startDate.getTime(),
        end: endDate.getTime()
    };

    cycles.push(newCycle);
    cycles.sort((a, b) => b.start - a.start);

    await saveAllSettings();
    
    els.newCycleDate.value = '';
    renderCycleList();     
    renderCycleSelector(); 
    renderUI();            
});

window.deleteCycle = async function(id) {
    if (!confirm("確定要刪除這個週期嗎？")) return;
    cycles = cycles.filter(c => c.id !== id);
    await saveAllSettings();
    renderCycleList();
    renderCycleSelector();
    renderUI();
}

function renderCycleList() {
    els.cycleList.innerHTML = '';
    if (cycles.length === 0) {
        els.cycleList.innerHTML = '<li style="color:#999; text-align:center; padding:10px;">尚無資料</li>';
        return;
    }

    cycles.forEach(cycle => {
        const li = document.createElement('li');
        li.className = 'cycle-manage-item';
        const start = new Date(cycle.start);
        const end = new Date(cycle.end);
        const fmt = d => `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
        
        li.innerHTML = `
            <div>${fmt(start)} ~ ${fmt(end)}</div>
            <button class="btn-delete-cycle" onclick="deleteCycle(${cycle.id})">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        els.cycleList.appendChild(li);
    });
}

async function saveAllSettings() {
    if (!currentUser) return;
    try {
        const userDocRef = doc(db, "users", currentUser.uid);
        const selectedIdentity = document.querySelector('input[name="settingsIdentity"]:checked').value;
        
        await setDoc(userDocRef, { 
            cycles: cycles,
            identity: selectedIdentity
        }, { merge: true });
        
        currentIdentity = selectedIdentity;
        updateTransferLabel();
        
    } catch (e) {
        console.error(e);
        alert("儲存失敗");
    }
}

function updateSettingsUI() {
    const radio = document.querySelector(`input[name="settingsIdentity"][value="${currentIdentity}"]`);
    if (radio) radio.checked = true;
    renderCycleList();
}

function updateTransferLabel() {
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    els.transferLabel.innerText = `我是轉乘 (自動扣除 ${discount} 元)`;
}

els.settingsBtn.addEventListener('click', () => {
    updateSettingsUI();
    els.settingsModal.classList.remove('hidden');
});

window.toggleSettingsModal = function() {
    els.settingsModal.classList.toggle('hidden');
}

els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveAllSettings(); 
    renderUI(); 
    toggleSettingsModal();
});

// === Firestore 監聽 ===
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
        const hh = String(today.getHours()).padStart(2, '0');
        const mi = String(today.getMinutes()).padStart(2, '0');
        const ss = String(today.getSeconds()).padStart(2, '0');
        els.tripTime.value = `${hh}:${mi}:${ss}`;
        
        updateFormFields(document.querySelector('input[name="type"]:checked').value);
        updateTransferLabel();
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

els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("請先登入！");

    const type = document.querySelector('input[name="type"]:checked').value;
    const price = parseFloat(document.getElementById('price').value);
    const isTransfer = document.getElementById('transfer').checked;
    const dateInputVal = els.tripDate.value;
    const timeInputVal = els.tripTime.value;

    if (!dateInputVal || !timeInputVal) return alert("請選擇日期時間");

    const selectedDate = new Date(`${dateInputVal}T${timeInputVal}`);
    const dateStr = dateInputVal.replace(/-/g, '/');
    const timeStr = timeInputVal;

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
            timeStr: timeStr,
            type,
            originalPrice: price,
            paidPrice: isTransfer ? Math.max(0, price - discount) : price,
            isTransfer,
            routeId,
            startStation,
            endStation
        });
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

// === 編輯與詳情功能 ===

// 1. 打開編輯 Modal
window.openEditModal = function(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    // 填入基本資料
    els.editTripId.value = trip.id;
    els.editDate.value = trip.dateStr.replace(/\//g, '-'); // 格式 YYYY-MM-DD
    els.editTime.value = trip.timeStr || '00:00:00';
    els.editPrice.value = trip.originalPrice;
    els.editTransfer.checked = trip.isTransfer;
    els.editNote.value = trip.note || ''; // 填入備註
    
    els.editRouteId.value = trip.routeId || '';
    els.editStart.value = trip.startStation || '';
    els.editEnd.value = trip.endStation || '';

    // 設定運具 Radio
    const radio = document.querySelector(`input[name="editType"][value="${trip.type}"]`);
    if (radio) radio.checked = true;

    // 更新 UI 顯示 (隱藏/顯示路線欄位)
    updateEditFormFields(trip.type);
    
    // 更新轉乘標籤文字
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    els.editTransferLabel.innerText = `我是轉乘 (自動扣除 ${discount} 元)`;

    // 顯示 Modal
    els.editModal.classList.remove('hidden');
}

// 2. 關閉編輯 Modal
window.closeEditModal = function() {
    els.editModal.classList.add('hidden');
}

// 3. 監聽編輯表單的運具切換
els.editTransportRadios.forEach(radio => {
    radio.addEventListener('change', (e) => updateEditFormFields(e.target.value));
});

function updateEditFormFields(type) {
    els.editGroupRoute.classList.add('hidden');
    els.editGroupStations.classList.add('hidden');
    
    if (type === 'bus') {
        els.editGroupRoute.classList.remove('hidden');
    } else if (type === 'coach') {
        els.editGroupRoute.classList.remove('hidden');
        els.editGroupStations.classList.remove('hidden');
    } else {
        els.editGroupStations.classList.remove('hidden');
    }
}

// 4. 提交編輯
els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const tripId = els.editTripId.value;
    const type = document.querySelector('input[name="editType"]:checked').value;
    const price = parseFloat(els.editPrice.value);
    const isTransfer = els.editTransfer.checked;
    const dateInputVal = els.editDate.value;
    const timeInputVal = els.editTime.value;
    const note = els.editNote.value.trim();

    if (!dateInputVal || !timeInputVal) return alert("日期時間錯誤");

    const selectedDate = new Date(`${dateInputVal}T${timeInputVal}`);
    const dateStr = dateInputVal.replace(/-/g, '/');
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    try {
        const tripRef = doc(db, "users", currentUser.uid, "trips", tripId);
        await updateDoc(tripRef, {
            createdAt: selectedDate.getTime(),
            dateStr: dateStr,
            timeStr: timeInputVal,
            type: type,
            originalPrice: price,
            paidPrice: isTransfer ? Math.max(0, price - discount) : price,
            isTransfer: isTransfer,
            routeId: els.editRouteId.value.trim(),
            startStation: els.editStart.value.trim(),
            endStation: els.editEnd.value.trim(),
            note: note // 儲存備註
        });

        closeEditModal();
    } catch (e) {
        console.error(e);
        alert("更新失敗");
    }
});

// 5. 刪除按鈕邏輯
els.btnDeleteTrip.addEventListener('click', async () => {
    const tripId = els.editTripId.value;
    if (!tripId) return;

    if (confirm('確定要刪除這筆紀錄嗎？\n刪除後無法復原。')) {
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, "trips", tripId));
            closeEditModal();
        } catch (e) {
            console.error(e);
            alert("刪除失敗");
        }
    }
});

// === 核心計算邏輯 (修正版) ===
function calculate() {
    let stats = { 
        totalPaid: 0, 
        totalOriginal: 0, // [新增] 總原價
        counts: {}, 
        originalSums: {}, // [Rule 1 用]
        paidSums: {}      // [Rule 2 用]
    };

    Object.keys(TRANSPORT_TYPES).forEach(k => { 
        stats.counts[k] = 0; 
        stats.originalSums[k] = 0; 
        stats.paidSums[k] = 0; 
    });

    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        // 過濾週期
        if (!currentSelectedCycle || t.createdAt < currentSelectedCycle.start || t.createdAt > currentSelectedCycle.end) {
            return;
        }

        // 計算這一筆的「實付金額」
        let finalPrice = t.originalPrice;
        if (t.isTransfer) {
            finalPrice = Math.max(0, t.originalPrice - discount);
        }

        // 總支出 (顯示在儀表板左邊)
        stats.totalPaid += finalPrice;
        
        // [新增] 總原價
        stats.totalOriginal += t.originalPrice;
        
        // 累積次數
        stats.counts[t.type]++;
        
        // [Rule 1 用] 累積原價
        stats.originalSums[t.type] += t.originalPrice;

        // [Rule 2 用] 累積實付金額
        stats.paidSums[t.type] += finalPrice;
    });

    // --- Rule 1: 北捷與台鐵常客優惠 (依照「原價」計算) ---
    let r1_cashback = 0;
    let r1_details = [];
    
    // 北捷 (看 originalSums)
    const mrtCount = stats.counts.mrt;
    const mrtSum = stats.originalSums.mrt; // 使用原價
    let mrtRate = 0;
    if (mrtCount > 40) mrtRate = 0.15;
    else if (mrtCount > 20) mrtRate = 0.10;
    else if (mrtCount > 10) mrtRate = 0.05;
    
    if (mrtRate > 0) {
        const mrtCashback = mrtSum * mrtRate;
        r1_cashback += mrtCashback;
        r1_details.push({ text: `北捷 ${mrtCount} 趟，回饋 ${(mrtRate*100)}%`, amount: `-$${Math.floor(mrtCashback)}` });
    }

    // 台鐵 (看 originalSums)
    const traCount = stats.counts.tra;
    const traSum = stats.originalSums.tra; // 使用原價
    let traRate = 0;
    if (traCount > 40) traRate = 0.20;
    else if (traCount > 20) traRate = 0.15;
    else if (traCount > 10) traRate = 0.10;
    
    if (traRate > 0) {
        const traCashback = traSum * traRate;
        r1_cashback += traCashback;
        r1_details.push({ text: `台鐵 ${traCount} 趟，回饋 ${(traRate*100)}%`, amount: `-$${Math.floor(traCashback)}` });
    }

    // --- Rule 2: TPass 2.0 回饋 (依照「實付金額」計算) ---
    let r2_cashback = 0;
    let r2_details = [];
    
    // 軌道運具 (北捷/台鐵/機捷/輕軌)
    const railCount = stats.counts.mrt + stats.counts.tra + stats.counts.tymrt + stats.counts.lrt;
    // [修正] 改用 paidSums (實付金額) 來算 2%
    const railPaidSum = stats.paidSums.mrt + stats.paidSums.tra + stats.paidSums.tymrt + stats.paidSums.lrt;
    
    if (railCount >= 11) {
        const railCashback = railPaidSum * 0.02; // 用實付金額 x 2%
        r2_cashback += railCashback;
        r2_details.push({ text: `軌道 ${railCount} 趟，回饋 2%`, amount: `-$${Math.floor(railCashback)}` });
    }

    // 公車與客運
    const busCount = stats.counts.bus + stats.counts.coach;
    // [修正] 改用 paidSums (實付金額) 來算 15%/30%
    const busPaidSum = stats.paidSums.bus + stats.paidSums.coach;
    
    let busRate = 0;
    if (busCount > 30) busRate = 0.30;
    else if (busCount >= 11) busRate = 0.15;
    
    if (busRate > 0) {
        const busCashback = busPaidSum * busRate; // 用實付金額 x 匯率
        r2_cashback += busCashback;
        r2_details.push({ text: `公車客運 ${busCount} 趟，回饋 ${(busRate*100)}%`, amount: `-$${Math.floor(busCashback)}` });
    }

    return {
        totalPaid: stats.totalPaid,
        totalOriginal: stats.totalOriginal, // [新增]
        originalSums: stats.originalSums,   // [新增]
        paidSums: stats.paidSums,           // [新增]
        r1: { amount: r1_cashback, details: r1_details },
        r2: { amount: r2_cashback, details: r2_details },
        finalCost: stats.totalPaid - r1_cashback - r2_cashback
    };
}

function renderUI() {
    if (!currentUser) return;

    const data = calculate();
    const finalVal = Math.floor(data.finalCost);

    // 1. 更新大標題金額
    els.finalCost.innerText = `$${finalVal}`;

    // 2. 更新 [原始金額] 區塊 (折疊明細)
    els.displayOriginalTotal.innerText = `$${Math.floor(data.totalOriginal)}`;
    els.listOriginalDetails.innerHTML = generateDetailHtml(data.originalSums);

    // 3. 更新 [實付金額] 區塊 (折疊明細)
    els.displayPaidTotal.innerText = `$${Math.floor(data.totalPaid)}`;
    els.listPaidDetails.innerHTML = generateDetailHtml(data.paidSums);

    // 4. 更新優惠區塊 (規則 1 & 2)
    els.rule1Discount.innerText = `-$${Math.floor(data.r1.amount)}`;
    els.rule1Detail.innerHTML = data.r1.details.length 
        ? data.r1.details.map(d => `<div class="rule-detail-row"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') 
        : '';

    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length 
        ? data.r2.details.map(d => `<div class="rule-detail-row"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') 
        : '';
    
    // 5. 更新狀態文字
    const diff = TPASS_PRICE - finalVal;
    if (diff < 0) {
        els.statusText.innerText = "已回本！";
        els.statusText.className = "status-win";
        els.diffText.innerText = `倒賺 $${Math.abs(diff)} 元`;
    } else {
        els.statusText.innerText = "目前虧本";
        els.statusText.className = "status-loss";
        els.diffText.innerText = `還差 $${diff} 元回本`;
    }

    // 6. 渲染歷史列表
    els.historyList.innerHTML = '';

    if (!currentSelectedCycle) {
        const li = document.createElement('li');
        li.style.background = '#fff3cd';
        li.style.padding = '10px';
        li.style.borderRadius = '8px';
        li.style.textAlign = 'center';
        li.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 請點擊右上角設定新增第一筆月票週期';
        els.historyList.appendChild(li);
        return;
    }
    
    if (trips.length === 0) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">尚無行程紀錄</li>';
        return;
    }

    let lastDateStr = null;
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    let currentCycleTripCount = 0; 

    trips.forEach(trip => {
        // 過濾非本期
        const isOutOfCycle = currentSelectedCycle && (trip.createdAt < currentSelectedCycle.start || trip.createdAt > currentSelectedCycle.end);
        
        if (isOutOfCycle) return;

        currentCycleTripCount++;

        // 日期分隔線
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
        
        // 標題邏輯
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

        const displayPaid = trip.isTransfer ? Math.max(0, trip.originalPrice - discount) : trip.originalPrice;
        let priceHtml = '';
        if (trip.isTransfer) {
            priceHtml = `<div class="item-right"><span class="price-original">$${trip.originalPrice}</span><span class="price-display">$${displayPaid}</span></div>`;
        } else {
            priceHtml = `<div class="item-right"><div class="price-display">$${displayPaid}</div></div>`;
        }

        // 讓整行可點擊
        li.setAttribute('onclick', `openEditModal('${trip.id}')`);
        
        // 備註小圖示
        const noteIcon = trip.note ? `<i class="fa-solid fa-note-sticky" style="color:#f1c40f; margin-left:5px;"></i>` : '';

        li.innerHTML = `
            <div class="item-left">
                <div class="t-icon ${tDef.class}">
                    <i class="fa-solid ${getIconClass(trip.type)}"></i>
                </div>
                <div class="item-info">
                    <h4>${titleDesc} ${trip.isTransfer ? '<i class="fa-solid fa-link" style="color:#27ae60; font-size:12px;"></i>' : ''} ${noteIcon}</h4>
                    <small>${tDef.name}</small>
                </div>
            </div>
            ${priceHtml}
            <div style="color:#ccc; font-size:12px; margin-left:10px;"><i class="fa-solid fa-chevron-right"></i></div>
        `;
        els.historyList.appendChild(li);
    });

    els.tripCount.innerText = currentCycleTripCount;

    if (currentCycleTripCount === 0) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:30px; color:#aaa;">本週期尚無行程紀錄<br><small>點擊右下角 + 新增第一筆</small></li>';
    }
}

// [新增] 產生細項 HTML 的輔助函式
function generateDetailHtml(sumsObj) {
    let html = '';
    let hasData = false;

    // 遍歷所有運具類型
    for (const [type, sum] of Object.entries(sumsObj)) {
        if (sum > 0) {
            hasData = true;
            const name = TRANSPORT_TYPES[type].name;
            const colorClass = TRANSPORT_TYPES[type].class; // 用於之後可以擴充顏色點點
            
            html += `
                <div class="detail-row">
                    <span>
                        <i class="fa-solid fa-circle" style="font-size:8px; margin-right:5px; opacity:0.7;"></i>
                        ${name}
                    </span>
                    <span>$${Math.floor(sum)}</span>
                </div>
            `;
        }
    }

    if (!hasData) {
        return '<div style="text-align:center; opacity:0.5;">尚無資料</div>';
    }
    return html;
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

// === iOS 引導加入主畫面邏輯 ===
window.checkPWAStatus = function() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isIOS && !isStandalone) {
        const hasSeenGuide = localStorage.getItem('hasSeenIOSGuide');
        if (!hasSeenGuide) {
            document.getElementById('ios-guide').classList.remove('hidden');
        }
    }
}

window.closeGuide = function() {
    document.getElementById('ios-guide').classList.add('hidden');
    localStorage.setItem('hasSeenIOSGuide', 'true');
}

window.addEventListener('load', () => {
    setTimeout(checkPWAStatus, 2000);
});