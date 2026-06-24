/* ================================================================
   content.js  —  mo-order.com 自動操作スクリプト
   ================================================================ */

const SITE_BASE = "https://shonanfujisawa-international-dormitory.mo-order.com";
const STORES_PATH = "/stores";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function simulateClick(el) {
  ["mousedown", "mouseup", "click"].forEach(type =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  );
}

function setNativeValue(el, value) {
  const proto = el instanceof HTMLSelectElement
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// 要素が現れるまで最大 timeout ms ポーリング（間隔 150ms）
async function waitFor(fn, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = fn();
    if (result) return result;
    await sleep(150);
  }
  return null;
}

// ----------------------------------------------------------------
// Step1: ストア一覧にいることを確認（background.js が遷移済みのはず）
// ----------------------------------------------------------------
async function goToStores() {
  if (location.pathname.startsWith(STORES_PATH)) return;
  const link = document.querySelector(`a[href^="${STORES_PATH}"]`);
  if (link) {
    link.click();
    await waitFor(() => location.pathname.startsWith(STORES_PATH), 10000);
    return;
  }
  throw new Error("ストア一覧ページにいません");
}

// ----------------------------------------------------------------
// Step2: ストアボックスをクリック → 日時セレクトが出るまで待つ
// ----------------------------------------------------------------
async function selectStore() {
  const box = await waitFor(() => document.querySelector('.styles_masterStoreBox__TrvbV'));
  if (!box) throw new Error("ストアボックスが見つかりません");

  console.log("[Step2] ストアをクリック:", box.textContent.trim().slice(0, 30));
  simulateClick(box);

  const sel = await waitFor(() => {
    const s = document.querySelectorAll('.styles_cmSelect__9Ud3U');
    return s.length >= 1 ? s : null;
  }, 12000);
  if (!sel) throw new Error("日時選択セレクトが表示されません");
  console.log("[Step2] 日時セレクト検出:", sel.length, "個");
}

// ----------------------------------------------------------------
// Step3: 日付・時間を選択
// ----------------------------------------------------------------
async function selectDateTime(dateStr, meal) {
  const d = new Date(dateStr + "T00:00:00");
  const month = d.getMonth() + 1;
  const day   = d.getDate();
  const isBreakfast = meal === "breakfast";

  // セレクトが2つ揃うまで待つ
  const selects = await waitFor(() => {
    const s = [...document.querySelectorAll('.styles_cmSelect__9Ud3U')];
    return s.length >= 2 ? s : null;
  }, 10000) ?? [...document.querySelectorAll('.styles_cmSelect__9Ud3U')];

  if (selects.length === 0) throw new Error("日時セレクトが見つかりません");

  // --- 日付セレクト（1番目）---
  const dateSelect = selects[0];
  const dateOpts = [...dateSelect.options].filter(o => o.value && !o.disabled);
  console.log("[Step3] 日付オプション:", dateOpts.map(o => o.text));

  const dateOpt = dateOpts.find(o => {
    const t = o.text + o.value;
    return (
      t.includes(`${month}月${day}日`) ||
      t.includes(`${month}/${day}`) ||
      t.includes(`${String(month).padStart(2,"0")}/${String(day).padStart(2,"0")}`)
    );
  });
  if (!dateOpt) {
    throw new Error(`日付 ${month}/${day} がセレクトに見つかりません。オプション: ${dateOpts.map(o => o.text).join(", ")}`);
  }

  console.log("[Step3] 日付選択:", dateOpt.text);
  setNativeValue(dateSelect, dateOpt.value);

  // 日付変更後、時間セレクトが更新されるまで待つ
  const updatedSelects = await waitFor(() => {
    const s = [...document.querySelectorAll('.styles_cmSelect__9Ud3U')];
    return s.length >= 2 ? s : null;
  }, 5000) ?? [...document.querySelectorAll('.styles_cmSelect__9Ud3U')];

  // --- 時間セレクト（2番目）---
  const timeSelect = updatedSelects[1] ?? updatedSelects[0];
  const timeOpts = [...timeSelect.options].filter(o => o.value && !o.disabled);
  console.log("[Step3] 時間オプション:", timeOpts.map(o => o.text));

  // 該当時間帯を全抽出 → 時刻昇順ソート → 最も早いものを選ぶ
  const parseTime = o => {
    const m = (o.text + " " + o.value).match(/(\d{1,2}):(\d{2})/);
    return m ? { h: parseInt(m[1]), min: parseInt(m[2]), opt: o } : null;
  };
  const candidates = timeOpts
    .map(parseTime)
    .filter(t => {
      if (!t) return false;
      return isBreakfast
        ? (t.h >= 7 && t.h < 12)
        : (t.h > 18 || (t.h === 18 && t.min >= 30));
    })
    .sort((a, b) => a.h !== b.h ? a.h - b.h : a.min - b.min);

  if (candidates.length === 0) {
    throw new Error(`${isBreakfast ? "朝食" : "夕食"}に該当する時間オプションがありません。オプション: ${timeOpts.map(o => o.text).join(", ")}`);
  }
  console.log("[Step3] 時間選択:", candidates[0].opt.text);
  setNativeValue(timeSelect, candidates[0].opt.value);
}

// ----------------------------------------------------------------
// Step4: 「商品選択に進む」ボタンをクリック → menuItem 出現まで待つ
// ----------------------------------------------------------------
async function clickProceedButton() {
  const btn = await waitFor(() => {
    const all = [...document.querySelectorAll('.styles_cmButton__Jcmwz')];
    return all.find(b => b.textContent.trim().includes("商品選択に進む"));
  });
  if (!btn) throw new Error("「商品選択に進む」ボタンが見つかりません");

  console.log("[Step4] 商品選択に進む クリック");
  simulateClick(btn);

  // 次画面（menuItem）が出るまで待つ
  await waitFor(() => document.querySelector('.styles_menuItem__g9RDF'), 12000);
}

// ----------------------------------------------------------------
// Step5: 食事アイテムをクリック → カートに追加ボタン出現まで待つ
// ----------------------------------------------------------------
async function selectMealItem() {
  const item = await waitFor(() => document.querySelector('.styles_menuItem__g9RDF'));
  if (!item) throw new Error("食事アイテム（menuItem）が見つかりません");

  console.log("[Step5] 食事アイテムクリック:", item.textContent.trim().slice(0, 30));
  simulateClick(item);

  // カートに追加ボタンが出るまで待つ
  await waitFor(() => {
    const all = [...document.querySelectorAll('.styles_cmButton__Jcmwz')];
    return all.find(b =>
      b.textContent.trim().includes("カートに追加") &&
      !b.classList.contains('styles_footerBtn__E7fv0')
    );
  }, 10000);
}

// ----------------------------------------------------------------
// Step6: 「1点をカートに追加」ボタンをクリック → footerBtn 出現まで待つ
// ----------------------------------------------------------------
async function addToCart() {
  const btn = await waitFor(() => {
    const all = [...document.querySelectorAll('.styles_cmButton__Jcmwz')];
    return all.find(b =>
      b.textContent.trim().includes("カートに追加") &&
      !b.classList.contains('styles_footerBtn__E7fv0')
    );
  });
  if (!btn) throw new Error("「1点をカートに追加」ボタンが見つかりません");

  console.log("[Step6] カートに追加:", btn.textContent.trim());
  simulateClick(btn);

  // カートを確認ボタンが出るまで待つ
  await waitFor(() => document.querySelector('.styles_footerBtn__E7fv0'), 10000);
}

// ----------------------------------------------------------------
// Step7: 「カートを確認」ボタンをクリック → 購入者情報フォーム出現まで待つ
// ----------------------------------------------------------------
async function goToCart() {
  const btn = await waitFor(() => {
    const all = [...document.querySelectorAll('.styles_footerBtn__E7fv0')];
    return all.find(b => b.textContent.trim().includes("カートを確認")) ?? all[0];
  });
  if (!btn) throw new Error("「カートを確認」ボタンが見つかりません");

  console.log("[Step7] カートを確認:", btn.textContent.trim());
  simulateClick(btn);

  // 購入者情報フォームが出るまで待つ
  await waitFor(() => {
    const ws = [...document.querySelectorAll('.styles_inputWrapper__DFwnN')];
    return ws.length >= 1 ? ws : null;
  }, 12000);
}

// ----------------------------------------------------------------
// Step8: 購入者情報を入力（email / phone / room 順）
// ----------------------------------------------------------------
async function fillBuyerInfo(loginInfo) {
  const { email, phone, room } = loginInfo;

  const wrappers = await waitFor(() => {
    const ws = [...document.querySelectorAll('.styles_inputWrapper__DFwnN')];
    return ws.length >= 1 ? ws : null;
  });
  if (!wrappers) throw new Error("入力フィールドが見つかりません");

  const inputs = wrappers.map(w => w.querySelector("input")).filter(Boolean);
  console.log("[Step8] input:", inputs.length, "個");

  [email, phone, room].forEach((val, i) => {
    if (inputs[i]) setNativeValue(inputs[i], val);
  });

  // 支払いボタンが出るまで待つ
  await waitFor(() => document.querySelector('.styles_wrapper__ro2Qc'), 10000);
}

// ----------------------------------------------------------------
// Step9: 「店頭でのお支払い」を選択 → 注文確定ボタン出現まで待つ
// ----------------------------------------------------------------
async function selectPayment() {
  const btn = await waitFor(() => document.querySelector('.styles_wrapper__ro2Qc'));
  if (!btn) { console.log("[Step9] スキップ"); return; }

  console.log("[Step9] 支払い方法クリック:", btn.textContent.trim().slice(0, 30));
  simulateClick(btn);

  // 注文を確定ボタンが出るまで待つ
  await waitFor(() => {
    const all = [...document.querySelectorAll('.styles_cmButton__Jcmwz')];
    return all.find(b => b.textContent.trim().includes("注文を確定"));
  }, 10000);
}

// ----------------------------------------------------------------
// Step10: 「注文を確定」ボタンをクリック
// ----------------------------------------------------------------
async function confirmOrder() {
  const btn = await waitFor(() => {
    const all = [...document.querySelectorAll('.styles_cmButton__Jcmwz')];
    return all.find(b => b.textContent.trim().includes("注文を確定"));
  });
  if (!btn) throw new Error("「注文を確定」ボタンが見つかりません");

  console.log("[Step10] 注文を確定:", btn.textContent.trim());
  simulateClick(btn);
  await sleep(1000); // サーバー処理を待つ
}

// ================================================================
// メイン予約処理
// ================================================================

async function reserveOne(loginInfo, item) {
  const { date, meal } = item;
  console.log("[予約] 開始:", date, meal);

  const steps = [
    ["Step1(ストア一覧)",     () => goToStores()],
    ["Step2(ストア選択)",     () => selectStore()],
    ["Step3(日時選択)",       () => selectDateTime(date, meal)],
    ["Step4(商品選択に進む)", () => clickProceedButton()],
    ["Step5(食事選択)",       () => selectMealItem()],
    ["Step6(カート追加)",     () => addToCart()],
    ["Step7(カート確認)",     () => goToCart()],
    ["Step8(購入者情報)",     () => fillBuyerInfo(loginInfo)],
    ["Step9(支払い方法)",     () => selectPayment()],
    ["Step10(注文確定)",      () => confirmOrder()],
  ];

  for (const [name, fn] of steps) {
    try {
      console.log("[予約]", name, "開始");
      await fn();
      console.log("[予約]", name, "完了");
    } catch (e) {
      console.error("[予約]", name, "失敗:", e.message);
      if (name === "Step9(支払い方法)") continue;
      return { success: false, message: `${name}: ${e.message}` };
    }
  }

  console.log("[予約] 全ステップ完了!");
  return { success: true, message: "予約完了" };
}

// ================================================================
// メッセージリスナー
// ================================================================

if (!window.__reserveListenerAdded) {
  window.__reserveListenerAdded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "RESERVE_ONE") return false;
    reserveOne(message.loginInfo, message.item)
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, message: e.message }));
    return true;
  });
}
