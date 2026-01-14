import { db } from "./firebase-config.js";
import { initAuthListener } from "./auth.js";
import { STATIONS, MRT_LINES } from "./data/stations.js";      // [修改] 引入 MRT_LINES
import { getOfficialFare } from "./data/fares.js";
import { 
    collection, addDoc, deleteDoc, query, orderBy, onSnapshot, 
    doc, setDoc, getDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ADMIN_EMAIL = "rayhsu63@gmail.com";

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
    adminBtn: document.getElementById('adminBtn'),

    // 明細折疊區塊
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
    // inputStart/End 在這裡主要用於舊邏輯引用，新邏輯我們會動態抓取
    inputStart: document.getElementById('startStation'), 
    inputEnd: document.getElementById('endStation'),
    transferLabel: document.getElementById('transferLabel'),
    isFree: document.getElementById('isFree'),

    // 編輯 Modal
    editModal: document.getElementById('editModal'),
    editForm: document.getElementById('editForm'),
    editTripId: document.getElementById('editTripId'),
    editDate: document.getElementById('editDate'),
    editTime: document.getElementById('editTime'),
    editPrice: document.getElementById('editPrice'),
    editTransfer: document.getElementById('editTransfer'),
    editIsFree: document.getElementById('editIsFree'),
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

        // [修改] 初始化雙層下拉選單
        initStationSelectors();

        if (user.email === ADMIN_EMAIL) {
            if (els.adminBtn) {
                els.adminBtn.classList.remove('hidden');
                els.adminBtn.onclick = () => {
                    window.location.href = "admin.html";
                };
            }
        } else {
            if (els.adminBtn) els.adminBtn.classList.add('hidden');
        }

    } else {
        window.location.href = "index.html";
        trips = [];
        cycles = [];
        currentSelectedCycle = null;
        renderUI();
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">請登入以查看或記錄行程</li>';
    }
});

// === 讀取設定 ===
async function loadUserSettings(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const docSnap = await getDoc(userDocRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            
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
        
        els.isFree.checked = false;
        els.modal.classList.remove('hidden');
    } else {
        els.modal.classList.add('hidden');
    }
}

els.transportRadios.forEach(radio => {
    radio.addEventListener('change', (e) => updateFormFields(e.target.value));
});

// === [修改] 表單欄位切換邏輯 ===
function updateFormFields(type) {
    els.groupRoute.classList.add('hidden');
    els.groupStations.classList.remove('hidden'); // 預設顯示起訖站區塊
    const priceInput = document.getElementById('price');
    
    // 取得 DOM 元素
    const mrtStart = document.getElementById('mrt-selector-start');
    const mrtEnd = document.getElementById('mrt-selector-end');
    const textStart = document.getElementById('startStationInput');
    const textEnd = document.getElementById('endStationInput');

    // 確保元素存在再操作 (避免報錯)
    if (!mrtStart || !textStart) return;

    if (type === 'bus') {
        els.groupRoute.classList.remove('hidden');
        els.groupStations.classList.add('hidden'); // 公車通常不需要起訖站
        if (priceInput.value === '') priceInput.value = FARE_CONFIG[currentIdentity].busBase;
        
    } else if (type === 'mrt') {
        // === 捷運模式：顯示下拉選單，隱藏文字框 ===
        mrtStart.classList.remove('hidden');
        mrtEnd.classList.remove('hidden');
        textStart.classList.add('hidden');
        textEnd.classList.add('hidden');
        priceInput.value = '';

    } else {
        // === 其他模式(客運/台鐵)：顯示文字輸入，隱藏選單 ===
        mrtStart.classList.add('hidden');
        mrtEnd.classList.add('hidden');
        textStart.classList.remove('hidden');
        textEnd.classList.remove('hidden');
        priceInput.value = '';
    }
}

// === [修改] 表單送出 ===
els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("請先登入！");

    const type = document.querySelector('input[name="type"]:checked').value;
    const price = parseFloat(document.getElementById('price').value);
    const isTransfer = document.getElementById('transfer').checked;
    const isFree = els.isFree.checked;
    
    const dateInputVal = els.tripDate.value;
    const timeInputVal = els.tripTime.value;

    if (!dateInputVal || !timeInputVal) return alert("請選擇日期時間");

    // === [關鍵修改] 根據類型決定去哪裡抓「起點/終點」的值 ===
    let startStation = '';
    let endStation = '';
    const routeId = !els.groupRoute.classList.contains('hidden') ? els.inputRoute.value.trim() : '';

    if (type === 'mrt') {
        // 捷運模式：抓下拉選單的值 (els.inputStart 指向的是 #startStation 即 select)
        startStation = document.getElementById('startStation').value;
        endStation = document.getElementById('endStation').value;
        if (!startStation || !endStation) return alert("請選擇起訖車站");
    } else {
        // 其他模式：抓文字框的值
        if (!els.groupStations.classList.contains('hidden')) {
            const sInput = document.getElementById('startStationInput');
            const eInput = document.getElementById('endStationInput');
            if (sInput) startStation = sInput.value.trim();
            if (eInput) endStation = eInput.value.trim();
        }
    }

    if (!price && price !== 0) return;

    const submitBtn = els.form.querySelector('.submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "儲存中...";

    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    const selectedDate = new Date(`${dateInputVal}T${timeInputVal}`);
    const dateStr = dateInputVal.replace(/-/g, '/');
    const timeStr = timeInputVal;

    try {
        await addDoc(collection(db, "users", currentUser.uid, "trips"), {
            createdAt: selectedDate.getTime(),
            dateStr: dateStr,
            timeStr: timeStr,
            type,
            originalPrice: price,
            paidPrice: isFree ? 0 : (isTransfer ? Math.max(0, price - discount) : price),
            isTransfer,
            isFree: isFree,
            routeId,
            startStation,
            endStation
        });
        
        els.form.reset();
        
        // 重設為捷運模式
        document.querySelector('input[value="mrt"]').checked = true;
        updateFormFields('mrt');
        
        // 重設選單
        const startLineSelect = document.getElementById('startLine');
        const endLineSelect = document.getElementById('endLine');
        if(startLineSelect) startLineSelect.selectedIndex = 0;
        if(endLineSelect) endLineSelect.selectedIndex = 0;
        // 觸發一下 change 來清空車站選單
        if(startLineSelect) startLineSelect.dispatchEvent(new Event('change'));
        if(endLineSelect) endLineSelect.dispatchEvent(new Event('change'));

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
window.openEditModal = function(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    els.editTripId.value = trip.id;
    els.editDate.value = trip.dateStr.replace(/\//g, '-'); 
    els.editTime.value = trip.timeStr || '00:00:00';
    els.editPrice.value = trip.originalPrice;
    els.editTransfer.checked = trip.isTransfer;
    els.editIsFree.checked = trip.isFree || false;
    els.editNote.value = trip.note || ''; 
    
    els.editRouteId.value = trip.routeId || '';
    
    // 注意：編輯 Modal 目前尚未實作雙層下拉，這裡先維持簡單的填入
    // 若要支援編輯時也是雙層下拉，需要額外寫很多邏輯 (反查路線)
    // 建議編輯時先顯示純文字即可，或是只在新增時用雙層選單
    if (trip.type === 'mrt') {
        // 如果您希望編輯時也能看到文字，需要確保 editModal 裡有對應的 input
        // 這裡維持原樣，假設 editModal 只有文字框
        els.editStart.value = trip.startStation || '';
        els.editEnd.value = trip.endStation || '';
    } else {
        els.editStart.value = trip.startStation || '';
        els.editEnd.value = trip.endStation || '';
    }

    const radio = document.querySelector(`input[name="editType"][value="${trip.type}"]`);
    if (radio) radio.checked = true;

    updateEditFormFields(trip.type);
    
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    els.editTransferLabel.innerText = `我是轉乘 (自動扣除 ${discount} 元)`;

    els.editModal.classList.remove('hidden');
}

window.closeEditModal = function() {
    els.editModal.classList.add('hidden');
}

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

els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const tripId = els.editTripId.value;
    const type = document.querySelector('input[name="editType"]:checked').value;
    const price = parseFloat(els.editPrice.value);
    const isTransfer = els.editTransfer.checked;
    const isFree = els.editIsFree.checked;
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
            paidPrice: isFree ? 0 : (isTransfer ? Math.max(0, price - discount) : price),
            isTransfer: isTransfer,
            isFree: isFree,
            routeId: els.editRouteId.value.trim(),
            startStation: els.editStart.value.trim(),
            endStation: els.editEnd.value.trim(),
            note: note 
        });

        closeEditModal();
    } catch (e) {
        console.error(e);
        alert("更新失敗");
    }
});

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

// === 核心計算邏輯 ===
function calculate() {
    let globalMonthlyCounts = {};

    trips.forEach(t => {
        const monthKey = t.dateStr.slice(0, 7);
        if (!globalMonthlyCounts[monthKey]) {
            globalMonthlyCounts[monthKey] = {
                mrt: 0, tra: 0, tymrt: 0, lrt: 0, bus: 0, coach: 0, bike: 0
            };
        }
        globalMonthlyCounts[monthKey][t.type]++;
    });

    let totalStats = {
        totalPaid: 0,
        totalOriginal: 0,
        originalSums: {}, 
        paidSums: {},
        counts: {} 
    };

    Object.keys(TRANSPORT_TYPES).forEach(k => {
        totalStats.originalSums[k] = 0;
        totalStats.paidSums[k] = 0;
        totalStats.counts[k] = 0; 
    });

    let cycleMonthlyStats = {}; 
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        if (!currentSelectedCycle || t.createdAt < currentSelectedCycle.start || t.createdAt > currentSelectedCycle.end) {
            return;
        }

        let op = t.isFree ? 0 : t.originalPrice; 
        let pp = t.isFree ? 0 : t.paidPrice;
        
        if (pp === undefined) {
             pp = t.isTransfer ? Math.max(0, t.originalPrice - discount) : t.originalPrice;
        }

        totalStats.totalPaid += pp;
        totalStats.totalOriginal += op;
        totalStats.originalSums[t.type] += op;
        totalStats.paidSums[t.type] += pp;
        totalStats.counts[t.type]++; 

        const monthKey = t.dateStr.slice(0, 7);

        if (!cycleMonthlyStats[monthKey]) {
            cycleMonthlyStats[monthKey] = {
                originalSums: {},
                paidSums: {}
            };
            Object.keys(TRANSPORT_TYPES).forEach(k => {
                cycleMonthlyStats[monthKey].originalSums[k] = 0;
                cycleMonthlyStats[monthKey].paidSums[k] = 0;
            });
        }
        cycleMonthlyStats[monthKey].originalSums[t.type] += op;
        cycleMonthlyStats[monthKey].paidSums[t.type] += pp;
    });

    let r1_total_cashback = 0;
    let r1_all_details = [];
    let r2_total_cashback = 0;
    let r2_all_details = [];

    const sortedMonths = Object.keys(cycleMonthlyStats).sort();

    sortedMonths.forEach(month => {
        const monthLabel = `${month.split('/')[1]}月`;
        
        const gCounts = globalMonthlyCounts[month] || { mrt:0, tra:0, bus:0, coach:0, tymrt:0, lrt:0 };
        const cSums = cycleMonthlyStats[month];

        const mrtCountGlobal = gCounts.mrt;
        const mrtSumCycle = cSums.originalSums.mrt;
        
        let mrtRate = 0;
        if (mrtCountGlobal > 40) mrtRate = 0.15;
        else if (mrtCountGlobal > 20) mrtRate = 0.10;
        else if (mrtCountGlobal > 10) mrtRate = 0.05;

        if (mrtRate > 0 && mrtSumCycle > 0) {
            const amt = Math.floor(mrtSumCycle * mrtRate);
            r1_total_cashback += amt;
            r1_all_details.push({ 
                text: `<span class="month-badge">${monthLabel}</span>北捷累計 ${mrtCountGlobal} 趟 (${Math.round(mrtRate*100)}%)`, 
                amount: `-$${amt}` 
            });
        }

        const traCountGlobal = gCounts.tra;
        const traSumCycle = cSums.originalSums.tra;
        
        let traRate = 0;
        if (traCountGlobal > 40) traRate = 0.20;
        else if (traCountGlobal > 20) traRate = 0.15;
        else if (traCountGlobal > 10) traRate = 0.10;
        
        if (traRate > 0 && traSumCycle > 0) {
            const amt = Math.floor(traSumCycle * traRate);
            r1_total_cashback += amt;
            r1_all_details.push({ 
                text: `<span class="month-badge">${monthLabel}</span>台鐵累計 ${traCountGlobal} 趟 (${Math.round(traRate*100)}%)`, 
                amount: `-$${amt}` 
            });
        }

        const railCountGlobal = gCounts.mrt + gCounts.tra + gCounts.tymrt + gCounts.lrt;
        const railPaidSumCycle = cSums.paidSums.mrt + cSums.paidSums.tra + cSums.paidSums.tymrt + cSums.paidSums.lrt;
        
        if (railCountGlobal >= 11 && railPaidSumCycle > 0) { 
            const amt = Math.floor(railPaidSumCycle * 0.02); 
            r2_total_cashback += amt;
            r2_all_details.push({ 
                text: `<span class="month-badge">${monthLabel}</span>軌道累計 ${railCountGlobal} 趟 (2%)`, 
                amount: `-$${amt}` 
            });
        }

        const busCountGlobal = gCounts.bus + gCounts.coach;
        const busPaidSumCycle = cSums.paidSums.bus + cSums.paidSums.coach;
        
        let busRate = 0;
        if (busCountGlobal > 30) busRate = 0.30;       
        else if (busCountGlobal >= 11) busRate = 0.15; 
        
        if (busRate > 0 && busPaidSumCycle > 0) {
            const amt = Math.floor(busPaidSumCycle * busRate);
            r2_total_cashback += amt;
            r2_all_details.push({ 
                text: `<span class="month-badge">${monthLabel}</span>公車累計 ${busCountGlobal} 趟 (${Math.round(busRate*100)}%)`, 
                amount: `-$${amt}` 
            });
        }
    });

    return {
        totalPaid: totalStats.totalPaid,
        totalOriginal: totalStats.totalOriginal,
        originalSums: totalStats.originalSums,
        paidSums: totalStats.paidSums,
        counts: totalStats.counts, 
        r1: { amount: r1_total_cashback, details: r1_all_details },
        r2: { amount: r2_total_cashback, details: r2_all_details },
        finalCost: totalStats.totalPaid - r1_total_cashback - r2_total_cashback
    };
}

function renderUI() {
    if (!currentUser) return;

    const data = calculate();
    const finalVal = Math.floor(data.finalCost);

    els.finalCost.innerText = `$${finalVal}`;

    els.displayOriginalTotal.innerText = `$${Math.floor(data.totalOriginal)}`;
    els.listOriginalDetails.innerHTML = generateDetailHtml(data.originalSums, data.counts);
    els.displayPaidTotal.innerText = `$${Math.floor(data.totalPaid)}`;
    els.listPaidDetails.innerHTML = generateDetailHtml(data.paidSums, data.counts);

    els.rule1Discount.innerText = `-$${Math.floor(data.r1.amount)}`;
    els.rule1Detail.innerHTML = data.r1.details.length 
        ? data.r1.details.map(d => `<div class="rule-detail-row"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') 
        : '';

    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length 
        ? data.r2.details.map(d => `<div class="rule-detail-row"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') 
        : '';
    
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

    const dailyTotals = {};
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        if (!currentSelectedCycle || t.createdAt < currentSelectedCycle.start || t.createdAt > currentSelectedCycle.end) {
            return;
        }
        
        let cost = 0;
        if (t.isFree) cost = 0;
        else if (t.paidPrice !== undefined) cost = t.paidPrice;
        else cost = t.isTransfer ? Math.max(0, t.originalPrice - discount) : t.originalPrice;
        
        if (!dailyTotals[t.dateStr]) dailyTotals[t.dateStr] = 0;
        dailyTotals[t.dateStr] += cost;
    });

    let lastDateStr = null;
    let currentCycleTripCount = 0; 

    trips.forEach(trip => {
        if (!currentSelectedCycle || trip.createdAt < currentSelectedCycle.start || trip.createdAt > currentSelectedCycle.end) {
            return;
        }

        currentCycleTripCount++;

        if (trip.dateStr !== lastDateStr) {
            const separator = document.createElement('li');
            separator.className = 'date-separator';
            
            const tripD = new Date(trip.dateStr);
            const today = new Date();
            const isToday = tripD.toDateString() === today.toDateString();
            const dateText = isToday ? `今天 (${trip.dateStr})` : trip.dateStr;
            const daySum = dailyTotals[trip.dateStr] || 0;

            separator.innerHTML = `
                <span style="display:flex; align-items:center; gap:8px;">
                    <span>${dateText}</span>
                    <span style="font-size:11px; background:rgba(0,0,0,0.08); color:#666; padding:2px 8px; border-radius:12px; font-weight:normal;">
                        $${daySum}
                    </span>
                </span>
            `;
            
            els.historyList.appendChild(separator);
            lastDateStr = trip.dateStr;
        }

        const tDef = TRANSPORT_TYPES[trip.type] || TRANSPORT_TYPES.mrt;
        const li = document.createElement('li');
        li.className = 'history-item';
        
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
        if (trip.isFree) {
            priceHtml = `<div class="item-right"><div class="price-display" style="color:#e17055;"><i class="fa-solid fa-gift"></i> $0</div></div>`;
        } else {
            const displayPaid = trip.isTransfer ? Math.max(0, trip.originalPrice - discount) : trip.originalPrice;
            if (trip.isTransfer) {
                priceHtml = `<div class="item-right"><span class="price-original">$${trip.originalPrice}</span><span class="price-display">$${displayPaid}</span></div>`;
            } else {
                priceHtml = `<div class="item-right"><div class="price-display">$${displayPaid}</div></div>`;
            }
        }

        li.setAttribute('onclick', `openEditModal('${trip.id}')`);
        
        const noteIcon = trip.note ? `<i class="fa-solid fa-note-sticky" style="color:#f1c40f; margin-left:5px;"></i>` : '';
        const transferIcon = trip.isTransfer ? '<i class="fa-solid fa-link" style="color:#27ae60; font-size:12px;"></i>' : '';

        li.innerHTML = `
            <div class="item-left">
                <div class="t-icon ${tDef.class}">
                    <i class="fa-solid ${getIconClass(trip.type)}"></i>
                </div>
                <div class="item-info">
                    <h4>${titleDesc} ${transferIcon} ${noteIcon}</h4>
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

function generateDetailHtml(sumsObj, countsObj) {
    let html = '';
    let hasData = false;

    for (const [type, sum] of Object.entries(sumsObj)) {
        if (sum > 0) {
            hasData = true;
            const name = TRANSPORT_TYPES[type].name;
            const count = countsObj[type] || 0; 
            
            html += `
                <div class="detail-row">
                    <span>
                        <i class="fa-solid fa-circle" style="font-size:8px; margin-right:5px; opacity:0.7;"></i>
                        ${name}
                        <small style="opacity:0.7; margin-left:5px;">(${count} 趟)</small>
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

// === [新增] 車站自動完成與查價功能 (Line-First 雙層下拉版) ===

function initStationSelectors() {
    // 1. 填入「路線」選單 (起點 & 終點)
    const lineSelects = ['startLine', 'endLine'];
    
    lineSelects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        // 確保不會重複添加
        if (el.options.length > 1) return;

        el.innerHTML = '<option value="" disabled selected>選擇路線</option>';
        if (typeof MRT_LINES !== 'undefined') {
            for (const [code, info] of Object.entries(MRT_LINES)) {
                const opt = document.createElement('option');
                opt.value = code;
                opt.textContent = info.name;
                el.appendChild(opt);
            }
        }

        // 綁定事件：選路線 -> 更新車站
        el.addEventListener('change', (e) => {
            const targetStationSelectId = id.replace('Line', 'Station'); // startLine -> startStation
            updateStationList(e.target.value, targetStationSelectId);
        });
    });

    // 綁定查價事件 (當車站改變時)
    // 注意：原本 #startStation 是 input text，現在是 select，change 事件依然適用
    const inputs = ['startStation', 'endStation', 'startStationInput', 'endStationInput'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('change', tryAutoFillPrice);
            if (id.includes('Input')) {
                el.addEventListener('input', tryAutoFillPrice); // 文字框打字時也觸發
            }
        }
    });
}

function updateStationList(lineCode, selectElementId) {
    const stationSelect = document.getElementById(selectElementId);
    if (!stationSelect) return;

    const lineData = MRT_LINES[lineCode];
    
    stationSelect.innerHTML = '<option value="">選擇車站</option>';
    
    if (lineData) {
        lineData.stations.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            stationSelect.appendChild(opt);
        });
    }
}

function tryAutoFillPrice() {
    const typeEl = document.querySelector('input[name="type"]:checked');
    if (!typeEl || typeEl.value !== 'mrt') return;

    // 捷運模式直接抓 select 的 value
    const startEl = document.getElementById('startStation');
    const endEl = document.getElementById('endStation');
    const priceEl = document.getElementById('price');

    if (!startEl || !endEl || !priceEl) return;

    const s = startEl.value;
    const e = endEl.value;

    if (!s || !e) return;

    // 策略 1: 查歷史紀錄
    const historyTrip = trips.find(t => 
        t.type === 'mrt' && 
        ((t.startStation === s && t.endStation === e) || 
         (t.startStation === e && t.endStation === s))
    );

    if (historyTrip) {
        priceEl.value = historyTrip.originalPrice;
        flashPriceInput(priceEl, '#d1fae5'); // 綠色：歷史
        return;
    }

    // 策略 2: 查官方票價 (fares.js)
    if (typeof getOfficialFare === 'function') {
        const officialPrice = getOfficialFare(s, e);
        if (officialPrice !== null) {
            priceEl.value = officialPrice;
            flashPriceInput(priceEl, '#dbeafe'); // 藍色：官方
            return;
        }
    }
}

function flashPriceInput(el, color) {
    el.style.transition = "background-color 0.3s";
    el.style.backgroundColor = color;
    setTimeout(() => {
        el.style.backgroundColor = "";
    }, 800);
}