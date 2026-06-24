/* ================================================================
   background.js  — 予約処理をバックグラウンドで実行
   ================================================================ */

const BASE_URL = "https://shonanfujisawa-international-dormitory.mo-order.com";
const STORE_URL = `${BASE_URL}/stores`;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForTabLoad(tabId) {
  await sleep(200); // ナビゲーション開始を待つ
  for (let i = 0; i < 60; i++) {
    const tab = await new Promise(resolve =>
      chrome.tabs.get(tabId, t => resolve(chrome.runtime.lastError ? null : t))
    );
    if (tab && tab.status === "complete") return;
    await sleep(200);
  }
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

// タブ読み込み完了直後に警告オーバーレイを表示
async function showOverlayOnTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.getElementById('__reserve-overlay')) return;
        const el = document.createElement('div');
        el.id = '__reserve-overlay';
        el.style.cssText = `
          position: fixed;
          top: 0; left: 0; right: 0;
          background: #dc2626;
          color: #fff;
          text-align: center;
          padding: 14px 16px;
          font-size: 15px;
          font-weight: bold;
          z-index: 2147483647;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          letter-spacing: 0.03em;
        `;
        el.textContent = '⚠️ 自動で予約処理がされます。何も操作をしないでください。';
        document.body.appendChild(el);
      },
    });
  } catch (e) {
    console.warn("[BG] オーバーレイ表示失敗:", e.message);
  }
}

async function handleReservations(loginInfo, selections) {
  const results = [];
  console.log("[BG] 予約開始", selections.length, "件");

  let tab;
  try {
    tab = await getOrOpenReservationTab();
    await waitForTabLoad(tab.id);
    await sleep(2000);
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
    try {
      await new Promise((resolve, reject) => {
        chrome.tabs.update(tab.id, { url: STORE_URL }, t => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      await waitForTabLoad(tab.id);

      // ページ読み込み完了直後に警告を表示
      await showOverlayOnTab(tab.id);

      await sleep(800); // SPA 描画待ち
    } catch (e) {
      console.warn("[BG] タブ遷移エラー（続行）:", e.message);
      await sleep(800);
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

function notify(message) {
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
