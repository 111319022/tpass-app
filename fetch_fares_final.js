// fetch_fares_final_v2.js - 完美抓取版
const fs = require('fs');

// 北捷 API 基礎網址
const BASE_URL = "https://web.metro.taipei/apis/metrostationapi";

// ✅ 使用您確認有效的 Header 與 Cookie
const HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "cookie": "_gid=GA1.2.1834002026.1768382136; perf_dv6Tr4n=1; _ga_T9MGBB1B47=GS2.1.s1768393329$o5$g1$t1768393439$j59$l0$h0; TS01232bc6=0110b39faeec94f98b300829ffe551b5f9b87732d5ae81e5a1f8061c64b6759bd2fd17c56fe07a373ae1a54440e920d68ab2fe317e; _ga=GA1.1.1168931170.1767085860; _ga_3WPBMDDS7G=GS2.2.s1768393330$o1$g1$t1768394930$j60$l0$h0; _ga_CQZZ7GV317=GS2.1.s1768393330$o1$g1$t1768395162$j60$l0$h0; __cf_bm=HG4SIv9a9V2QRsT3zaF0J4gM8O3GrTSpz6RTii6CKrQ-1768395162.7267032-1.0.1.1-JDdglN.zk6BosLtLwiH9slbkwdg8ZLxpZCDUnMFcbxoGqM8MKsOnXtjwGwsVxREj.VMkukoFLTKCgNXqezcRQsZRpJHc_qvtms8YKlYpu8nsq5YC9uwITwTG0hAWPqJu",
    "Referer": "https://web.metro.taipei/pages/tw/ticketroutetimequery"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log("🚀 啟動最終抓取程序 (參數 StartSID)...");

    try {
        // === 步驟 1: 取得車站列表 ===
        console.log("📡 正在取得車站清單...");
        const menuRes = await fetch(`${BASE_URL}/menuline`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ Lang: 'tw' })
        });

        if(!menuRes.ok) throw new Error(`Menu Request Failed: ${menuRes.status}`);
        
        const rawData = await menuRes.json();
        const linesData = Array.isArray(rawData) ? rawData : (rawData.d || rawData.data || rawData);

        const stationMap = new Map();
        if (Array.isArray(linesData)) {
            linesData.forEach(line => {
                const stations = line.LineStations || line.Station;
                if (stations && Array.isArray(stations)) {
                    stations.forEach(st => {
                        const name = st.StationName;
                        const id = st.SID || st.StationID;
                        if (name && id) stationMap.set(name, id);
                    });
                }
            });
        }

        const stationCount = stationMap.size;
        console.log(`✅ 成功取得 ${stationCount} 個車站。`);

        if (stationCount === 0) return console.error("❌ 找不到車站資料 (Cookie 可能失效)。");

        // === 步驟 2: 抓取所有票價 ===
        const fareDB = {};
        const stations = Array.from(stationMap.entries());
        let progress = 0;

        console.log("🏁 開始下載票價矩陣...");

        for (const [startName, startID] of stations) {
            progress++;
            process.stdout.write(`\r⏳ 進度: ${Math.round((progress/stationCount)*100)}% (${startName})     `);

            try {
                // ✅ 使用我們驗證過的正確參數: StartSID
                const res = await fetch(`${BASE_URL}/ticketroutetimesinglestationinfo`, {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ StartSID: startID, Lang: 'tw' })
                });
                
                const text = await res.text();
                let list = [];
                try {
                    const json = JSON.parse(text);
                    list = Array.isArray(json) ? json : (json.d || []);
                } catch(e) {}

                // 如果這站沒資料，跳過
                if (list.length === 0) continue;
                
                list.forEach(item => {
                    const endName = item.EndStationName || item.StationName; // 這裡可能要根據 Bulk API 回傳調整
                    
                    // ✅ 根據您提供的 Point-to-Point 測試結果，票價欄位叫 "DeductedFare"
                    // 如果 Bulk API 回傳的欄位不同，這裡有做備援
                    let price = item.DeductedFare || item.TicketPrice || item.Price; 
                    
                    // 如果是字串轉成數字
                    price = parseInt(price, 10);

                    if (endName && price > 0 && startName !== endName) {
                        const key = [startName, endName].sort().join('-');
                        fareDB[key] = price;
                    }
                });

            } catch (e) {
                // 忽略錯誤繼續跑
            }
            await sleep(100); // 休息一下
        }

        // === 步驟 3: 寫入檔案 ===
        const dbSize = Object.keys(fareDB).length;
        console.log(`\n\n✅ 下載完成！共取得 ${dbSize} 筆票價組合。`);

        if (dbSize === 0) {
            console.error("⚠️ 警告：資料庫是空的！可能是欄位名稱 (DeductedFare) 在 Bulk API 中不一樣。");
            return;
        }

        const fileContent = `// [自動生成] 北捷官方票價表
// 更新時間: ${new Date().toLocaleString()}
// 資料來源: 臺北捷運官方 API

const FARE_DB = ${JSON.stringify(fareDB, null, 0)};

/**
 * 查詢票價函式 (自動處理 A->B 或 B->A)
 * @param {string} stationA 站點A
 * @param {string} stationB 站點B
 * @returns {number|null} 票價，如果找不到回傳 null
 */
export function getOfficialFare(stationA, stationB) {
    if (!stationA || !stationB) return null;
    if (stationA === stationB) return 0;

    const key = [stationA, stationB].sort().join('-');
    return FARE_DB[key] || null;
}
`;
        
        const dir = './js/data';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        fs.writeFileSync('./js/data/fares.js', fileContent, 'utf8');
        console.log(`🎉 檔案已成功寫入至: ./js/data/fares.js`);

    } catch (err) {
        console.error("\n❌ 發生錯誤:", err);
    }
}

main();