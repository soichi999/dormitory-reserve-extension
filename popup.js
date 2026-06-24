/* ================================================================
   popup.js  —  食堂まとめ予約 Chrome拡張
   ================================================================ */

const BASE_URL = "https://shonanfujisawa-international-dormitory.mo-order.com";
const STORE_URL = `${BASE_URL}/stores`;
const WEEKDAY = ["日","月","火","水","木","金","土"];
const BREAKFAST_PRICE = 300;
const DINNER_PRICE    = 500;

// --- 締切計算 ---
function canReserveBreakfast(d) {
  // 前日21:00まで
  const deadline = new Date(d);
  deadline.setDate(deadline.getDate() - 1);
  deadline.setHours(21, 0, 0, 0);
  return Date.now() < deadline.getTime();
}
function canReserveDinner(d) {
  // 当日09:00まで
  const deadline = new Date(d);
  deadline.setHours(9, 0, 0, 0);
  return Date.now() < deadline.getTime();
}

// --- 予約可能日を返す ---
// 月〜水: 明日〜今週金曜（来週メニュー未確定）
// 木〜日: 明日〜来週金曜（木曜ごろに来週分が解禁）
function getReservableDays() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=日 1=月 ... 6=土

  let endDate;
  if (dow >= 1 && dow <= 3) {
    // 月・火・水 → 今週金曜まで
    endDate = new Date(today);
    endDate.setDate(today.getDate() + (5 - dow));
  } else {
    // 木・金・土・日 → 来週金曜まで
    const toNextMon = dow === 0 ? 1 : dow === 6 ? 2 : 8 - dow;
    endDate = new Date(today);
    endDate.setDate(today.getDate() + toNextMon + 4);
  }

  const days = [];
  const d = new Date(today);
  d.setDate(d.getDate() + 1); // 明日から
  while (d <= endDate) {
    if (d.getDay() >= 1 && d.getDay() <= 5) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// --- グリッド生成 ---
function buildGrid() {
  const tbody = document.getElementById("grid-body");
  tbody.innerHTML = "";
  const days = getReservableDays();

  days.forEach(d => {
    const canB = canReserveBreakfast(d);
    const canD = canReserveDinner(d);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const label = `${d.getMonth()+1}/${d.getDate()}（${WEEKDAY[d.getDay()]}）`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-date">${label}</td>
      <td>
        ${canB
          ? `<input type="checkbox" class="meal-check" data-date="${key}" data-meal="breakfast">`
          : `<span class="deadline-label">締切済</span>`}
      </td>
      <td>
        ${canD
          ? `<input type="checkbox" class="meal-check" data-date="${key}" data-meal="dinner">`
          : `<span class="deadline-label">締切済</span>`}
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.addEventListener("change", updateTotal);
}

// --- 合計表示 ---
function updateTotal() {
  const checks = [...document.querySelectorAll(".meal-check:checked")];
  const nb = checks.filter(c => c.dataset.meal === "breakfast").length;
  const nd = checks.filter(c => c.dataset.meal === "dinner").length;
  const total = nb + nd;
  const cost  = nb * BREAKFAST_PRICE + nd * DINNER_PRICE;

  const btn = document.getElementById("reserve-btn");
  if (total === 0) {
    document.getElementById("total-text").textContent = "食事を選択してください";
    btn.disabled = true;
  } else {
    document.getElementById("total-text").textContent =
      `朝食 ${nb}回 ＋ 夕食 ${nd}回 ＝ ${total}件（合計 ¥${cost.toLocaleString()}）`;
    btn.disabled = false;
  }
}

// --- 認証情報の保存・読み込み ---
function saveCredentials() {
  const data = {
    email:    document.getElementById("login-email").value,
    phone:    document.getElementById("login-phone").value,
    room:     document.getElementById("login-room").value,
    password: document.getElementById("password").value,
  };
  chrome.storage.local.set({ credentials: data });
}

function loadCredentials() {
  chrome.storage.local.get("credentials", ({ credentials }) => {
    if (!credentials) return;
    document.getElementById("login-email").value = credentials.email    || "";
    document.getElementById("login-phone").value = credentials.phone    || "";
    document.getElementById("login-room").value  = credentials.room     || "";
    document.getElementById("password").value    = credentials.password || "";
    document.getElementById("remember").checked  = true;
  });
}

// --- 予約を収集（日付昇順・同日は朝食→夕食） ---
function getSelections() {
  return [...document.querySelectorAll(".meal-check:checked")]
    .map(c => ({ date: c.dataset.date, meal: c.dataset.meal }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.meal === "breakfast" ? -1 : 1;
    });
}

// --- ログイン情報を収集 ---
function getLoginInfo() {
  return {
    email:    document.getElementById("login-email").value.trim(),
    phone:    document.getElementById("login-phone").value.trim(),
    room:     document.getElementById("login-room").value.trim(),
    password: document.getElementById("password").value,
  };
}

// --- 進捗UI ---
let progressSection, progressBar, resultList;

function initProgress(total) {
  progressSection = document.getElementById("progress-section");
  progressBar     = document.getElementById("progress-bar");
  resultList      = document.getElementById("result-list");
  resultList.innerHTML = "";
  progressBar.style.width = "0%";
  progressSection.style.display = "block";
  document.getElementById("reserve-btn").disabled = true;
  document.getElementById("progress-counter").textContent = "0";
  document.getElementById("progress-total").textContent = String(total);
  document.getElementById("progress-label").textContent = `予約中... 0 / ${total} 件完了`;
}

function addResult(index, total, item, success, message) {
  const li = document.createElement("li");
  const mealLabel = item.meal === "breakfast" ? "朝食" : "夕食";
  const d = new Date(item.date + "T00:00:00");
  const dateLabel = `${d.getMonth()+1}/${d.getDate()}（${WEEKDAY[d.getDay()]}）${mealLabel}`;

  if (success) {
    li.className = "ok";
    li.innerHTML = `<span>✅</span><span>${dateLabel} 予約完了</span>`;
  } else {
    li.className = "ng";
    li.innerHTML = `<span>❌</span><span>${dateLabel} 失敗: ${message}</span>`;
  }

  resultList.appendChild(li);
  progressBar.style.width = `${(index / total) * 100}%`;
  document.getElementById("progress-counter").textContent = String(index);
  document.getElementById("progress-label").textContent = `予約中... ${index} / ${total} 件完了`;
}

function finishProgress(total, okCount) {
  progressBar.style.width = "100%";
  document.getElementById("progress-label").textContent = `完了: ${okCount} / ${total} 件成功`;
  document.getElementById("reserve-btn").disabled = false;
  document.getElementById("reserve-btn").textContent = "予約する";
}

// --- 進捗ポーリング ---
let _pollingTimer = null;
let _shownCount   = 0;

function startProgressPolling(total) {
  clearInterval(_pollingTimer);
  _shownCount = 0;

  _pollingTimer = setInterval(() => {
    chrome.storage.local.get("reservationStatus", ({ reservationStatus: s }) => {
      if (!s) return;

      // 新しく完了した分だけ追加
      for (let i = _shownCount; i < s.results.length; i++) {
        const r = s.results[i];
        addResult(i + 1, total, r.item, r.success, r.message || "");
      }
      _shownCount = s.results.length;

      if (!s.running) {
        clearInterval(_pollingTimer);
        finishProgress(total, s.okCount ?? 0);
        chrome.storage.local.remove("reservationStatus");
      }
    });
  }, 800);
}

// --- 予約実行メインロジック ---
async function runReservations() {
  const loginInfo  = getLoginInfo();
  const selections = getSelections();

  if (!loginInfo.email) {
    alert("メールアドレスを入力してください");
    return;
  }
  if (!loginInfo.phone) {
    alert("電話番号を入力してください");
    return;
  }
  if (!loginInfo.room) {
    alert("号室＋氏名を入力してください");
    return;
  }
  if (!loginInfo.password) {
    alert("パスワードを入力してください");
    return;
  }
  if (selections.length === 0) return;

  if (document.getElementById("remember").checked) {
    saveCredentials();
  }

  // バックグラウンドに処理を委譲（ポップアップが閉じても継続）
  chrome.runtime.sendMessage({ type: "START_RESERVATIONS", loginInfo, selections });

  initProgress(selections.length);
  startProgressPolling(selections.length);

  const btn = document.getElementById("reserve-btn");
  btn.disabled = true;
  btn.textContent = "予約中...";
}

// ================================================================
// 初期化
// ================================================================
document.addEventListener("DOMContentLoaded", () => {
  buildGrid();
  loadCredentials();

  document.getElementById("reserve-btn").addEventListener("click", runReservations);

  // 予約が進行中 or 完了済みであれば状態を復元
  chrome.storage.local.get("reservationStatus", ({ reservationStatus: s }) => {
    if (!s || !s.total) return;
    initProgress(s.total);
    s.results.forEach((r, i) => addResult(i + 1, s.total, r.item, r.success, r.message || ""));
    if (s.running) {
      // まだ実行中 → ポーリング再開
      document.getElementById("reserve-btn").textContent = "予約中...";
      startProgressPolling(s.total);
    } else {
      finishProgress(s.total, s.okCount ?? 0);
      chrome.storage.local.remove("reservationStatus");
    }
  });
});
