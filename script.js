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

// [修改] 改為陣列管理多個週期
// 結構: [{ id: timestamp, start: timestamp, end: timestamp }, ...]
let cycles = []; 
let currentSelectedCycle = null; // 目前下拉選單選中的週期

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
    
    // [修改] 下拉選單
    cycleSelector: document.getElementById('cycleSelector'),

    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsForm: document.getElementById('settingsForm'),
    
    // [新增] 週期管理相關
    newCycleDate: document.getElementById('newCycleDate'),
    btnAddCycle: document.getElementById('btnAddCycle'),
    cycleList: document.getElementById('cycleList'),

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
                // 依照開始時間倒序排列 (新的在前)
                cycles = data.cycles.sort((a, b) => b.start - a.start);
            } else if (data.period) {
                // 相容舊資料：如果只有單一 period，把它轉成陣列的第一筆
                cycles = [data.period];
            }

            // 讀取身分
            if (data.identity) {
                currentIdentity = data.identity;
            }
        }
        
        // 更新 UI
        renderCycleSelector(); // 渲染下拉選單
        updateSettingsUI();    // 更新設定視窗狀態
        updateTransferLabel(); 
        
    } catch (e) {
        console.error("讀取設定失敗", e);
    }
}

// === 週期管理邏輯 ===

// 1. 渲染首頁下拉選單
function renderCycleSelector() {
    els.cycleSelector.innerHTML = '';
    
    if (cycles.length === 0) {
        const opt = document.createElement('option');
        opt.text = "尚未設定週期";
        els.cycleSelector.appendChild(opt);
        currentSelectedCycle = null;
        return;
    }

    // 產生選項
    cycles.forEach((cycle, index) => {
        const opt = document.createElement('option');
        const start = new Date(cycle.start);
        const end = new Date(cycle.end);
        const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
        
        opt.value = index; // 用 index 當 key
        opt.text = `${fmt(start)} ~ ${fmt(end)} ${index === 0 ? '(最新)' : ''}`;
        els.cycleSelector.appendChild(opt);
    });

    // 預設選中第一個 (最新的)
    els.cycleSelector.selectedIndex = 0;
    currentSelectedCycle = cycles[0];
}

// 2. 下拉選單切換事件
els.cycleSelector.addEventListener('change', (e) => {
    const index = e.target.value;
    if (cycles[index]) {
        currentSelectedCycle = cycles[index];
        renderUI(); // 切換後重算
    }
});

// 3. 新增週期
els.btnAddCycle.addEventListener('click', async () => {
    const dateVal = els.newCycleDate.value;
    if (!dateVal) return alert("請選擇日期");
    
    const startDate = new Date(dateVal);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 29);
    endDate.setHours(23, 59, 59, 999);

    const newCycle = {
        id: Date.now(), // 唯一碼
        start: startDate.getTime(),
        end: endDate.getTime()
    };

    // 加入陣列並排序
    cycles.push(newCycle);
    cycles.sort((a, b) => b.start - a.start);

    // 存入 Firebase
    await saveAllSettings();
    
    // 清空輸入並更新列表
    els.newCycleDate.value = '';
    renderCycleList();     // 更新設定頁裡的列表
    renderCycleSelector(); // 更新首頁下拉選單
    renderUI();            // 重算畫面
});

// 4. 刪除週期
window.deleteCycle = async function(id) {
    if (!confirm("確定要刪除這個週期嗎？")) return;
    
    cycles = cycles.filter(c => c.id !== id);
    await saveAllSettings();
    
    renderCycleList();
    renderCycleSelector();
    renderUI();
}

// 5. 渲染設定頁裡的「管理列表」
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
            <div>
                ${fmt(start)} ~ ${fmt(end)}
            </div>
            <button class="btn-delete-cycle" onclick="deleteCycle(${cycle.id})">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        els.cycleList.appendChild(li);
    });
}

// === 統一儲存設定 (身分 + 週期陣列) ===
async function saveAllSettings() {
    if (!currentUser) return;
    try {
        const userDocRef = doc(db, "users", currentUser.uid);
        // 取得目前選的身分
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

// === UI 輔助 ===
function updateSettingsUI() {
    // 1. Radio
    const radio = document.querySelector(`input[name="settingsIdentity"][value="${currentIdentity}"]`);
    if (radio) radio.checked = true;
    
    // 2. Cycle List
    renderCycleList();
}

function updateTransferLabel() {
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    els.transferLabel.innerText = `我是轉乘 (自動扣除 ${discount} 元)`;
}

// === 設定 Modal 互動 ===
els.settingsBtn.addEventListener('click', () => {
    updateSettingsUI();
    els.settingsModal.classList.remove('hidden');
});

window.toggleSettingsModal = function() {
    els.settingsModal.classList.toggle('hidden');
}

// 表單提交改為單純關閉並確認身分 (週期是按新增就存了)
els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveAllSettings(); // 儲存身分變更
    renderUI(); // 重算
    toggleSettingsModal();
});


// === Firestore 監聽 (不變) ===
function setupRealtimeListener(uid) {
    const q = query(collection(db, "users", uid, "trips"), orderBy("createdAt", "desc"));
    unsubscribeTrips = onSnapshot(q, (snapshot) => {
        trips = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderUI();
    });
}

// === 新增行程表單邏輯 (不變) ===
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
        if (els.tripTime) {
            els.tripTime.value = `${hh}:${mi}:${ss}`;
        }
        
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
    const timeInputVal = els.tripTime ? els.tripTime.value : '';

    if (!dateInputVal) return alert("請選擇日期");
    if (els.tripTime && !timeInputVal) return alert("請選擇時間");

    const selectedDate = new Date(`${dateInputVal}T${timeInputVal || '00:00:00'}`);
    const dateStr = dateInputVal.replace(/-/g, '/');
    const timeStr = timeInputVal || '00:00:00';

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

window.deleteTrip = async function(tripId) {
    if (!currentUser) return;
    if (confirm('刪除此紀錄？')) {
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, "trips", tripId));
        } catch (e) { console.error(e); }
    }
}

// === 核心計算邏輯 ===
function calculate() {
    let stats = { totalPaid: 0, counts: {}, sums: {} };
    Object.keys(TRANSPORT_TYPES).forEach(k => { stats.counts[k] = 0; stats.sums[k] = 0; });

    const discount = FARE_CONFIG[currentIdentity].transferDiscount;

    trips.forEach(t => {
        // [關鍵] 根據「下拉選單目前選到的週期」來過濾
        if (!currentSelectedCycle || t.createdAt < currentSelectedCycle.start || t.createdAt > currentSelectedCycle.end) {
            return;
        }

        let finalPrice = t.originalPrice;
        if (t.isTransfer) {
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
        r1_details.push({ text: `北捷 ${mrtCount} 趟，回饋 ${(mrtRate*100)}%`, amount: `-$${Math.floor(mrtCashback)}` });
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
        r1_details.push({ text: `台鐵 ${traCount} 趟，回饋 ${(traRate*100)}%`, amount: `-$${Math.floor(traCashback)}` });
    }

    // TPass 2.0...
    let r2_cashback = 0;
    let r2_details = [];
    const railCount = stats.counts.mrt + stats.counts.tra + stats.counts.tymrt + stats.counts.lrt;
    const railSum = stats.sums.mrt + stats.sums.tra + stats.sums.tymrt + stats.sums.lrt;
    if (railCount >= 11) {
        const railCashback = railSum * 0.02;
        r2_cashback += railCashback;
        r2_details.push({ text: `軌道 ${railCount} 趟，回饋 2%`, amount: `-$${Math.floor(railCashback)}` });
    }

    const busCount = stats.counts.bus + stats.counts.coach;
    const busSum = stats.sums.bus + stats.sums.coach;
    let busRate = 0;
    if (busCount > 30) busRate = 0.30;
    else if (busCount >= 11) busRate = 0.15;
    if (busRate > 0) {
        const busCashback = busSum * busRate;
        r2_cashback += busCashback;
        r2_details.push({ text: `公車客運 ${busCount} 趟，回饋 ${(busRate*100)}%`, amount: `-$${Math.floor(busCashback)}` });
    }

    return {
        totalPaid: stats.totalPaid,
        r1: { amount: r1_cashback, details: r1_details },
        r2: { amount: r2_cashback, details: r2_details },
        finalCost: stats.totalPaid - r1_cashback - r2_cashback
    };
}

function renderUI() {
    if (!currentUser) return;

    const data = calculate();
    const finalVal = Math.floor(data.finalCost);

    // 1. 更新儀表板數據
    els.finalCost.innerText = `$${finalVal}`;
    els.rawTotal.innerText = `$${Math.floor(data.totalPaid)}`;
    els.rule1Discount.innerText = `-$${Math.floor(data.r1.amount)}`;
    els.rule1Detail.innerHTML = data.r1.details.length ? data.r1.details.map(d => `<div class="rule-detail-row"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') : '';
    els.rule2Discount.innerText = `-$${Math.floor(data.r2.amount)}`;
    els.rule2Detail.innerHTML = data.r2.details.length ? data.r2.details.map(d => `<div class="rule-detail-row"><span>${d.text}</span><span>${d.amount}</span></div>`).join('') : '';
    
    // [修改] 這裡的 tripCount 建議改為顯示「本期筆數」，比較符合直覺
    // 我們稍後在迴圈內計算本期筆數，或者直接用 data.counts 加總
    // 這裡先暫時顯示總筆數，或者你可以改成顯示 filteredTrips.length
    els.tripCount.innerText = trips.length; 

    // 2. 更新狀態文字 (回本/虧本)
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

    // 3. 清空列表準備重新渲染
    els.historyList.innerHTML = '';

    // 如果完全沒有設定週期
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
    
    // 如果資料庫完全沒資料
    if (trips.length === 0) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:20px; color:#aaa;">尚無行程紀錄</li>';
        return;
    }

    let lastDateStr = null;
    const discount = FARE_CONFIG[currentIdentity].transferDiscount;
    let currentCycleTripCount = 0; // [新增] 用來統計本期有幾筆

    trips.forEach(trip => {
        // [關鍵修改] 過濾非本期資料
        // 如果行程時間 < 週期開始 OR 行程時間 > 週期結束，直接跳過不顯示
        const isOutOfCycle = currentSelectedCycle && (trip.createdAt < currentSelectedCycle.start || trip.createdAt > currentSelectedCycle.end);
        
        if (isOutOfCycle) {
            return; // 直接結束這一輪迴圈，不產生 HTML
        }

        currentCycleTripCount++; // 本期筆數 +1

        // --- 以下渲染邏輯與原本相同 ---

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

        // 金額顯示
        const displayPaid = trip.isTransfer ? Math.max(0, trip.originalPrice - discount) : trip.originalPrice;
        let priceHtml = '';
        if (trip.isTransfer) {
            priceHtml = `<div class="item-right"><span class="price-original">$${trip.originalPrice}</span><span class="price-display">$${displayPaid}</span></div>`;
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

    // [新增] 更新標題的筆數統計為「本期筆數」
    els.tripCount.innerText = currentCycleTripCount;

    // [新增] 如果過濾完後發現本期沒有資料
    if (currentCycleTripCount === 0) {
        els.historyList.innerHTML = '<li style="text-align:center; padding:30px; color:#aaa;">本週期尚無行程紀錄<br><small>點擊右下角 + 新增第一筆</small></li>';
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