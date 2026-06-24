/* ================================================================
   background.js  — 予約処理をバックグラウンドで実行
   ================================================================ */

const BASE_URL = "https://shonanfujisawa-international-dormitory.mo-order.com";
const STORE_URL = `${BASE_URL}/stores`;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForTabLoad(tabId) {
  await sleep(500); // ナビゲーション開始を待つ
  for (let i = 0; i < 30; i++) {
    const tab = await new Promise(resolve =>
      chrome.tabs.get(tabId, t => resolve(chrome.runtime.lastError ? null : t))
    );
    if (tab && tab.status === "complete") return;
    await sleep(500);
  }
  // 15秒経っても完了しなければ続行
}

function getOrOpenReservationTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, tabs => {
      const existing = tabs.find(t => t.url && t.url.startsWith(BASE_URL));
      if (existing) {
        chrome.tabs.update(existing.id, { active: true, url: STORE_URL }, tab => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(tab || existing);
        });
      } else {
        chrome.tabs.create({ url: STORE_URL, active: true }, tab => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(tab);
        });
      }
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response || { success: false, message: "応答なし" });
      }
    });
  });
}

async function handleReservations(loginInfo, selections) {
  const results = [];
  console.log("[BG] 予約開始", selections.length, "件");

  let tab;
  try {
    console.log("[BG] タブを取得中...");
    tab = await getOrOpenReservationTab();
    console.log("[BG] タブID:", tab.id, "ロード待ち...");
    await waitForTabLoad(tab.id);
    console.log("[BG] タブロード完了、SPA描画待ち...");
    await sleep(2000);
    console.log("[BG] 準備完了");
  } catch (e) {
    console.error("[BG] タブ準備失敗:", e.message);
    await chrome.storage.local.set({
      reservationStatus: { running: false, results: [], total: selections.length, okCount: 0, error: e.message }
    });
    notify(`エラー: ${e.message}`);
    return;
  }

  for (const item of selections) {
    console.log("[BG] ストアページへ遷移:", item.date, item.meal);
    // 毎回 /stores に遷移してから content.js に指示
    // → ページリロードで確実に初期状態に戻す
    try {
      await new Promise((resolve, reject) => {
        chrome.tabs.update(tab.id, { url: STORE_URL }, t => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      await waitForTabLoad(tab.id);
      await sleep(1200); // SPA 描画待ち
    } catch (e) {
      console.warn("[BG] タブ遷移エラー（続行）:", e.message);
      await sleep(1000);
    }

    console.log("[BG] 予約送信:", item.date, item.meal);
    let result;
    try {
      result = await sendToTab(tab.id, { type: "RESERVE_ONE", loginInfo, item });
      console.log("[BG] 結果:", result);
    } catch (e) {
      console.error("[BG] 送信エラー:", e.message);
      result = { success: false, message: e.message };
    }
    results.push({ item, ...result });

    await chrome.storage.local.set({
      reservationStatus: { running: true, results, total: selections.length }
    });
  }

  const okCount = results.filter(r => r.success).length;
  console.log("[BG] 全件完了:", okCount, "/", selections.length);
  await chrome.storage.local.set({
    reservationStatus: { running: false, results, total: selections.length, okCount }
  });

  notify(`予約完了: ${okCount}/${selections.length} 件成功`);
}

function notify(message, okCount, total) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: "食堂まとめ予約",
    message,
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RESERVATIONS") {
    handleReservations(message.loginInfo, message.selections);
    sendResponse({ ok: true });
    return false;
  }
});
