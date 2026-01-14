// diagnose_api.js - 診斷 API 回傳結構與參數
const fs = require('fs');

const BASE_URL = "https://web.metro.taipei/apis/metrostationapi";

// ✅ 使用您提供的有效 Cookie 與 Header
const HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "cookie": "_gid=GA1.2.1834002026.1768382136; perf_dv6Tr4n=1; _ga_T9MGBB1B47=GS2.1.s1768393329$o5$g1$t1768393439$j59$l0$h0; TS01232bc6=0110b39faeec94f98b300829ffe551b5f9b87732d5ae81e5a1f8061c64b6759bd2fd17c56fe07a373ae1a54440e920d68ab2fe317e; _ga=GA1.1.1168931170.1767085860; _ga_3WPBMDDS7G=GS2.2.s1768393330$o1$g1$t1768394930$j60$l0$h0; _ga_CQZZ7GV317=GS2.1.s1768393330$o1$g1$t1768395162$j60$l0$h0; __cf_bm=HG4SIv9a9V2QRsT3zaF0J4gM8O3GrTSpz6RTii6CKrQ-1768395162.7267032-1.0.1.1-JDdglN.zk6BosLtLwiH9slbkwdg8ZLxpZCDUnMFcbxoGqM8MKsOnXtjwGwsVxREj.VMkukoFLTKCgNXqezcRQsZRpJHc_qvtms8YKlYpu8nsq5YC9uwITwTG0hAWPqJu",
    "Referer": "https://web.metro.taipei/pages/tw/ticketroutetimequery"
};

async function main() {
    console.log("🔍 開始 API 結構診斷...");

    // === 測試 1: 確保 Cookie 有效 (使用您抓到的 StartSID/EndSID 格式) ===
    console.log("\n🧪 [測試 1] 檢查 Point-to-Point API (動物園 -> 板橋)...");
    try {
        const res = await fetch(`${BASE_URL}/ticketinfo`, {
            method: 'POST',
            headers: HEADERS,
            // 這是您剛剛抓到的正確 Payload 格式
            body: JSON.stringify({ StartSID: "019", EndSID: "082", Lang: "tw" }) 
        });
        const text = await res.text();
        console.log("📄 回傳內容 (前 200 字):", text.substring(0, 200));
        
        try {
            const json = JSON.parse(text);
            const data = Array.isArray(json) ? json[0] : json;
            console.log("✅ Cookie 有效！取得欄位結構:", Object.keys(data));
        } catch(e) {
            console.log("⚠️ 無法解析 JSON");
        }

    } catch (e) {
        console.log("❌ 連線失敗:", e.message);
    }

    // === 測試 2: 尋找 Bulk API 正確參數 ===
    console.log("\n🧪 [測試 2] 暴力破解 Bulk API 參數 (單站查全部)...");
    
    const candidates = [
        { name: "SID", payload: { SID: "019", Lang: "tw" } },
        { name: "StationID", payload: { StationID: "019", Lang: "tw" } },
        { name: "StartSID", payload: { StartSID: "019", Lang: "tw" } }, // 很有可能是這個！
        { name: "StartStationID", payload: { StartStationID: "019", Lang: "tw" } }
    ];

    for (const test of candidates) {
        process.stdout.write(`   嘗試參數 [${test.name}]... `);
        try {
            const res = await fetch(`${BASE_URL}/ticketroutetimesinglestationinfo`, {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify(test.payload)
            });
            const text = await res.text();
            
            if (text.includes("缺少參數") || text.includes("Error") || text.length < 50) {
                console.log("❌ 失敗");
            } else {
                console.log("✅ 成功！命中！");
                console.log("📄 回傳範例:", text.substring(0, 100));
                return; // 找到就結束
            }
        } catch (e) {
            console.log("❌ 錯誤");
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.log("\n😩 Bulk API 全滅。可能需要改用 Point-to-Point 慢慢抓。");
}

main();