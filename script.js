const MAX_TOKENS = 40;
const MAX_NEW_TOKEN_DISPLAY_TOKENS = 400;
const NEW_TOKEN_PAGE_SIZE = 40;
const MAX_MIGRATED_DISPLAY_TOKENS = 100;
const MAX_MIGRATED_LIVE_TOKENS = 10;
const MIGRATED_PAGE_SIZE = 100;
const MIGRATED_EXPANDED_REFRESH_TTL_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;
const HOMEPAGE_FEED_FALLBACK_REFRESH_MS = 30 * 1000;
const HOMEPAGE_TRENDING_REFRESH_MS = 5 * 60 * 1000;
const BSC_CHAIN_ID_HEX = "0x38";
const activeHomepageChain = window.location.pathname === "/base" || window.location.pathname.startsWith("/base/")
  ? "base"
  : "bsc";
const WALLET_SESSION_KEY = "spartaWalletSession";
const SELECTED_TOKEN_KEY = "spartaSelectedToken";
const THEME_KEY = "spartaTheme";
const BSC_AI_PICKS_STORAGE_KEY = "spartaBscAiPicksCache";
const TRENDING_TOKENS_STORAGE_KEY_PREFIX = "spartaTrendingTokensCache:";
const NEW_TOKENS_STORAGE_KEY_PREFIX = "spartaNewTokensCache:";

const deployFeed = document.getElementById("deploy-feed");
const deployStatus = document.getElementById("deploy-status");
const aiPicksFeed = document.getElementById("ai-picks-feed");
const aiPicksStatus = document.getElementById("ai-picks-status");
const migratedAiPicksFeed = document.getElementById("migrated-ai-picks-feed");
const migratedAiPicksStatus = document.getElementById("migrated-ai-picks-status");
const settingsTrigger = document.getElementById("settings-trigger");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleLabel = document.getElementById("theme-toggle-label");
const alertAiPicksToggle = document.getElementById("alert-ai-picks");
const alertMigratedPicksToggle = document.getElementById("alert-migrated-picks");
const highFeeWarnModal = document.getElementById("high-fee-warn-modal");
const highFeeWarnBackdrop = document.getElementById("high-fee-warn-backdrop");
const highFeeWarnCopy = document.getElementById("high-fee-warn-copy");
const highFeeWarnSkip = document.getElementById("high-fee-warn-skip");
const highFeeWarnCancel = document.getElementById("high-fee-warn-cancel");
const highFeeWarnAccept = document.getElementById("high-fee-warn-accept");
const buyConfirmModal = document.getElementById("buy-confirm-modal");
const buyConfirmBackdrop = document.getElementById("buy-confirm-backdrop");
const buyConfirmCopy = document.getElementById("buy-confirm-copy");
const buyConfirmSkip = document.getElementById("buy-confirm-skip");
const buyConfirmCancel = document.getElementById("buy-confirm-cancel");
const buyConfirmAccept = document.getElementById("buy-confirm-accept");
const buyResultModal = document.getElementById("buy-result-modal");
const buyResultBackdrop = document.getElementById("buy-result-backdrop");
const buyResultKicker = document.getElementById("buy-result-kicker");
const buyResultTitle = document.getElementById("buy-result-title");
const buyResultCopy = document.getElementById("buy-result-copy");
const buyResultLinks = document.getElementById("buy-result-links");
const buyResultClose = document.getElementById("buy-result-close");
const mobileRowTabs = Array.from(document.querySelectorAll("[data-mobile-row-tab]"));
const mobileRowPanels = Array.from(document.querySelectorAll("[data-mobile-row-panel]"));
const BUY_CONFIRM_SKIP_KEY = "spartaSkipBuyConfirm";
const HIGH_FEE_WARN_SKIP_KEY = "spartaSkipHighFeeWarn";
const ALERT_PREFS_KEY = "spartaAlertPrefs";
const DEFAULT_BUY_ONE_AMOUNT = "0.10";
const BUY_RESULT_MAX_POLL_ATTEMPTS = 200;
const TRADE_SETTLEMENT_SIGNAL_KEY = "spartaTradeSettlementAt";
const AI_ALERT_POLL_INTERVAL_MS = 4000;
const BASE_AI_PICKS_STORAGE_KEY = "spartaBaseAiPicksCache";

function terminalHomeT(key, fallback, values = {}) {
  const translate = typeof window !== "undefined" && typeof window.t === "function" ? window.t : null;
  if (translate) {
    const translated = translate(key, values);
    if (translated && translated !== key) return translated;
  }
  return fallback;
}

function terminalHomeStatus(key, count, fallbackPrefix) {
  return terminalHomeT(key, `${fallbackPrefix}: ${count}`, { count });
}



let pendingBuyToken = null;
let aiPicksAlertInitialized = false;
const seenAiPickAddresses = new Set();
let alertToastTimer = null;
let alertAudioUnlocked = false;
let currentBuyOneAmount = DEFAULT_BUY_ONE_AMOUNT;
let migratedLazyObserver = null;
let migratedTokens24h = [];
let migratedLoadedCount = MAX_MIGRATED_LIVE_TOKENS;
let migratedCount24h = 0;
let migratedTotalCount = MAX_MIGRATED_LIVE_TOKENS;
let migratedLoadingMore = false;
let migratedExpandedRefreshAt = 0;
let migratedExpandedRefreshInFlight = false;
let homepageBuyInFlight = false;
let buyResultPollToken = 0;
let aiAlertsPollTimer = null;
let lastDeployTokens = [];
let deployLazyObserver = null;
let deployLoadedCount = MAX_TOKENS;
let deployTotalCount = MAX_TOKENS;
let deployLoadingMore = false;
const tokenImageMemory = new Map();
const aiBuyResultQueue = [];

function getHomepageNewTokensStorageKey() {
  return `${NEW_TOKENS_STORAGE_KEY_PREFIX}${activeHomepageChain === "base" ? "base" : "bsc"}`;
}

function writeStoredHomepageNewTokens(tokens) {
  try {
    window.localStorage.setItem(getHomepageNewTokensStorageKey(), JSON.stringify({
      tokens: Array.isArray(tokens) ? tokens : [],
      cachedAt: Date.now()
    }));
  } catch {
  }
}
function getHomepageTrendingStorageKey() {
  return `${TRENDING_TOKENS_STORAGE_KEY_PREFIX}${activeHomepageChain === "base" ? "base" : "bsc"}`;
}

function readStoredHomepageTrendingTokens() {
  try {
    const raw = window.localStorage.getItem(getHomepageTrendingStorageKey());
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.tokens) ? parsed.tokens : [];
  } catch {
    return [];
  }
}

function writeStoredHomepageTrendingTokens(tokens) {
  try {
    window.localStorage.setItem(getHomepageTrendingStorageKey(), JSON.stringify({
      tokens: Array.isArray(tokens) ? tokens : [],
      cachedAt: Date.now()
    }));
  } catch {
  }
}

function sortTokensYoungestFirst(tokens, { ageField = "launchTime" } = {}) {
  return (Array.isArray(tokens) ? tokens.slice() : []).sort((left, right) => {
    const leftTime = Number(left?.[ageField] || 0);
    const rightTime = Number(right?.[ageField] || 0);
    const leftValid = Number.isFinite(leftTime) && leftTime > 0;
    const rightValid = Number.isFinite(rightTime) && rightTime > 0;
    if (leftValid && rightValid) {
      return rightTime - leftTime;
    }
    if (leftValid) {
      return -1;
    }
    if (rightValid) {
      return 1;
    }
    return 0;
  });
}

function mergeHomepageTrendingTokenLists(...lists) {
  const merged = new Map();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((token) => {
      const address = String(token?.address || "").trim().toLowerCase();
      if (!address || merged.has(address)) {
        return;
      }
      merged.set(address, { ...token, address });
    });
  });
  return sortTokensYoungestFirst(Array.from(merged.values()));
}
function readStoredAiPicks() {
  try {
    const storageKey = activeHomepageChain === "base"
      ? BASE_AI_PICKS_STORAGE_KEY
      : BSC_AI_PICKS_STORAGE_KEY;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.tokens) ? parsed.tokens : [];
  } catch {
    return [];
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBuyButtonAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_BUY_ONE_AMOUNT;
  }

  return numeric.toFixed(2).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
}

function formatHomepageFeedStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized || normalized.startsWith("live")) {
    return terminalHomeT("terminalHome.status.liveUpper", "LIVE");
  }
  if (normalized === "backfilling") {
    return terminalHomeT("terminalHome.status.backfilling", "BACKFILLING");
  }
  if (normalized === "waiting") {
    return terminalHomeT("terminalHome.status.waiting", "WAITING");
  }
  if (normalized === "retrying") {
    return terminalHomeT("terminalHome.status.retryingUpper", "RETRYING");
  }
  return String(status || terminalHomeT("terminalHome.status.liveUpper", "LIVE")).trim().toUpperCase();
}

function walletBadge(address) {
  const tail = address.slice(-5);
  return `● ${tail}`;
}

function proxiedImageUrl(imageUrl) {
  return `/api/token-image?url=${encodeURIComponent(imageUrl)}`;
}

function readSkipBuyConfirm() {
  return window.localStorage.getItem(BUY_CONFIRM_SKIP_KEY) === "true";
}

function saveSkipBuyConfirm(enabled) {
  window.localStorage.setItem(BUY_CONFIRM_SKIP_KEY, enabled ? "true" : "false");
}

function readSkipHighFeeWarn() {
  return window.localStorage.getItem(HIGH_FEE_WARN_SKIP_KEY) === "true";
}

function saveSkipHighFeeWarn(enabled) {
  window.localStorage.setItem(HIGH_FEE_WARN_SKIP_KEY, enabled ? "true" : "false");
}

function readHomepageGasSettings() {
  try {
    const session = JSON.parse(window.localStorage.getItem(WALLET_SESSION_KEY) || "null");
    if (!session?.address) {
      return { buy_gas: 0 };
    }
    const walletKey = `${session.walletType}:${session.address.toLowerCase()}:bsc`;
    const allSettings = JSON.parse(window.localStorage.getItem("spartaSettingsDraft") || "{}");
    const s = allSettings[walletKey] || {};
    return { buy_gas: Number(s.buy_gas) || 0 };
  } catch {
    return { buy_gas: 0 };
  }
}

function isHomepageHighFee() {
  return readHomepageGasSettings().buy_gas > 150;
}

function openHighFeeWarnModal(token) {
  pendingBuyToken = token;
  if (highFeeWarnCopy) {
    const { buy_gas } = readHomepageGasSettings();
    highFeeWarnCopy.textContent = terminalHomeT("terminalHome.highFee.bscCopy", `Your Buy Gwei is set to ${buy_gas} Gwei, which exceeds the 150 Gwei warning threshold. Are you sure you want to proceed?`, { amount: buy_gas });
  }
  if (highFeeWarnSkip) {
    highFeeWarnSkip.checked = readSkipHighFeeWarn();
  }
  if (highFeeWarnModal) {
    highFeeWarnModal.hidden = false;
  }
}

function closeHighFeeWarnModal() {
  if (highFeeWarnModal) {
    highFeeWarnModal.hidden = true;
  }
}

function openBuyConfirmModal(token) {
  pendingBuyToken = token;
  if (buyConfirmCopy) {
    const tokenName = token?.shortName || token?.symbol || token?.name || "this token";
    buyConfirmCopy.textContent = terminalHomeT("terminalHome.buy.namedCopy", `Are you sure that you want to buy "${tokenName}"? Click Yes to proceed or No to cancel.`, { token: tokenName });
  }
  if (buyConfirmSkip) {
    buyConfirmSkip.checked = readSkipBuyConfirm();
  }
  if (buyConfirmModal) {
    buyConfirmModal.hidden = false;
  }
}

function closeBuyConfirmModal() {
  pendingBuyToken = null;
  if (buyConfirmModal) {
    buyConfirmModal.hidden = true;
  }
}

function closeBuyResultModal() {
  buyResultPollToken += 1;
  if (buyResultModal) {
    buyResultModal.hidden = true;
  }
  if (buyResultTitle) {
    buyResultTitle.textContent = terminalHomeT("terminalHome.result.transactionSent", "Transaction sent");
  }
  if (buyResultKicker) {
    buyResultKicker.textContent = terminalHomeT("terminalHome.result.submitted", "Buy Submitted");
  }
  if (buyResultCopy) {
    buyResultCopy.textContent = "";
  }
  if (buyResultLinks) {
    buyResultLinks.innerHTML = "";
  }
  drainAiBuyResultQueue();
}

function renderBuyResultLinks(entries) {
  if (!buyResultLinks) {
    return;
  }

  buyResultLinks.innerHTML = entries.map((entry, index) => {
    const status = String(entry?.status || "pending").toLowerCase();
    const isConfirmed = status === "confirmed";
    const isFailed = status === "failed";
    const label = entries.length > 1 ? terminalHomeT("terminalHome.result.walletLabel", `Wallet ${index + 1}`, { number: index + 1 }) : terminalHomeT("terminalHome.result.transaction", "Transaction");
    const statusLabel = isConfirmed ? terminalHomeT("terminalHome.result.status.confirmed", "Confirmed") : (isFailed ? terminalHomeT("terminalHome.result.status.failed", "Failed") : terminalHomeT("terminalHome.result.status.pending", "Pending"));
    const statusClass = isConfirmed ? "is-confirmed" : (isFailed ? "is-failed" : "is-pending");
    const statusIcon = isConfirmed ? "✓" : (isFailed ? "!" : "...");
    return `
      <a class="buy-result-link" href="https://bscscan.com/tx/${encodeURIComponent(entry.hash)}" target="_blank" rel="noreferrer noopener">
        <span class="buy-result-link-row">
          <span class="buy-result-link-label">${escapeHtml(label)}</span>
          <span class="buy-result-status ${statusClass}">
            <span class="buy-result-status-icon" aria-hidden="true">${escapeHtml(statusIcon)}</span>
            <span>${escapeHtml(statusLabel)}</span>
          </span>
        </span>
        <span class="buy-result-link-hash">${escapeHtml(entry.hash)}</span>
      </a>
    `;
  }).join("");
}

function logHomepageBuyResult(message, details = null) {
  if (details) {
    console.info(`[homepage-buy] ${message}`, details);
    return;
  }
  console.info(`[homepage-buy] ${message}`);
}

function updateBuyResultSummary(entries, mode) {
  const statuses = entries.map((entry) => String(entry?.status || "pending").toLowerCase());
  const confirmedCount = statuses.filter((status) => status === "confirmed").length;
  const failedCount = statuses.filter((status) => status === "failed").length;
  const total = entries.length;

  if (failedCount > 0 && confirmedCount === 0) {
    if (buyResultKicker) {
      buyResultKicker.textContent = terminalHomeT("terminalHome.result.buyFailed", "Buy Failed");
    }
    buyResultTitle.textContent = terminalHomeT("terminalHome.result.transactionFailed", "Transaction failed");
    buyResultCopy.textContent = total > 1
      ? terminalHomeT("terminalHome.result.bscBundleFailed", "One or more bundled transactions failed. Open BscScan to inspect the receipts.")
      : terminalHomeT("terminalHome.result.bscSingleFailed", "This transaction failed. Open BscScan to inspect the receipt.");
    return;
  }

  if (confirmedCount === total && total > 0) {
    if (buyResultKicker) {
      buyResultKicker.textContent = terminalHomeT("terminalHome.result.buyConfirmed", "Buy Confirmed");
    }
    buyResultTitle.textContent = mode === "bundle" ? terminalHomeT("terminalHome.result.bundleConfirmed", "Bundle confirmed") : terminalHomeT("terminalHome.result.buyConfirmedTitle", "Buy confirmed");
    buyResultCopy.textContent = total > 1
      ? terminalHomeT("terminalHome.result.bnbBundleConfirmed", "All bundled buy transactions are confirmed on BNB Chain.")
      : terminalHomeT("terminalHome.result.bnbSingleConfirmed", "Your buy transaction is confirmed on BNB Chain.");
    return;
  }

  if (failedCount > 0) {
    if (buyResultKicker) {
      buyResultKicker.textContent = terminalHomeT("terminalHome.result.buyPartial", "Buy Partial");
    }
    buyResultTitle.textContent = terminalHomeT("terminalHome.result.bundlePartiallyFailed", "Bundle partially failed");
    buyResultCopy.textContent = terminalHomeT("terminalHome.result.partialFailed", `${failedCount}/${total} transaction${total === 1 ? "" : "s"} failed. The rest are still being checked.`, { failed: failedCount, total });
    return;
  }

  if (confirmedCount > 0) {
    if (buyResultKicker) {
      buyResultKicker.textContent = terminalHomeT("terminalHome.result.buyConfirming", "Buy Confirming");
    }
    buyResultTitle.textContent = mode === "bundle" ? terminalHomeT("terminalHome.result.confirmingBundle", "Confirming bundle") : terminalHomeT("terminalHome.result.confirmingBuy", "Confirming buy");
    buyResultCopy.textContent = terminalHomeT("terminalHome.result.confirmedSoFar", `${confirmedCount}/${total} transaction${total === 1 ? "" : "s"} confirmed so far.`, { confirmed: confirmedCount, total });
    return;
  }

  if (buyResultKicker) {
    buyResultKicker.textContent = terminalHomeT("terminalHome.result.submitted", "Buy Submitted");
  }
  buyResultTitle.textContent = mode === "bundle" ? terminalHomeT("terminalHome.result.bundleSubmitted", "Bundle submitted") : terminalHomeT("terminalHome.result.transactionSent", "Transaction sent");
  buyResultCopy.textContent = mode === "bundle"
    ? terminalHomeT("terminalHome.result.privateBuilderSubmitted", "Your bundled buy was submitted through the private builder. Waiting for confirmation...")
    : terminalHomeT("terminalHome.result.privateBuySubmitted", "Your private buy transaction was submitted. Waiting for confirmation...");
}

async function fetchHomepageBuyTxStatus(hash) {
  const response = await fetch(`/api/tx-status?hash=${encodeURIComponent(hash)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.status || `api ${response.status}`);
  }
  return payload;
}

function signalTradeSettlement(entries, mode) {
  const confirmedHashes = entries
    .filter((entry) => String(entry?.status || "").toLowerCase() === "confirmed")
    .map((entry) => String(entry?.hash || "").trim())
    .filter(Boolean);
  if (!confirmedHashes.length) {
    return;
  }

  const detail = {
    source: "homepage",
    mode: mode || "private",
    confirmedHashes,
    at: Date.now()
  };
  try {
    window.localStorage.setItem(TRADE_SETTLEMENT_SIGNAL_KEY, JSON.stringify(detail));
  } catch {
  }
  window.dispatchEvent(new CustomEvent("sparta:trade-settled", { detail }));
  logHomepageBuyResult("trade settlement recorded", detail);
}

function scheduleBuyResultPolling(entries, mode, attempt = 0, pollToken = buyResultPollToken) {
  if (!entries.length || pollToken !== buyResultPollToken || (buyResultModal && buyResultModal.hidden)) {
    return;
  }

  if (entries.every((entry) => entry.status === "confirmed" || entry.status === "failed")) {
    updateBuyResultSummary(entries, mode);
    renderBuyResultLinks(entries);
    signalTradeSettlement(entries, mode);
    logHomepageBuyResult("polling completed", {
      mode: mode || "private",
      attempts: attempt,
      entries: entries.map((entry) => ({ hash: entry.hash, status: entry.status }))
    });
    return;
  }

  if (attempt >= BUY_RESULT_MAX_POLL_ATTEMPTS) {
    updateBuyResultSummary(entries, mode);
    renderBuyResultLinks(entries);
    return;
  }

  window.setTimeout(async () => {
    if (pollToken !== buyResultPollToken || (buyResultModal && buyResultModal.hidden)) {
      return;
    }

    const nextEntries = await Promise.all(entries.map(async (entry) => {
      if (entry.status === "confirmed" || entry.status === "failed") {
        return entry;
      }
      const pollHashes = Array.isArray(entry.pollHashes) && entry.pollHashes.length
        ? entry.pollHashes
        : [entry.hash];
      try {
        const payloads = await Promise.all(
          pollHashes.map(async (hash) => {
            try {
              return await fetchHomepageBuyTxStatus(hash);
            } catch (error) {
              logHomepageBuyResult("tx-status fetch failed", {
                hash,
                error: String(error?.message || error || "unknown_error")
              });
              return null;
            }
          })
        );
        const statuses = payloads
          .map((payload) => String(payload?.tx?.status || "").toLowerCase())
          .filter(Boolean);
        return {
          ...entry,
          status: statuses.includes("confirmed")
            ? "confirmed"
            : statuses.includes("failed")
              ? "failed"
              : "pending"
        };
      } catch (error) {
        logHomepageBuyResult("poll cycle failed", {
          hash: entry.hash,
          error: String(error?.message || error || "unknown_error")
        });
        return entry;
      }
    }));

    if (pollToken !== buyResultPollToken) {
      return;
    }

    updateBuyResultSummary(nextEntries, mode);
    renderBuyResultLinks(nextEntries);
    logHomepageBuyResult("poll cycle completed", {
      mode: mode || "private",
      attempt: attempt + 1,
      entries: nextEntries.map((entry) => ({ hash: entry.hash, status: entry.status }))
    });
    scheduleBuyResultPolling(nextEntries, mode, attempt + 1, pollToken);
  }, 3000);
}

function renderBuyResultModal(result) {
  if (!buyResultModal || !buyResultTitle || !buyResultCopy || !buyResultLinks) {
    return;
  }

  const txHashes = Array.isArray(result?.txHashes) ? result.txHashes.filter(Boolean) : [];
  const submissionTxHash = String(result?.submission?.txHash || "").trim();
  const entries = result?.mode === "private" && submissionTxHash
    ? [{
        hash: submissionTxHash,
        status: "pending",
        pollHashes: Array.from(new Set([submissionTxHash, ...txHashes]))
      }]
    : txHashes.length
      ? txHashes.map((hash) => ({
          hash,
          status: "pending",
          pollHashes: txHashes.length === 1 && submissionTxHash
            ? Array.from(new Set([hash, submissionTxHash]))
            : [hash]
        }))
      : [];

  buyResultPollToken += 1;
  updateBuyResultSummary(entries, result?.mode);
  buyResultModal.hidden = false;
  logHomepageBuyResult("rendering buy result modal", {
    mode: result?.mode || "private",
    txHashes,
    submissionTxHash,
    entries: entries.map((entry) => ({ hash: entry.hash, pollHashes: entry.pollHashes }))
  });
  if (entries.length) {
    renderBuyResultLinks(entries);
    scheduleBuyResultPolling(entries, result?.mode, 0, buyResultPollToken);
  } else {
    buyResultLinks.innerHTML = `
      <a class="buy-result-link" href="https://bscscan.com" target="_blank" rel="noreferrer noopener">
        <span class="buy-result-link-row">
          <span class="buy-result-link-label">${escapeHtml(terminalHomeT("terminalHome.result.submission", "Submission"))}</span>
          <span class="buy-result-status is-pending">
            <span class="buy-result-status-icon" aria-hidden="true">...</span>
            <span>${escapeHtml(terminalHomeT("terminalHome.result.status.pending", "Pending"))}</span>
          </span>
        </span>
        <span class="buy-result-link-hash">${escapeHtml(result?.submission?.bundleHash || result?.submission?.txHash || terminalHomeT("terminalHome.result.viewOnBscScan", "View on BscScan"))}</span>
      </a>
    `;
  }
}

function enqueueAiBuyResultModal(result) {
  if (!result || !Array.isArray(result.txHashes) || !result.txHashes.length) {
    return;
  }
  aiBuyResultQueue.push(result);
  drainAiBuyResultQueue();
}

function drainAiBuyResultQueue() {
  if (!buyResultModal || !buyResultModal.hidden || !aiBuyResultQueue.length) {
    return;
  }

  const nextResult = aiBuyResultQueue.shift();
  if (!nextResult) {
    return;
  }

  renderBuyResultModal(nextResult);
}

function mapHomepageBuyErrorMessage(error) {
  const rawMessage = String(error?.message || "").trim();
  const message = rawMessage.includes(":") ? rawMessage.split(":")[0].trim() : rawMessage;
  if (!message) {
    return terminalHomeT("terminalHome.errors.buyFailed", "Buy failed.");
  }
  if (message === "missing_wallet" || message === "missing_auth") {
    return terminalHomeT("terminalHome.errors.loginFirst", "You need to log in first before using the buy button.");
  }
  if (message === "missing_selected_wallets") {
    return terminalHomeT("terminalHome.errors.noBscWallet", "No BSC trade wallet is selected in settings.");
  }
  if (message === "insufficient_balance") {
    return terminalHomeT("terminalHome.errors.insufficientBsc", "The selected trade wallet does not have enough balance for this buy and gas.");
  }
  if (message === "missing_sparta_buy_router" || message === "missing_sparta_base_router") {
    return terminalHomeT("terminalHome.errors.missingBuyRouter", "The buy router is not configured yet.");
  }
  return terminalHomeT("terminalHome.errors.buyFailedTryAgain", "Buy failed. Please try again.");
}

function renderBuyErrorModal(error) {
  if (!buyResultModal || !buyResultTitle || !buyResultCopy || !buyResultLinks) {
    return;
  }

  if (buyResultKicker) {
    buyResultKicker.textContent = terminalHomeT("terminalHome.result.buyFailed", "Buy Failed");
  }
  buyResultTitle.textContent = terminalHomeT("terminalHome.result.buyFailedTitle", "Buy failed");
  buyResultCopy.textContent = mapHomepageBuyErrorMessage(error);
  buyResultLinks.innerHTML = "";
  buyResultModal.hidden = false;
}

async function executeHomepageBuy(token) {
  const tokenAddress = String(token?.address || "").trim().toLowerCase();
  if (!tokenAddress) {
    throw new Error("missing_token_address");
  }

  const identity = getSettingsIdentity();
  if (!identity) {
    throw new Error("missing_wallet");
  }

  const response = await fetch("/api/homepage-buy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...identity,
      chain: activeHomepageChain,
      token_address: tokenAddress,
      amount: currentBuyOneAmount
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.status || `api ${response.status}`);
  }

  return payload.result || null;
}

async function proceedWithBuy(token) {
  if (!token) {
    return;
  }

  if (homepageBuyInFlight) {
    return;
  }

  homepageBuyInFlight = true;
  if (buyConfirmAccept) {
    buyConfirmAccept.disabled = true;
  }

  try {
    const result = await executeHomepageBuy(token);
    renderBuyResultModal(result);
  } catch (error) {
    console.error(error);
    renderBuyErrorModal(error);
  } finally {
    homepageBuyInFlight = false;
    if (buyConfirmAccept) {
      buyConfirmAccept.disabled = false;
    }
  }
}

function openTokenDetail(token) {
  if (!token?.address) {
    return;
  }

  const snapshot = buildSelectedTokenSnapshot(token);
  if (snapshot) {
    try {
      window.localStorage.setItem(SELECTED_TOKEN_KEY, JSON.stringify(snapshot));
    } catch {
    }
  }

  const tokenAddress = String(token.address || "").trim().toLowerCase();
  const tokenChain = snapshot?.chain === "base" || activeHomepageChain === "base" ? "base" : "bsc";
  window.SpartaChartPrefetch?.prefetchTokenChart?.(tokenAddress, tokenChain);
  window.location.href = window.SpartaRoutes?.getTokenHref?.(tokenAddress, tokenChain) || `./token.html?address=${encodeURIComponent(tokenAddress)}&chain=${encodeURIComponent(tokenChain)}`;
}

function prefetchChartFromCard(card) {
  const tokenAddress = String(card?.dataset?.tokenAddress || "").trim().toLowerCase();
  if (!tokenAddress) {
    return;
  }
  const tokenChain = card?.dataset?.tokenChain === "base" ? "base" : "bsc";
  window.SpartaChartPrefetch?.prefetchTokenChart?.(tokenAddress, tokenChain);
}

function buildSelectedTokenSnapshot(token) {
  if (!token || typeof token !== "object") {
    return null;
  }

  const address = String(token.address || "").trim().toLowerCase();
  if (!address) {
    return null;
  }

  const launchTime = Number(token.launchTime || 0);
  const priceUsd = Number(token.priceUsd);
  const marketCapUsd = Number(token.marketCapUsd);
  const volume24hUsd = Number(token.volume24hUsd);
  const isBonded = typeof token.isBonded === "boolean"
    ? token.isBonded
    : (String(token.isBonded || "").trim().toLowerCase() === "true");

  return {
    address,
    chain: token.chain === "base" || activeHomepageChain === "base" ? "base" : "bsc",
    name: String(token.name || "").trim(),
    shortName: String(token.shortName || token.symbol || "").trim(),
    symbol: String(token.symbol || token.shortName || "").trim(),
    image: String(token.image || "").trim(),
    websiteUrl: String(token.websiteUrl || "").trim(),
    telegramUrl: String(token.telegramUrl || "").trim(),
    twitterUrl: String(token.twitterUrl || "").trim(),
    pairLabel: String(token.pairLabel || "").trim(),
    routerLabel: String(token.routerLabel || "").trim(),
    launchTime: Number.isFinite(launchTime) && launchTime > 0 ? launchTime : null,
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
    marketCapUsd: Number.isFinite(marketCapUsd) ? marketCapUsd : null,
    volume24hUsd: Number.isFinite(volume24hUsd) ? volume24hUsd : null,
    isBonded
  };
}

function readSelectedTokenFromCard(card) {
  if (!card) {
    return null;
  }

  return buildSelectedTokenSnapshot({
    address: card.dataset.tokenAddress || "",
    name: card.dataset.tokenName || "",
    shortName: card.dataset.tokenShortName || "",
    symbol: card.dataset.tokenSymbol || "",
    image: card.dataset.tokenImage || "",
    websiteUrl: card.dataset.tokenWebsiteUrl || "",
    telegramUrl: card.dataset.tokenTelegramUrl || "",
    twitterUrl: card.dataset.tokenTwitterUrl || "",
    pairLabel: card.dataset.tokenPairLabel || "",
    routerLabel: card.dataset.tokenRouterLabel || "",
    chain: card.dataset.tokenChain || activeHomepageChain,
    launchTime: card.dataset.tokenLaunchTime || "",
    priceUsd: card.dataset.tokenPriceUsd || "",
    marketCapUsd: card.dataset.tokenMarketCapUsd || "",
    volume24hUsd: card.dataset.tokenVolume24hUsd || "",
    isBonded: card.dataset.tokenIsBonded || ""
  });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const helper = document.createElement("textarea");
  helper.value = value;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();

  try {
    return document.execCommand("copy");
  } finally {
    helper.remove();
  }
}

function saveWalletSession(walletType, address) {
  window.localStorage.setItem(
    WALLET_SESSION_KEY,
    JSON.stringify({
      walletType,
      address,
      connectedAt: Date.now()
    })
  );
  syncSettingsAccess();
}

function readWalletSession() {
  try {
    return JSON.parse(window.localStorage.getItem(WALLET_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function getSettingsIdentity() {
  const walletSession = readWalletSession();
  if (walletSession?.address) {
    return { address: walletSession.address };
  }

  return null;
}

async function pollAiAlerts() {
  const identity = getSettingsIdentity();
  if (!identity) {
    return;
  }

  try {
    await window.SpartaProfileMenu?.ensureServerAuth?.({ interactive: false });
    const search = new URLSearchParams(identity);
    const response = await fetch(`/api/ai-alerts?${search.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.status || `api ${response.status}`);
    }

    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    alerts.forEach((alert) => {
      if (alert?.type === "ai_auto_buy_insufficient_balance") {
        showAlertToast(
          String(alert.title || "AI Auto-Buy Warning"),
          String(alert.message || "One or more selected AI wallets can't cover the next buy.")
        );
        return;
      }

      if (alert?.type === "ai_auto_buy_submitted" && alert?.result) {
        enqueueAiBuyResultModal(alert.result);
      }
    });
  } catch (error) {
    if (String(error?.message || "") !== "missing_auth") {
      console.error(error);
    }
  }
}

function startAiAlertsPolling() {
  if (aiAlertsPollTimer) {
    window.clearInterval(aiAlertsPollTimer);
    aiAlertsPollTimer = null;
  }

  const identity = getSettingsIdentity();
  if (!identity) {
    return;
  }

  pollAiAlerts().catch((error) => console.error(error));
  aiAlertsPollTimer = window.setInterval(() => {
    pollAiAlerts().catch((error) => console.error(error));
  }, AI_ALERT_POLL_INTERVAL_MS);
}

async function fetchUserBuyOneAmount() {
  const identity = getSettingsIdentity();
  if (!identity) {
    currentBuyOneAmount = DEFAULT_BUY_ONE_AMOUNT;
    return;
  }

  try {
    await window.SpartaProfileMenu?.ensureServerAuth?.({ interactive: false });
    const search = new URLSearchParams(identity);
    const response = await fetch(`/api/settings?${search.toString()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || payload.status || `api ${response.status}`);
    }

    currentBuyOneAmount = formatBuyButtonAmount(payload.settings?.buy_one ?? DEFAULT_BUY_ONE_AMOUNT);
  } catch (error) {
    console.error(error);
    currentBuyOneAmount = DEFAULT_BUY_ONE_AMOUNT;
  }

  document.querySelectorAll(".token-buy-button").forEach((button) => {
    if (button.disabled || button.closest(".token-card-link")?.dataset.tokenBuyDisabled === "true") {
      button.dataset.hoverLabel = "Soon";
      return;
    }
    button.dataset.hoverLabel = `Buy: ${currentBuyOneAmount}`;
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = "dark";
  window.localStorage.removeItem(THEME_KEY);
}

function readTheme() {
  return "dark";
}

function saveTheme(theme) {
  window.localStorage.removeItem(THEME_KEY);
  applyTheme("dark");
}

function readAlertPrefs() {
  try {
    return JSON.parse(window.localStorage.getItem(ALERT_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveAlertPrefs(nextPrefs) {
  window.localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(nextPrefs));
}

function requestBrowserNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }

  Notification.requestPermission().catch(() => {});
}

function unlockAlertAudio() {
  alertAudioUnlocked = true;
}

function playAlertSound() {
  if (!alertAudioUnlocked) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const now = context.currentTime;
  const sequence = [880, 1174];

  sequence.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = now + (index * 0.16);
    const stopAt = startAt + 0.12;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(stopAt);
  });

  window.setTimeout(() => {
    context.close().catch(() => {});
  }, 500);
}

function ensureAlertToast() {
  let toast = document.getElementById("alert-toast");
  if (toast) {
    return toast;
  }

  toast = document.createElement("div");
  toast.id = "alert-toast";
  toast.className = "alert-toast";
  toast.hidden = true;
  toast.innerHTML = `
    <div class="alert-toast-title"></div>
    <div class="alert-toast-copy"></div>
  `;
  document.body.appendChild(toast);
  return toast;
}

function showAlertToast(title, message) {
  const toast = ensureAlertToast();
  const titleNode = toast.querySelector(".alert-toast-title");
  const copyNode = toast.querySelector(".alert-toast-copy");
  if (titleNode) {
    titleNode.textContent = title;
  }
  if (copyNode) {
    copyNode.textContent = message;
  }

  toast.hidden = false;
  toast.classList.remove("is-visible");
  void toast.offsetWidth;
  toast.classList.add("is-visible");

  if (alertToastTimer) {
    window.clearTimeout(alertToastTimer);
  }

  alertToastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => {
      toast.hidden = true;
    }, 180);
  }, 3800);
}

function fireAiPickAlert(token) {
  const tokenName = token?.shortName || token?.symbol || token?.name || "Token";
  const copy = terminalHomeT("terminalHome.alerts.newAiPickCopy", `${tokenName} appeared in Sparta AI Picks.`, { token: tokenName });

  showAlertToast(terminalHomeT("terminalHome.alerts.newAiPickTitle", "New Sparta AI Pick"), copy);
  playAlertSound();

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(terminalHomeT("terminalHome.alerts.newAiPickTitle", "New Sparta AI Pick"), {
        body: copy,
        icon: token?.image ? proxiedImageUrl(token.image) : "./spartalogo.png"
      });
    } catch {
      // Ignore notification failures and keep the in-page toast.
    }
  }
}

function processAiPickAlerts(tokens) {
  const nextAddresses = new Set(
    (tokens || [])
      .map((token) => String(token?.address || "").toLowerCase())
      .filter(Boolean)
  );

  if (!aiPicksAlertInitialized) {
    nextAddresses.forEach((address) => seenAiPickAddresses.add(address));
    aiPicksAlertInitialized = true;
    return;
  }

  const alertsEnabled = Boolean(readAlertPrefs().aiPicks);

  (tokens || []).forEach((token) => {
    const address = String(token?.address || "").toLowerCase();
    if (!address || seenAiPickAddresses.has(address)) {
      return;
    }

    seenAiPickAddresses.add(address);
    if (alertsEnabled) {
      fireAiPickAlert(token);
    }
  });

  Array.from(seenAiPickAddresses).forEach((address) => {
    if (!nextAddresses.has(address)) {
      seenAiPickAddresses.delete(address);
    }
  });
}

function syncSettingsAccess() {
  if (!settingsTrigger) {
    return;
  }

  settingsTrigger.classList.remove("is-disabled");
  settingsTrigger.setAttribute("aria-disabled", "false");
  settingsTrigger.tabIndex = 0;

  document.querySelectorAll(".mobile-nav-dropdown .settings-trigger").forEach((link) => {
    link.classList.remove("is-disabled");
    link.setAttribute("aria-disabled", "false");
    link.tabIndex = 0;
  });
}

function setActiveMobileRow(rowKey) {
  if (!rowKey) {
    return;
  }

  mobileRowTabs.forEach((tab) => {
    const isActive = tab.dataset.mobileRowTab === rowKey;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  mobileRowPanels.forEach((panel) => {
    panel.classList.toggle("is-mobile-active", panel.dataset.mobileRowPanel === rowKey);
  });
}

function getMetaMaskProvider() {
  const ethereum = window.ethereum;
  if (!ethereum) {
    return null;
  }

  if (Array.isArray(ethereum.providers)) {
    return ethereum.providers.find((provider) => provider.isMetaMask) || null;
  }

  return ethereum.isMetaMask ? ethereum : null;
}

async function connectMetaMask() {
  const provider = getMetaMaskProvider();
  if (!provider) {
    return;
  }

  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = accounts?.[0];
    if (account) {
      saveWalletSession("MetaMask", account);
    }
  } catch (error) {
    console.error(error);
  }
}

async function connectPhantom() {
  const phantom = window.phantom?.solana;
  if (!phantom?.isPhantom) {
    return;
  }

  try {
    const result = await phantom.connect();
    const address = result?.publicKey?.toString();
    if (address) {
      saveWalletSession("Phantom", address);
    }
  } catch (error) {
    console.error(error);
  }
}

function formatAge(timestampSeconds) {
  const rawTimestamp = Number(timestampSeconds);
  const normalizedTimestamp = rawTimestamp > 1_000_000_000_000
    ? Math.floor(rawTimestamp / 1000)
    : rawTimestamp;
  if (!Number.isFinite(normalizedTimestamp) || normalizedTimestamp <= 0) {
    return "";
  }
  const age = Math.max(0, Math.floor(Date.now() / 1000) - normalizedTimestamp);

  if (age < 60) {
    return `${age}s`;
  }

  if (age < 3600) {
    return `${Math.floor(age / 60)}m`;
  }

  if (age < 86400) {
    return `${Math.floor(age / 3600)}h`;
  }

  return `${Math.floor(age / 86400)}d`;
}

function formatCompactUsd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "MC: --";
  }

  if (numeric >= 1_000_000_000) {
    return `MC: $${(numeric / 1_000_000_000).toFixed(2)}B`;
  }
  if (numeric >= 1_000_000) {
    return `MC: $${(numeric / 1_000_000).toFixed(2)}M`;
  }
  if (numeric >= 1_000) {
    return `MC: $${(numeric / 1_000).toFixed(1)}K`;
  }

  return `MC: $${numeric.toFixed(0)}`;
}

function formatUsdNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "$0";
  }

  if (numeric >= 1_000_000_000) {
    return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  }
  if (numeric >= 1_000_000) {
    return `$${(numeric / 1_000_000).toFixed(2)}M`;
  }
  if (numeric >= 1_000) {
    return `$${(numeric / 1_000).toFixed(1)}K`;
  }

  return `$${numeric.toFixed(0)}`;
}

function formatCompactVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "Vol: $0";
  }

  if (numeric < 0.01) {
    return `Vol: $${numeric.toFixed(4)}`;
  }
  if (numeric < 1) {
    return `Vol: $${numeric.toFixed(3)}`;
  }
  if (numeric < 1000) {
    return `Vol: $${numeric.toFixed(2)}`;
  }
  if (numeric >= 1_000_000_000) {
    return `Vol: $${(numeric / 1_000_000_000).toFixed(2)}B`;
  }
  if (numeric >= 1_000_000) {
    return `Vol: $${(numeric / 1_000_000).toFixed(2)}M`;
  }
  if (numeric >= 1_000) {
    return `Vol: $${(numeric / 1_000).toFixed(1)}K`;
  }

  return `Vol: $${numeric.toFixed(2)}`;
}

function getTxMix(token) {
  const buyCount = Math.max(0, Number(token.buyCount || 0));
  const sellCount = Math.max(0, Number(token.sellCount || 0));
  const txCount = Math.max(0, Number(token.txCount || 0));
  const total = Math.max(txCount, buyCount + sellCount);
  const buyRatio = total > 0 ? buyCount / total : 0;

  return {
    txCount: total,
    buyRatio
  };
}

window.handleTokenAvatarError = function handleTokenAvatarError(img) {
  if (!(img instanceof HTMLImageElement)) {
    return;
  }

  const directImage = String(img.dataset.tokenImage || "").trim();
  const currentSrc = String(img.getAttribute("src") || img.src || "").trim();
  if (
    directImage &&
    currentSrc &&
    currentSrc !== directImage &&
    currentSrc.includes("/api/token-image")
  ) {
    img.src = directImage;
    return;
  }

  const tokenAddress = String(img.dataset.tokenAddress || "").trim().toLowerCase();
  const recoveryScope = String(img.dataset.imageRecoveryScope || "").trim().toLowerCase();
  const recoveryAttempted = img.dataset.imageRecoveryAttempted === "true";
  if (tokenAddress && recoveryScope && !recoveryAttempted) {
    img.dataset.imageRecoveryAttempted = "true";
    void recoverDeadRowTokenImage(img, tokenAddress, recoveryScope);
    return;
  }

  const retryCount = Number(img.dataset.retryCount || 0);
  if (retryCount < 1) {
    img.dataset.retryCount = String(retryCount + 1);
    const separator = img.src.includes("?") ? "&" : "?";
    img.src = `${img.src}${separator}retry=${Date.now()}`;
    return;
  }

  img.replaceWith(Object.assign(document.createElement("div"), {
    className: "token-avatar token-avatar-empty",
    ariaHidden: "true"
  }));
};

async function recoverDeadRowTokenImage(img, tokenAddress, recoveryScope) {
  try {
    const search = new URLSearchParams({
      address: tokenAddress,
      chain: "bsc",
      scope: recoveryScope
    });
    const response = await fetch(`/api/token-image-recovery?${search.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const imageUrl = String(payload?.imageUrl || "").trim();
    if (!response.ok || !imageUrl) {
      throw new Error(payload?.error || payload?.status || `api ${response.status}`);
    }
    img.dataset.tokenImage = imageUrl;
    img.dataset.retryCount = "0";
    img.src = `${proxiedImageUrl(imageUrl)}&recovered=${Date.now()}`;
  } catch {
    const retryCount = Number(img.dataset.retryCount || 0);
    if (retryCount < 1) {
      img.dataset.retryCount = String(retryCount + 1);
      const separator = img.src.includes("?") ? "&" : "?";
      img.src = `${img.src}${separator}retry=${Date.now()}`;
      return;
    }

    img.replaceWith(Object.assign(document.createElement("div"), {
      className: "token-avatar token-avatar-empty",
      ariaHidden: "true"
    }));
  }
}

function tokenRenderSignature(token, { ageField = "launchTime" } = {}) {
  const normalizedPairLabel = normalizeBscPairLabelForDisplay(token.pairLabel);
  const address = String(token.address || "").trim().toLowerCase();
  const image = String(token.image || tokenImageMemory.get(address) || "").trim();
  return [
    token.address || "",
    image,
    token.name || "",
    token.shortName || token.symbol || "",
    token[ageField] || 0,
    normalizedPairLabel || "",
    token.marketCapUsd || 0,
    token.volume24hUsd || 0,
    token.txCount || 0,
    token.buyCount || 0,
    token.sellCount || 0,
    token.entryMarketCapUsd || 0,
    token.aiPickMarketCapUsd || 0,
    token.profitPercent || 0,
    token.peakProfitPercent || 0,
    token.isTaxToken ? token.taxRate || 0 : "notax",
    token.hasAntiSniper ? "anti" : "noanti"
  ].join("|");
}

function normalizeBscPairLabelForDisplay(pairLabel) {
  const label = String(pairLabel || "").trim();
  return label.toUpperCase() === "WBNB" ? "BNB" : label;
}

function formatProfitPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const absolute = Math.abs(numeric);
  const decimals = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  const formatted = absolute
    .toFixed(decimals)
    .replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");

  return `${numeric >= 0 ? "+" : "-"}${formatted}%`;
}

function formatTokenTaxLabel(token) {
  if (!token?.isTaxToken) {
    return "";
  }

  const numeric = Number(token.taxRate);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }

  const percent = numeric > 100 ? numeric / 100 : numeric;
  const decimals = percent >= 10 || Number.isInteger(percent) ? 0 : 2;
  const formatted = percent
    .toFixed(decimals)
    .replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");

  return `${formatted}/${formatted}`;
}

function renderTokenCard(token, { showAiPickMetrics = false, ageField = "launchTime", imageRecoveryScope = "", imageRecoveryEligible = false } = {}) {
  const tokenChain = token.chain === "base" || activeHomepageChain === "base" ? "base" : "bsc";
  const buyDisabled = token.buyDisabled === true || tokenChain === "base";
  const imageAddress = String(token.address || "").trim().toLowerCase();
  const rawImage = String(token.image || "").trim();
  if (imageAddress && rawImage) {
    tokenImageMemory.set(imageAddress, rawImage);
  }
  const stableImage = rawImage || (imageAddress ? String(tokenImageMemory.get(imageAddress) || "").trim() : "");
  const image = stableImage ? escapeHtml(stableImage) : "";
  const name = escapeHtml(token.name || "Unknown");
  const shortName = escapeHtml(token.shortName || token.symbol || "TKN");
  const symbol = escapeHtml(token.symbol || token.shortName || "");
  const fullAddress = escapeHtml(token.address || "");
  const address = escapeHtml(shortAddress(token.address));
  const age = escapeHtml(formatAge(token[ageField]));
  const pair = escapeHtml(normalizeBscPairLabelForDisplay(token.pairLabel) || "Unknown");
  const marketCap = escapeHtml(formatCompactUsd(token.marketCapUsd));
  const aiPickMarketCapUsd = Number.isFinite(Number(token.aiPickMarketCapUsd)) && Number(token.aiPickMarketCapUsd) > 0
    ? token.aiPickMarketCapUsd
    : token.entryMarketCapUsd;
  const aiEntryMarketCap = escapeHtml(formatUsdNumber(aiPickMarketCapUsd));
  const volume = escapeHtml(formatCompactVolume(token.volume24hUsd));
  const txMix = getTxMix(token);
  const txLabel = escapeHtml(`TX ${txMix.txCount}`);
  const tax = formatTokenTaxLabel(token);
  const websiteUrl = token.websiteUrl ? escapeHtml(token.websiteUrl) : "";
  const telegramUrl = token.telegramUrl ? escapeHtml(token.telegramUrl) : "";
  const twitterUrl = token.twitterUrl ? escapeHtml(token.twitterUrl) : "";
  const xSearchQuery = token.shortName || token.name || "";
  const xSearchUrl = xSearchQuery
    ? `https://x.com/search?q=${encodeURIComponent(xSearchQuery)}&src=typed_query`
    : "https://x.com/search";
  const profitPercent = showAiPickMetrics ? Number(token.profitPercent) : NaN;
  const peakProfitPercent = showAiPickMetrics ? Number(token.peakProfitPercent) : NaN;
  const profitLabel = Number.isFinite(profitPercent) && profitPercent > 0
    ? formatProfitPercent(profitPercent)
    : "";
  const profitMultiplier = showAiPickMetrics && Number.isFinite(peakProfitPercent) && peakProfitPercent > 0
    ? `x${(1 + (peakProfitPercent / 100))
      .toFixed(2)
      .replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}`
    : "";
  const ageMarkup = profitLabel
    ? `<span class="token-age-stack">
            <span class="token-age" data-token-age-for="${fullAddress}">${age}</span>
            <span class="token-profit ${profitPercent >= 0 ? "positive" : "negative"}">${escapeHtml(profitLabel)}</span>
          </span>`
    : `<span class="token-age" data-token-age-for="${fullAddress}">${age}</span>`;
  const imageSrc = image ? escapeHtml(proxiedImageUrl(stableImage)) : "";
  const recoveryAttributes = imageRecoveryEligible && imageRecoveryScope
    ? ` data-token-address="${fullAddress}" data-image-recovery-scope="${escapeHtml(imageRecoveryScope)}" data-image-recovery-attempted="false"`
    : "";
  const avatar = image
    ? `<img class="token-avatar" src="${imageSrc}" alt="${name} logo" loading="eager" decoding="async" data-token-image="${escapeHtml(stableImage)}" data-retry-count="0"${recoveryAttributes} onerror="window.handleTokenAvatarError(this)" />`
    : `<div class="token-avatar token-avatar-empty" aria-hidden="true"></div>`;
  const iconLinks = [
    websiteUrl ? { href: websiteUrl, src: "./icons/icons8-web-24.png", label: "Website" } : null,
    telegramUrl ? { href: telegramUrl, src: "./icons/icons8-telegram-32.png", label: "Telegram" } : null,
    twitterUrl ? { href: twitterUrl, src: "./icons/icons8-x-50.png", label: "X" } : null,
    { href: xSearchUrl, src: "./icons/icons8-search-24.png", label: "Search X" }
  ].filter(Boolean).map(({ href, src, label }) => (
    `<a class="token-icon-link" href="${href}" target="_blank" rel="noreferrer noopener" aria-label="${label}">
      <img class="token-icon" src="${src}" alt="" />
    </a>`
  )).join("");

  return `
    <article
      class="token-card token-card-link"
      data-token-address="${fullAddress}"
      data-token-name="${name}"
      data-token-short-name="${shortName}"
      data-token-symbol="${symbol}"
      data-token-image="${image}"
      data-token-website-url="${websiteUrl}"
      data-token-telegram-url="${telegramUrl}"
      data-token-twitter-url="${twitterUrl}"
      data-token-pair-label="${pair}"
      data-token-router-label="${escapeHtml(token.routerLabel || "")}"
      data-token-launch-time="${escapeHtml(String(token[ageField] || ""))}"
      data-token-price-usd="${escapeHtml(String(token.priceUsd ?? ""))}"
      data-token-market-cap-usd="${escapeHtml(String(token.marketCapUsd ?? ""))}"
      data-token-volume24h-usd="${escapeHtml(String(token.volume24hUsd ?? ""))}"
      data-token-is-bonded="${token.isBonded === true ? "true" : "false"}"
      data-token-chain="${escapeHtml(tokenChain)}"
      data-token-buy-disabled="${buyDisabled ? "true" : "false"}"
    >
      ${avatar}
      <div class="token-main">
        <div class="token-topline">
          <div class="token-title">
            <h3>${shortName}</h3>
            <p>${name}</p>
          </div>
          ${ageMarkup}
        </div>
        <div class="token-meta-line">
          <button class="token-address" type="button" data-copy-address="${fullAddress}">${address}</button>
          <div class="token-meta-icons">${iconLinks}</div>
        </div>
        <div class="token-footer">
          <div class="token-tags">
            <span class="token-tag">${pair}</span>
            ${tax ? `<span class="token-tag">${tax}</span>` : ""}
            <span class="token-tag token-tag-tx" style="--buy-ratio:${txMix.buyRatio.toFixed(4)}">${txLabel}</span>
            <span class="token-tag token-tag-volume${Number(token.volume24hUsd || 0) > 0 ? " is-active" : ""}">${volume}</span>
            <span class="token-tag token-tag-marketcap">${marketCap}</span>
            ${showAiPickMetrics && Number.isFinite(Number(aiPickMarketCapUsd)) ? `<span class="token-tag token-tag-marketcap">AI: ${aiEntryMarketCap}</span>` : ""}
            ${profitMultiplier ? `<span class="token-tag token-tag-marketcap">${escapeHtml(profitMultiplier)}</span>` : ""}
          </div>
          <button class="token-buy-button" type="button" data-default-label="Buy" data-hover-label="${buyDisabled ? "Soon" : escapeHtml(`Buy: ${currentBuyOneAmount}`)}" aria-label="${buyDisabled ? "Buy coming soon" : escapeHtml(`Buy: ${currentBuyOneAmount}`)}" ${buyDisabled ? "disabled" : ""}></button>
        </div>
      </div>
    </article>
  `;
}

function updateRenderedTokenAges(container, tokens, { ageField = "launchTime" } = {}) {
  if (!container) {
    return;
  }

  tokens.forEach((token) => {
    const selector = `[data-token-age-for="${CSS.escape(String(token.address || "").toLowerCase())}"]`;
    const ageNode = container.querySelector(selector);
    if (ageNode) {
      ageNode.textContent = formatAge(token[ageField]);
    }
  });
}

function renderTokenFeed(container, tokens, emptyMessage, options = {}) {
  if (!container) {
    return;
  }

  if (!tokens.length) {
    container.dataset.renderSignature = "";
    container.innerHTML = `
      <article class="token-card token-card-empty${options.emptyClassName ? ` ${options.emptyClassName}` : ""}">
        ${escapeHtml(emptyMessage)}
      </article>
    `;
    return;
  }

  const maxVisibleTokens = Math.max(1, Number(options.maxVisibleTokens || MAX_TOKENS));
  const visibleTokens = tokens.slice(0, maxVisibleTokens);
  const nextSignature = visibleTokens.map((token) => tokenRenderSignature(token, options)).join("::");
  if (container.dataset.renderSignature === nextSignature) {
    updateRenderedTokenAges(container, visibleTokens, options);
    return;
  }

  container.dataset.renderSignature = nextSignature;
  const recoveryScope = String(options.imageRecoveryScope || "").trim();
  const recoveryStartIndex = Math.max(0, Number(options.imageRecoveryStartIndex || 0));
  container.innerHTML = visibleTokens.map((token, index) => renderTokenCard(token, {
    ...options,
    imageRecoveryEligible: Boolean(recoveryScope) && (recoveryStartIndex + index) < 20
  })).join("");
}

function renderTokens(tokens) {
  renderTokenFeed(
    deployFeed,
    tokens,
    terminalHomeT("discover.empty.trending", "Trending tokens loading.."),
    {
      maxVisibleTokens: MAX_NEW_TOKEN_DISPLAY_TOKENS
    }
  );
  ensureDeployFeedSentinel();
  syncDeploySentinel();
}

function renderAiPicks(tokens) {
  renderTokenFeed(aiPicksFeed, tokens, terminalHomeT("discover.empty.aiPicks", "Sparta AI Picks loading.."), {
    showAiPickMetrics: true,
    emptyClassName: "token-card-empty-inline",
    imageRecoveryScope: "ai-picks"
  });
}

function renderMigratedAiPicks(tokens) {
  renderTokenFeed(migratedAiPicksFeed, tokens, terminalHomeT("discover.empty.migrated", "Migrated AI picks loading.."), {
    showAiPickMetrics: true,
    emptyClassName: "token-card-empty-compact token-card-empty-inline",
    imageRecoveryScope: "migrated"
  });
}

function ensureMigratedFeedShell() {
  if (!migratedAiPicksFeed) {
    return null;
  }

  let liveFeed = migratedAiPicksFeed.querySelector("[data-migrated-live-feed]");
  let archiveFeed = migratedAiPicksFeed.querySelector("[data-migrated-archive-feed]");
  let sentinel = migratedAiPicksFeed.querySelector("[data-migrated-feed-sentinel]");

  if (!liveFeed || !archiveFeed || !sentinel) {
    migratedAiPicksFeed.innerHTML = `
      <div data-migrated-live-feed></div>
      <div data-migrated-archive-feed></div>
      <div data-migrated-feed-sentinel style="height:1px" aria-hidden="true"></div>
    `;
    liveFeed = migratedAiPicksFeed.querySelector("[data-migrated-live-feed]");
    archiveFeed = migratedAiPicksFeed.querySelector("[data-migrated-archive-feed]");
    sentinel = migratedAiPicksFeed.querySelector("[data-migrated-feed-sentinel]");
  }

  return { liveFeed, archiveFeed, sentinel };
}

function syncMigratedSentinel() {
  const shell = ensureMigratedFeedShell();
  if (!shell) {
    return;
  }

  shell.sentinel.hidden = migratedLoadingMore || migratedLoadedCount >= migratedTotalCount;
}

async function fetchMigratedTokensPage(offset = 0, limit = MAX_MIGRATED_LIVE_TOKENS) {
  const search = new URLSearchParams({
    offset: String(Math.max(0, Number(offset || 0))),
    limit: String(Math.max(1, Number(limit || MAX_MIGRATED_LIVE_TOKENS)))
  });
  return activeHomepageChain === "base"
    ? fetchFeed(`/api/base/migrated-tokens?${search.toString()}`)
    : fetchFeed(`/api/migrated-tokens?${search.toString()}`);
}

async function fetchCachedMigratedTokensPayload() {
  if (Array.isArray(migratedTokens24h) && migratedTokens24h.length) {
    return { tokens: migratedTokens24h };
  }

  const payload = await fetchMigratedTokensPage(0, Math.max(migratedLoadedCount, MAX_MIGRATED_LIVE_TOKENS));
  const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
  if (tokens.length) {
    migratedTokens24h = tokens;
    migratedLoadedCount = tokens.length;
    const payloadCount24h = Number(payload?.count24h);
    migratedCount24h = Number.isFinite(payloadCount24h)
      ? Math.max(0, payloadCount24h)
      : tokens.length;
    const payloadTotalCount = Number(payload?.totalCount);
    migratedTotalCount = Number.isFinite(payloadTotalCount)
      ? Math.max(tokens.length, payloadTotalCount)
      : Math.max(migratedTotalCount, tokens.length);
  }

  return { ...payload, tokens };
}

function renderMigratedFeed(tokens) {
  const shell = ensureMigratedFeedShell();
  if (!shell) {
    return;
  }

  if (Array.isArray(tokens)) {
    migratedTokens24h = tokens;
    migratedLoadedCount = tokens.length;
  }

  const liveTokens = migratedTokens24h.slice(0, MAX_MIGRATED_LIVE_TOKENS);
  const archiveTokens = migratedTokens24h.slice(MAX_MIGRATED_LIVE_TOKENS);

  renderTokenFeed(shell.liveFeed, liveTokens, terminalHomeT("discover.empty.migrated", "Migrated loading.."), {
    ageField: "migratedAt",
    emptyClassName: "token-card-empty-compact token-card-empty-inline",
    imageRecoveryScope: "migrated",
    imageRecoveryStartIndex: 0
  });

  const archiveSignature = archiveTokens.map((token) => tokenRenderSignature(token, { ageField: "migratedAt" })).join("::");
  if (!archiveTokens.length) {
    shell.archiveFeed.dataset.renderSignature = "";
    shell.archiveFeed.innerHTML = "";
  } else if (shell.archiveFeed.dataset.renderSignature !== archiveSignature) {
    shell.archiveFeed.dataset.renderSignature = archiveSignature;
    shell.archiveFeed.innerHTML = archiveTokens.map((token, index) => renderTokenCard(token, {
      ageField: "migratedAt",
      imageRecoveryScope: "migrated",
      imageRecoveryEligible: (MAX_MIGRATED_LIVE_TOKENS + index) < 20
    })).join("");
  }

  updateRenderedTokenAges(shell.archiveFeed, archiveTokens, { ageField: "migratedAt" });
  syncMigratedSentinel();
}

async function loadMoreMigratedTokens() {
  if (migratedLoadingMore || migratedLoadedCount >= migratedTotalCount) {
    return;
  }

  migratedLoadingMore = true;
  syncMigratedSentinel();

  try {
    const payload = await fetchMigratedTokensPage(migratedLoadedCount, MIGRATED_PAGE_SIZE);
    const nextBatch = Array.isArray(payload.tokens) ? payload.tokens : [];
    const payloadCount24h = Number(payload.count24h);
    migratedCount24h = Number.isFinite(payloadCount24h)
      ? Math.max(0, payloadCount24h)
      : migratedCount24h;
    const payloadTotalCount = Number(payload.totalCount);
    migratedTotalCount = Number.isFinite(payloadTotalCount)
      ? Math.max(migratedLoadedCount, payloadTotalCount)
      : Math.max(migratedTotalCount, migratedLoadedCount + nextBatch.length);
    if (nextBatch.length) {
      migratedTokens24h = migratedTokens24h.concat(nextBatch);
      migratedLoadedCount = migratedTokens24h.length;
      renderMigratedFeed();
      await refreshExpandedMigratedTokensIfStale();
    }
  } catch (error) {
    console.error(error);
  } finally {
    migratedLoadingMore = false;
    syncMigratedSentinel();
  }
}

function initMigratedLazyLoad() {
  const shell = ensureMigratedFeedShell();
  if (!shell || migratedLazyObserver) {
    return;
  }

  migratedLazyObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMoreMigratedTokens().catch((error) => console.error(error));
    }
  }, {
    root: null,
    rootMargin: "800px 0px",
    threshold: 0
  });

  migratedLazyObserver.observe(shell.sentinel);
}

async function refreshExpandedMigratedTokensIfStale() {
  if (
    migratedExpandedRefreshInFlight ||
    migratedLoadedCount <= MAX_MIGRATED_LIVE_TOKENS ||
    (Date.now() - migratedExpandedRefreshAt) < MIGRATED_EXPANDED_REFRESH_TTL_MS
  ) {
    return;
  }

  migratedExpandedRefreshInFlight = true;

  try {
    const payload = await fetchMigratedTokensPage(0, migratedLoadedCount);
    const refreshedTokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const payloadCount24h = Number(payload.count24h);
    migratedCount24h = Number.isFinite(payloadCount24h)
      ? Math.max(0, payloadCount24h)
      : migratedCount24h;
    const payloadTotalCount = Number(payload.totalCount);
    migratedTotalCount = Number.isFinite(payloadTotalCount)
      ? Math.max(refreshedTokens.length, payloadTotalCount)
      : Math.max(migratedTotalCount, refreshedTokens.length);
    if (refreshedTokens.length) {
      migratedTokens24h = refreshedTokens.concat(migratedTokens24h.slice(refreshedTokens.length));
      renderMigratedFeed();
    }
    migratedExpandedRefreshAt = Date.now();
  } catch (error) {
    console.error(error);
  } finally {
    migratedExpandedRefreshInFlight = false;
  }
}

async function fetchFeed(pathname) {
  const response = await fetch(pathname, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`api ${response.status}`);
  }

  return response.json();
}

async function fetchTokens() {
  if (activeHomepageChain === "base") {
    return fetchFeed("/api/discover/base-trending-row");
  }

  const [poolsResult, tokensResult] = await Promise.allSettled([
    fetchFeed("/api/discover/bsc-trending-pools"),
    fetchFeed("/api/discover/bsc-trending-tokens")
  ]);
  const poolTokens = poolsResult.status === "fulfilled" && Array.isArray(poolsResult.value?.tokens)
    ? poolsResult.value.tokens
    : [];
  const trendingTokens = tokensResult.status === "fulfilled" && Array.isArray(tokensResult.value?.tokens)
    ? tokensResult.value.tokens
    : [];
  if (poolsResult.status !== "fulfilled" && tokensResult.status !== "fulfilled") {
    throw poolsResult.reason || tokensResult.reason || new Error("trending_tokens_unavailable");
  }
  return {
    tokens: mergeHomepageTrendingTokenLists(trendingTokens, poolTokens),
    status: "Live"
  };
}

async function fetchNewTokensPage(offset = 0, limit = NEW_TOKEN_PAGE_SIZE) {
  const normalizedOffset = Math.max(0, Number(offset || 0));
  const normalizedLimit = Math.max(1, Math.min(MAX_NEW_TOKEN_DISPLAY_TOKENS, Number(limit || NEW_TOKEN_PAGE_SIZE)));
  const search = new URLSearchParams({
    offset: String(normalizedOffset),
    limit: String(normalizedLimit)
  });
  if (activeHomepageChain === "base") {
    return fetchFeed(`/api/base/new-tokens?${search.toString()}`);
  }
  return fetchFeed(`/api/tokens?${search.toString()}`);
}

function getDeploySentinel() {
  if (!deployFeed) {
    return null;
  }
  return deployFeed.querySelector("[data-deploy-feed-sentinel]");
}

function ensureDeployFeedSentinel() {
  if (!deployFeed || !lastDeployTokens.length) {
    return null;
  }
  let sentinel = getDeploySentinel();
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.dataset.deployFeedSentinel = "true";
    sentinel.style.height = "1px";
    sentinel.setAttribute("aria-hidden", "true");
    deployFeed.appendChild(sentinel);
    if (deployLazyObserver) {
      deployLazyObserver.observe(sentinel);
    }
  }
  return sentinel;
}

function syncDeploySentinel() {
  const sentinel = getDeploySentinel();
  if (!sentinel) {
    return;
  }
  sentinel.hidden = deployLoadingMore || deployLoadedCount >= deployTotalCount || deployLoadedCount >= MAX_NEW_TOKEN_DISPLAY_TOKENS;
}

function mergeDeployTokenPages(primaryTokens, secondaryTokens) {
  const merged = new Map();
  (Array.isArray(primaryTokens) ? primaryTokens : []).forEach((token) => {
    const address = String(token?.address || "").toLowerCase();
    if (address) {
      merged.set(address, token);
    }
  });
  (Array.isArray(secondaryTokens) ? secondaryTokens : []).forEach((token) => {
    const address = String(token?.address || "").toLowerCase();
    if (!address) {
      return;
    }
    const existing = merged.get(address);
    merged.set(address, existing ? { ...token, ...existing } : token);
  });
  return Array.from(merged.values()).slice(0, MAX_NEW_TOKEN_DISPLAY_TOKENS);
}

async function loadMoreDeployTokens() {
  if (deployLoadingMore || deployLoadedCount >= deployTotalCount || deployLoadedCount >= MAX_NEW_TOKEN_DISPLAY_TOKENS) {
    return;
  }

  deployLoadingMore = true;
  syncDeploySentinel();

  try {
    const nextLimit = Math.min(NEW_TOKEN_PAGE_SIZE, MAX_NEW_TOKEN_DISPLAY_TOKENS - deployLoadedCount);
    const payload = await fetchNewTokensPage(deployLoadedCount, nextLimit);
    const nextBatch = Array.isArray(payload?.tokens) ? payload.tokens : [];
    const payloadTotalCount = Number(payload?.totalCount ?? payload?.count24h);
    deployTotalCount = Number.isFinite(payloadTotalCount)
      ? Math.min(MAX_NEW_TOKEN_DISPLAY_TOKENS, Math.max(deployLoadedCount + nextBatch.length, payloadTotalCount))
      : Math.max(deployTotalCount, deployLoadedCount + nextBatch.length);
    if (nextBatch.length) {
      lastDeployTokens = mergeDeployTokenPages(lastDeployTokens, nextBatch);
      deployLoadedCount = lastDeployTokens.length;
      renderTokens(lastDeployTokens);
    }
  } catch (error) {
    console.error(error);
  } finally {
    deployLoadingMore = false;
    syncDeploySentinel();
  }
}

function initDeployLazyLoad() {
  if (!deployFeed || deployLazyObserver) {
    return;
  }

  deployLazyObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMoreDeployTokens().catch((error) => console.error(error));
    }
  }, {
    root: null,
    rootMargin: "800px 0px",
    threshold: 0
  });

  const sentinel = ensureDeployFeedSentinel();
  if (sentinel) {
    deployLazyObserver.observe(sentinel);
  }
}

async function fetchAiPicks() {
  if (activeHomepageChain === "base") {
    return fetchFeed("/api/base/ai-picks");
  }
  return fetchFeed("/api/ai-picks");
}

async function fetchMigratedAiPicks() {
  return fetchMigratedTokensPage(0, MAX_MIGRATED_LIVE_TOKENS);
}

async function fetchBaseTrendingRow() {
  return fetchFeed("/api/discover/base-trending-row");
}

async function fetchInitialMigratedAiPicks() {
  return fetchMigratedTokensPage(0, MAX_MIGRATED_LIVE_TOKENS);
}

async function refreshTokens() {
  const cachedTokens = readStoredHomepageTrendingTokens();
  if (cachedTokens.length && !lastDeployTokens.length) {
    lastDeployTokens = cachedTokens.slice(0, MAX_NEW_TOKEN_DISPLAY_TOKENS);
    deployLoadedCount = lastDeployTokens.length;
    deployTotalCount = lastDeployTokens.length;
    renderTokens(lastDeployTokens);
    if (deployStatus) {
      deployStatus.textContent = terminalHomeStatus("terminalHome.status.cached", lastDeployTokens.length, "Cached");
    }
  }

  try {
    const payload = await fetchTokens();
    const tokens = Array.isArray(payload?.tokens) ? payload.tokens.slice(0, MAX_NEW_TOKEN_DISPLAY_TOKENS) : [];
    const shouldKeepRenderedTokens = !tokens.length && lastDeployTokens.length;

    if (!shouldKeepRenderedTokens) {
      lastDeployTokens = mergeHomepageTrendingTokenLists(tokens, lastDeployTokens).slice(0, MAX_NEW_TOKEN_DISPLAY_TOKENS);
      deployLoadedCount = lastDeployTokens.length;
      deployTotalCount = lastDeployTokens.length;
      writeStoredHomepageTrendingTokens(lastDeployTokens);
      renderTokens(lastDeployTokens);
    }

    if (deployStatus) {
      deployStatus.textContent = shouldKeepRenderedTokens
        ? terminalHomeStatus("terminalHome.status.cached", lastDeployTokens.length, "Cached")
        : formatHomepageFeedStatus(payload?.status);
    }
  } catch (error) {
    if (lastDeployTokens.length) {
      renderTokens(lastDeployTokens);
      if (deployStatus) {
        deployStatus.textContent = terminalHomeStatus("terminalHome.status.cached", lastDeployTokens.length, "Cached");
      }
    } else if (deployStatus) {
      deployStatus.textContent = terminalHomeT("terminalHome.status.retrying", "Retrying...");
    }
    console.error(error);
  }
}

async function refreshAiPicks() {
  try {
    const payload = await fetchAiPicks();
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const storedTokens = readStoredAiPicks();
    const displayTokens = tokens.length ? tokens : storedTokens;
    const monitoringFromField = Number(payload?.monitoring);
    const monitoringFromStatusMatch = String(payload?.status || "").match(/monitoring\s*:\s*(\d+)/i);
    const monitoredCount = Number.isFinite(monitoringFromField) && monitoringFromField >= 0
      ? monitoringFromField
      : (monitoringFromStatusMatch ? Number(monitoringFromStatusMatch[1]) : NaN);
    if (tokens.length) {
      try {
        const storageKey = activeHomepageChain === "base"
          ? BASE_AI_PICKS_STORAGE_KEY
          : BSC_AI_PICKS_STORAGE_KEY;
        window.localStorage.setItem(storageKey, JSON.stringify({
          tokens,
          cachedAt: Date.now()
        }));
      } catch {
      }
    }
    renderAiPicks(displayTokens);
    processAiPickAlerts(displayTokens);
    if (aiPicksStatus) {
      aiPicksStatus.textContent = !tokens.length && storedTokens.length
        ? terminalHomeStatus("terminalHome.status.cached", storedTokens.length, "Cached")
        : Number.isFinite(monitoredCount)
        ? terminalHomeStatus("terminalHome.status.monitoring", monitoredCount, "Monitoring")
        : terminalHomeT("terminalHome.status.live", "Live");
    }
  } catch (error) {
    if (aiPicksStatus) {
      const storedTokens = readStoredAiPicks();
      if (storedTokens.length) {
        renderAiPicks(storedTokens);
        aiPicksStatus.textContent = terminalHomeStatus("terminalHome.status.cached", storedTokens.length, "Cached");
      } else {
        aiPicksStatus.textContent = terminalHomeT("terminalHome.status.retrying", "Retrying...");
      }
    }
    console.error(error);
  }
}

async function refreshMigratedAiPicks() {
  try {
    const payload = (!Array.isArray(migratedTokens24h) || !migratedTokens24h.length)
      ? await fetchInitialMigratedAiPicks()
      : await fetchMigratedAiPicks();
    const refreshedTokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const nextCount24h = Number(payload.count24h || 0);
    migratedCount24h = Number.isFinite(nextCount24h)
      ? Math.max(0, nextCount24h)
      : refreshedTokens.length;
    const nextTotalCount = Number(payload.totalCount);
    migratedTotalCount = Number.isFinite(nextTotalCount)
      ? Math.max(refreshedTokens.length, nextTotalCount)
      : Math.max(migratedTotalCount, refreshedTokens.length);
    if (refreshedTokens.length || !migratedTokens24h.length) {
      if (migratedLoadedCount > refreshedTokens.length) {
        migratedTokens24h = refreshedTokens.concat(migratedTokens24h.slice(refreshedTokens.length));
      } else {
        migratedTokens24h = refreshedTokens;
        migratedLoadedCount = refreshedTokens.length;
      }
    }
    renderMigratedFeed();
    if (migratedAiPicksStatus) {
      migratedAiPicksStatus.textContent = terminalHomeStatus("terminalHome.status.hours24", migratedCount24h, "24 HOURS");
    }
    if (migratedLoadedCount < migratedTotalCount) {
      loadMoreMigratedTokens().catch((error) => console.error(error));
    }
  } catch (error) {
    if (migratedAiPicksStatus) {
      migratedAiPicksStatus.textContent = migratedTokens24h.length
        ? terminalHomeStatus("terminalHome.status.cached", migratedTokens24h.length, "Cached")
        : "Retrying...";
    }
    console.error(error);
  }
}

function applyHomepageAiPicksPayload(payload) {
  const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
  const storedTokens = readStoredAiPicks();
  const displayTokens = tokens.length ? tokens : storedTokens;
  const monitoringFromField = Number(payload?.monitoring);
  const monitoringFromStatusMatch = String(payload?.status || "").match(/monitoring\s*:\s*(\d+)/i);
  const monitoredCount = Number.isFinite(monitoringFromField) && monitoringFromField >= 0
    ? monitoringFromField
    : (monitoringFromStatusMatch ? Number(monitoringFromStatusMatch[1]) : NaN);

  if (tokens.length) {
    try {
      const storageKey = activeHomepageChain === "base"
        ? BASE_AI_PICKS_STORAGE_KEY
        : BSC_AI_PICKS_STORAGE_KEY;
      window.localStorage.setItem(storageKey, JSON.stringify({
        tokens,
        cachedAt: Date.now()
      }));
    } catch {
    }
  }

  renderAiPicks(displayTokens);
  processAiPickAlerts(displayTokens);
  if (aiPicksStatus) {
    aiPicksStatus.textContent = !tokens.length && storedTokens.length
      ? terminalHomeStatus("terminalHome.status.cached", storedTokens.length, "Cached")
      : Number.isFinite(monitoredCount)
      ? terminalHomeStatus("terminalHome.status.monitoring", monitoredCount, "Monitoring")
      : terminalHomeT("terminalHome.status.live", "Live");
  }
}

function applyHomepageFeedSnapshot(snapshot) {
  if (!snapshot || snapshot.chain !== activeHomepageChain) {
    return;
  }

  const deployTokens = Array.isArray(snapshot.deploy?.tokens) ? snapshot.deploy.tokens : [];
  if (deployTokens.length) {
    writeStoredHomepageNewTokens(deployTokens.slice(0, MAX_NEW_TOKEN_DISPLAY_TOKENS));
  }



  applyHomepageAiPicksPayload(snapshot.aiPicks);

  const migratedPayload = snapshot.migrated || {};
  const migratedSourceTokens = Array.isArray(migratedPayload.allTokens)
    ? migratedPayload.allTokens
    : (Array.isArray(migratedPayload.tokens) ? migratedPayload.tokens : []);
  const nextCount24h = Number(migratedPayload.count24h || 0);
  migratedCount24h = Number.isFinite(nextCount24h)
    ? Math.max(0, nextCount24h)
    : migratedSourceTokens.length;
  const nextTotalCount = Number(migratedPayload.totalCount);
  migratedTotalCount = Number.isFinite(nextTotalCount)
    ? Math.max(migratedSourceTokens.length, nextTotalCount)
    : Math.max(migratedTotalCount, migratedSourceTokens.length);
  if (migratedSourceTokens.length || !migratedTokens24h.length) {
    migratedTokens24h = migratedSourceTokens;
    migratedLoadedCount = migratedSourceTokens.length;
  }
  renderMigratedFeed();
  if (migratedAiPicksStatus) {
    migratedAiPicksStatus.textContent = terminalHomeStatus("terminalHome.status.hours24", migratedCount24h, "24 HOURS");
  }
}

function startHomepageFeedStream() {
  if (!window.EventSource) {
    window.setInterval(() => {
      refreshTokens();
      refreshAiPicks();
      refreshMigratedAiPicks();
    }, HOMEPAGE_FEED_FALLBACK_REFRESH_MS);
    return;
  }

  const source = new EventSource(`/api/feed/stream?scope=homepage&chain=${encodeURIComponent(activeHomepageChain)}`);
  let streamOpen = false;
  source.addEventListener("open", () => {
    streamOpen = true;
  });
  source.addEventListener("snapshot", (event) => {
    streamOpen = true;
    try {
      applyHomepageFeedSnapshot(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });
  source.addEventListener("error", () => {
    streamOpen = false;
  });

  const fallbackTimer = window.setInterval(() => {
    if (streamOpen) {
      return;
    }
    refreshTokens();
    refreshAiPicks();
    refreshMigratedAiPicks();
  }, HOMEPAGE_FEED_FALLBACK_REFRESH_MS);

  window.addEventListener("beforeunload", () => {
    window.clearInterval(fallbackTimer);
    source.close();
  });
}

function startHomepageAgeTicker() {
  window.setInterval(() => {
    updateRenderedTokenAges(deployFeed, lastDeployTokens);
  }, 1000);
}

refreshTokens();
refreshAiPicks();
refreshMigratedAiPicks();
initDeployLazyLoad();
initMigratedLazyLoad();
fetchUserBuyOneAmount();
startAiAlertsPolling();
startHomepageFeedStream();
window.setInterval(() => {
  refreshTokens();
}, HOMEPAGE_TRENDING_REFRESH_MS);
startHomepageAgeTicker();
syncSettingsAccess();
applyTheme(readTheme());

const alertPrefs = readAlertPrefs();
if (alertAiPicksToggle) {
  alertAiPicksToggle.checked = Boolean(alertPrefs.aiPicks);
  alertAiPicksToggle.addEventListener("change", () => {
    if (alertAiPicksToggle.checked) {
      requestBrowserNotificationPermission();
    }
    saveAlertPrefs({
      ...readAlertPrefs(),
      aiPicks: alertAiPicksToggle.checked
    });
  });
}

if (alertMigratedPicksToggle) {
  alertMigratedPicksToggle.checked = Boolean(alertPrefs.migratedPicks);
  alertMigratedPicksToggle.addEventListener("change", () => {
    if (alertMigratedPicksToggle.checked) {
      requestBrowserNotificationPermission();
    }
    saveAlertPrefs({
      ...readAlertPrefs(),
      migratedPicks: alertMigratedPicksToggle.checked
    });
  });
}

window.addEventListener("pointerdown", unlockAlertAudio, { once: true });
window.addEventListener("keydown", unlockAlertAudio, { once: true });

document.addEventListener("click", (event) => {
  const disabledSettingsTrigger = event.target.closest(".settings-trigger.is-disabled");
  if (disabledSettingsTrigger) {
    event.preventDefault();
  }
});

window.addEventListener("sparta:wallet-session-changed", () => {
  syncSettingsAccess();
  fetchUserBuyOneAmount();
  startAiAlertsPolling();
});

themeToggle?.addEventListener("click", () => {
  saveTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

mobileRowTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveMobileRow(tab.dataset.mobileRowTab);
  });
});
setActiveMobileRow("ai-picks");

highFeeWarnBackdrop?.addEventListener("click", closeHighFeeWarnModal);
highFeeWarnCancel?.addEventListener("click", closeHighFeeWarnModal);
highFeeWarnAccept?.addEventListener("click", async () => {
  if (highFeeWarnSkip) {
    saveSkipHighFeeWarn(highFeeWarnSkip.checked);
  }
  const token = pendingBuyToken;
  closeHighFeeWarnModal();
  if (readSkipBuyConfirm()) {
    await proceedWithBuy(token);
    return;
  }
  openBuyConfirmModal(token);
});
buyConfirmBackdrop?.addEventListener("click", closeBuyConfirmModal);
buyConfirmCancel?.addEventListener("click", closeBuyConfirmModal);
buyResultBackdrop?.addEventListener("click", closeBuyResultModal);
buyResultClose?.addEventListener("click", closeBuyResultModal);
buyConfirmAccept?.addEventListener("click", async () => {
  if (buyConfirmSkip) {
    saveSkipBuyConfirm(buyConfirmSkip.checked);
  }
  const token = pendingBuyToken;
  closeBuyConfirmModal();
  await proceedWithBuy(token);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && highFeeWarnModal && !highFeeWarnModal.hidden) {
    closeHighFeeWarnModal();
  }
  if (event.key === "Escape" && buyConfirmModal && !buyConfirmModal.hidden) {
    closeBuyConfirmModal();
  }
  if (event.key === "Escape" && buyResultModal && !buyResultModal.hidden) {
    closeBuyResultModal();
  }
});

function bindFeedInteractions(feed, fetchFeedPayload) {
  feed?.addEventListener("mouseover", (event) => {
    const card = event.target.closest(".token-card-link");
    if (!card || !feed.contains(card)) {
      return;
    }
    prefetchChartFromCard(card);
  });

  feed?.addEventListener("mousedown", (event) => {
    const card = event.target.closest(".token-card-link");
    if (!card || !feed.contains(card)) {
      return;
    }
    prefetchChartFromCard(card);
  });

  feed?.addEventListener("click", async (event) => {
  const buyButton = event.target.closest(".token-buy-button");
  if (buyButton) {
    event.preventDefault();
    event.stopPropagation();
    if (buyButton.disabled || buyButton.closest(".token-card-link")?.dataset.tokenBuyDisabled === "true") {
      return;
    }

    const card = buyButton.closest(".token-card-link");
    const tokenAddress = card?.dataset.tokenAddress?.toLowerCase();
    if (!tokenAddress) {
      return;
    }

    const payload = await fetchFeedPayload().catch(() => ({ tokens: [] }));
    const token = (payload.tokens || []).find((entry) => entry.address === tokenAddress) || { address: tokenAddress };
    if (isHomepageHighFee() && !readSkipHighFeeWarn()) {
      openHighFeeWarnModal(token);
    } else if (readSkipBuyConfirm()) {
      void proceedWithBuy(token);
    } else {
      openBuyConfirmModal(token);
    }
    return;
  }

  const trigger = event.target.closest("[data-copy-address]");
  if (!trigger) {
  } else {
    const { copyAddress } = trigger.dataset;
    if (!copyAddress) {
      return;
    }

    try {
      const copied = await copyText(copyAddress);
      if (!copied) {
        return;
      }
      trigger.textContent = terminalHomeT("terminalHome.actions.copied", "Copied");
      window.setTimeout(() => {
        trigger.textContent = shortAddress(copyAddress);
      }, 1200);
    } catch (error) {
      console.error(error);
    }

    return;
  }

  const card = event.target.closest(".token-card-link");
  if (!card) {
    return;
  }

  const tokenAddress = card.dataset.tokenAddress?.toLowerCase();
  if (!tokenAddress) {
    return;
  }
  openTokenDetail(readSelectedTokenFromCard(card) || { address: tokenAddress });
  });
}

bindFeedInteractions(deployFeed, fetchTokens);
bindFeedInteractions(aiPicksFeed, fetchAiPicks);
bindFeedInteractions(migratedAiPicksFeed, fetchCachedMigratedTokensPayload);
