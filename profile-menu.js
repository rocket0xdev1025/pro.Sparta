(() => {
  const SPARTA_WALLET_SESSION_KEY = "spartaWalletSession";
  const SPARTA_PROFILE_KEY = "spartaProfileDraft";
  const SPARTA_TOUR_STATE_KEY = "sparta-tour-state-v1";
  const SPARTA_THEME_KEY = "spartaTheme";
  const SPARTA_DARK_PALETTE_KEY = "spartaDarkPalette";
  const CSRF_COOKIE_NAME = "sparta_csrf";
  const CSRF_HEADER_NAME = "x-csrf-token";
  const WALLETCONNECT_PROJECT_ID = "";
  const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const BSC_AI_PICKS_STORAGE_KEY = "spartaBscAiPicksCache";
  const SOL_AI_PICKS_STORAGE_KEY = "spartaSolAiPicksCache";
  let spartaServerAuthRetryPromise = null;
  const CLEAN_ROUTE_PAGES = new Set([
    "discover",
    "settings",
    "trade",
    "launch",
    "copytrade",
    "ai-trading",
    "spam",
    "keyword",
    "orders",
    "situation-room",
    "events",
    "stats",
    "points",
    "wallets",
    "transfer",
    "bridge",
  ]);

  function normalizeDarkPalette(value) {
    return String(value || "")
      .trim()
      .toLowerCase() === "legacy"
      ? "legacy"
      : "neutral";
  }

  function applyDarkPalettePreference() {
    if (!document?.body) {
      return "neutral";
    }
    const palette = normalizeDarkPalette(
      window.localStorage.getItem(SPARTA_DARK_PALETTE_KEY)
    );
    document.body.dataset.darkPalette = palette;
    return palette;
  }

  function setDarkPalettePreference(palette) {
    const normalizedPalette = normalizeDarkPalette(palette);
    window.localStorage.setItem(SPARTA_DARK_PALETTE_KEY, normalizedPalette);
    if (document?.body) {
      document.body.dataset.darkPalette = normalizedPalette;
    }
    return normalizedPalette;
  }

  applyDarkPalettePreference();

  window.SpartaAppearance = {
    getDarkPalette: () =>
      normalizeDarkPalette(
        window.localStorage.getItem(SPARTA_DARK_PALETTE_KEY)
      ),
    setDarkPalette: setDarkPalettePreference,
  };

  function readCookieValue(name) {
    const targetName = String(name || "").trim();
    if (!targetName) {
      return "";
    }
    const cookies = String(document.cookie || "").split(";");
    for (const entry of cookies) {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      const cookieName =
        separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
      if (cookieName !== targetName) {
        continue;
      }
      const rawValue =
        separatorIndex === -1 ? "" : trimmed.slice(separatorIndex + 1);
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
    return "";
  }

  function resolveFetchMethod(input, init) {
    const requestMethod = String(init?.method || "").trim();
    if (requestMethod) {
      return requestMethod.toUpperCase();
    }
    if (input instanceof Request) {
      return (
        String(input.method || "GET")
          .trim()
          .toUpperCase() || "GET"
      );
    }
    return "GET";
  }

  function isSameOriginFetchTarget(input) {
    try {
      const requestUrl =
        input instanceof Request
          ? new URL(input.url, window.location.origin)
          : new URL(String(input || ""), window.location.origin);
      return requestUrl.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function getSameOriginFetchPathname(input) {
    try {
      const requestUrl =
        input instanceof Request
          ? new URL(input.url, window.location.origin)
          : new URL(String(input || ""), window.location.origin);
      return requestUrl.origin === window.location.origin
        ? requestUrl.pathname
        : "";
    } catch {
      return "";
    }
  }

  async function isMissingAuthResponse(response) {
    if (!response || response.status !== 401) {
      return false;
    }
    try {
      const payload = await response.clone().json();
      const status = String(payload?.status || payload?.error || "")
        .trim()
        .toLowerCase();
      return status === "missing_auth";
    } catch {
      return false;
    }
  }

  function shouldRetryFetchAfterAuth(input) {
    const pathname = getSameOriginFetchPathname(input);
    if (
      !pathname ||
      !pathname.startsWith("/api/") ||
      pathname.startsWith("/api/auth/")
    ) {
      return false;
    }
    return Boolean(readWalletSession()?.address);
  }

  function withCsrfFetchInit(input, init) {
    const method = resolveFetchMethod(input, init);
    if (
      !STATE_CHANGING_METHODS.has(method) ||
      !isSameOriginFetchTarget(input)
    ) {
      return init;
    }

    const csrfToken = String(readCookieValue(CSRF_COOKIE_NAME) || "").trim();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (csrfToken && !headers.has(CSRF_HEADER_NAME)) {
      headers.set(CSRF_HEADER_NAME, csrfToken);
    }

    const nextInit = {
      ...(init || {}),
      headers,
    };

    if (!("credentials" in nextInit)) {
      const requestCredentials =
        input instanceof Request ? String(input.credentials || "") : "";
      nextInit.credentials = requestCredentials || "same-origin";
    }

    return nextInit;
  }

  function installCsrfFetchProtection() {
    if (window.__spartaFetchWrapped || typeof window.fetch !== "function") {
      return;
    }
    window.__spartaFetchWrapped = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const firstInit = withCsrfFetchInit(input, init);
      const response = await nativeFetch(input, firstInit);
      if (
        !shouldRetryFetchAfterAuth(input) ||
        !(await isMissingAuthResponse(response))
      ) {
        return response;
      }

      try {
        if (!spartaServerAuthRetryPromise) {
          spartaServerAuthRetryPromise = ensureServerAuth({
            interactive: true,
          }).finally(() => {
            spartaServerAuthRetryPromise = null;
          });
        }
        await spartaServerAuthRetryPromise;
      } catch (error) {
        if (
          String(error?.message || "")
            .trim()
            .toLowerCase() === "not_whitelisted"
        ) {
          return new Response(
            JSON.stringify({
              status: "not_whitelisted",
              error: "not_whitelisted",
            }),
            {
              status: 403,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
              },
            }
          );
        }
        return response;
      }

      return nativeFetch(input, withCsrfFetchInit(input, init));
    };
  }

  function normalizeChain(chain) {
    const normalized = String(chain || "")
      .trim()
      .toLowerCase();
    if (normalized === "sol") {
      return "sol";
    }
    if (normalized === "eth") {
      return "eth";
    }
    if (normalized === "base") {
      return "base";
    }
    return "bsc";
  }

  const chartPrefetchInFlight = new Map();
  const chartPrefetchQueue = [];
  let activeChartPrefetchCount = 0;
  const MAX_CHART_PREFETCH_CONCURRENCY = 3;

  function runQueuedChartPrefetches() {
    while (
      activeChartPrefetchCount < MAX_CHART_PREFETCH_CONCURRENCY &&
      chartPrefetchQueue.length
    ) {
      const queued = chartPrefetchQueue.shift();
      activeChartPrefetchCount += 1;
      queued()
        .catch(() => null)
        .finally(() => {
          activeChartPrefetchCount = Math.max(0, activeChartPrefetchCount - 1);
          runQueuedChartPrefetches();
        });
    }
  }

  function enqueueChartPrefetch(task) {
    const request = new Promise((resolve) => {
      chartPrefetchQueue.push(() => task().then(resolve, () => resolve(null)));
      runQueuedChartPrefetches();
    });
    return request;
  }

  function prefetchTokenChart(
    address,
    chain = "bsc",
    { timeframe = "minute", aggregate = 5, limit = 500 } = {}
  ) {
    const normalizedChain = normalizeChain(chain);
    const rawAddress = String(address || "").trim();
    const normalizedAddress =
      normalizedChain === "sol" ? rawAddress : rawAddress.toLowerCase();
    if (!normalizedAddress) {
      return null;
    }

    const cacheKey = [
      normalizedChain,
      normalizedAddress,
      String(timeframe || "minute"),
      String(Number(aggregate || 5)),
      String(Number(limit || 500)),
    ].join(":");
    const existing = chartPrefetchInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const request = enqueueChartPrefetch(() =>
      fetch(
        `/api/token/chart?address=${encodeURIComponent(
          normalizedAddress
        )}&chain=${encodeURIComponent(
          normalizedChain
        )}&timeframe=${encodeURIComponent(
          timeframe
        )}&aggregate=${encodeURIComponent(
          aggregate
        )}&limit=${encodeURIComponent(limit)}`,
        { cache: "no-store" }
      ).catch(() => null)
    ).finally(() => {
      chartPrefetchInFlight.delete(cacheKey);
    });

    chartPrefetchInFlight.set(cacheKey, request);
    return request;
  }

  window.SpartaChartPrefetch = {
    prefetchTokenChart,
  };

  function getHomeHref(chain = "bsc") {
    const normalizedChain = normalizeChain(chain);
    return normalizedChain === "sol"
      ? "/sol"
      : normalizedChain === "eth"
      ? "/eth"
      : normalizedChain === "base"
      ? "/base"
      : "/";
  }

  function getAiPicksStorageKey(chain = "bsc") {
    return normalizeChain(chain) === "sol"
      ? SOL_AI_PICKS_STORAGE_KEY
      : BSC_AI_PICKS_STORAGE_KEY;
  }

  const ETH_TRENDING_STORAGE_KEY = "spartaEthTrendingCache";
  const DEFAULT_BSC_TRADE_TOKEN_ADDRESS =
    "0xb2acf3ae051c7f0b0b8de90cbb4ed99312574444";
  const DEFAULT_ETH_TRADE_TOKEN_ADDRESS =
    "0x6982508145454ce325ddbe47a25d4ec3d2311933";
  const DEFAULT_SOL_TRADE_TOKEN_ADDRESS =
    "So11111111111111111111111111111111111111112";

  function getTopEthTrendingTokenHref() {
    try {
      const raw = window.localStorage.getItem(ETH_TRENDING_STORAGE_KEY);
      if (!raw) {
        return "";
      }

      const parsed = JSON.parse(raw);
      const tokens = Array.isArray(parsed?.tokens) ? parsed.tokens : [];
      const topToken = tokens
        .map((token) => ({
          address: String(token?.address || token?.tokenAddress || "")
            .trim()
            .toLowerCase(),
          marketCapUsd: Number(token?.marketCapUsd),
        }))
        .filter((token) => token.address)
        .sort((left, right) => {
          const rightMarketCap = Number.isFinite(right.marketCapUsd)
            ? right.marketCapUsd
            : -Infinity;
          const leftMarketCap = Number.isFinite(left.marketCapUsd)
            ? left.marketCapUsd
            : -Infinity;
          return rightMarketCap - leftMarketCap;
        })[0];

      return topToken?.address ? getTokenHref(topToken.address, "eth") : "";
    } catch {
      return "";
    }
  }

  function getTopAiPickTokenHref(chain = "bsc") {
    const normalizedChain = normalizeChain(chain);
    try {
      const raw = window.localStorage.getItem(
        getAiPicksStorageKey(normalizedChain)
      );
      if (!raw) {
        return "";
      }

      const parsed = JSON.parse(raw);
      const tokens = Array.isArray(parsed?.tokens) ? parsed.tokens : [];
      const topToken = tokens
        .map((token) => {
          const rawAddress = String(
            token?.address || token?.tokenAddress || ""
          ).trim();
          return {
            address:
              normalizedChain === "sol" ? rawAddress : rawAddress.toLowerCase(),
            marketCapUsd: Number(token?.marketCapUsd),
          };
        })
        .filter((token) => token.address)
        .sort((left, right) => {
          const rightMarketCap = Number.isFinite(right.marketCapUsd)
            ? right.marketCapUsd
            : -Infinity;
          const leftMarketCap = Number.isFinite(left.marketCapUsd)
            ? left.marketCapUsd
            : -Infinity;
          return rightMarketCap - leftMarketCap;
        })[0];

      return topToken?.address
        ? getTokenHref(topToken.address, normalizedChain)
        : "";
    } catch {
      return "";
    }
  }

  function getPageHref(page, chain = "bsc") {
    const activeChain = normalizeChain(chain);
    switch (page) {
      case "home":
        return getHomeHref(activeChain);
      case "discover":
        return activeChain === "sol"
          ? "/sol/discover"
          : activeChain === "eth"
          ? "/eth/discover"
          : activeChain === "base"
          ? "/base/discover"
          : "/bsc/discover";
      case "settings":
        return activeChain === "sol"
          ? "/sol/settings"
          : activeChain === "eth"
          ? "/eth/settings"
          : activeChain === "base"
          ? "/base/settings"
          : "/bsc/settings";
      case "trade":
        if (activeChain === "base") {
          return "/base";
        }
        if (activeChain === "eth") {
          return getTokenHref(DEFAULT_ETH_TRADE_TOKEN_ADDRESS, "eth");
        }
        return (
          getTopAiPickTokenHref(activeChain) ||
          getTokenHref(
            activeChain === "sol"
              ? DEFAULT_SOL_TRADE_TOKEN_ADDRESS
              : DEFAULT_BSC_TRADE_TOKEN_ADDRESS,
            activeChain
          )
        );
      case "launch":
        return activeChain === "sol"
          ? "/sol/launch"
          : activeChain === "eth" || activeChain === "base"
          ? getHomeHref(activeChain)
          : "/bsc/launch";
      case "copytrade":
        return activeChain === "sol"
          ? "/sol/copytrade"
          : activeChain === "eth"
          ? "/eth/copytrade"
          : activeChain === "base"
          ? "/base/copytrade"
          : "/bsc/copytrade";
      case "ai-trading":
        return activeChain === "sol"
          ? "/sol/ai-trading"
          : activeChain === "eth"
          ? "/eth/ai-trading"
          : activeChain === "base"
          ? "/base/ai-trading"
          : "/bsc/ai-trading";
      case "spam":
        return activeChain === "eth"
          ? "/eth/spam"
          : activeChain === "base"
          ? "/base/spam"
          : getHomeHref(activeChain);
      case "keyword":
        return activeChain === "sol"
          ? "/sol/keyword"
          : activeChain === "base"
          ? "/base/keyword"
          : activeChain === "eth"
          ? "/eth/keyword"
          : "/bsc/keyword";
      case "orders":
        return activeChain === "sol"
          ? "/sol/orders"
          : activeChain === "eth"
          ? "/eth/orders"
          : activeChain === "base"
          ? "/base/orders"
          : "/bsc/orders";
      case "situation-room":
        return activeChain === "sol"
          ? "/sol/situation-room"
          : activeChain === "base"
          ? "/base/situation-room"
          : activeChain === "eth"
          ? getHomeHref(activeChain)
          : "/bsc/situation-room";
      case "events":
        return activeChain === "sol"
          ? "/sol/events"
          : activeChain === "base"
          ? "/base/events"
          : activeChain === "eth"
          ? getHomeHref(activeChain)
          : "/bsc/events";
      case "stats":
        return activeChain === "sol"
          ? "/sol/stats"
          : activeChain === "eth"
          ? "/eth/stats"
          : activeChain === "base"
          ? "/base/stats"
          : "/bsc/stats";
      case "points":
        return activeChain === "sol"
          ? "/sol/points"
          : activeChain === "eth"
          ? "/eth/points"
          : activeChain === "base"
          ? "/base/points"
          : "/points";
      case "referral":
        return activeChain === "sol"
          ? "/sol/referral"
          : activeChain === "eth"
          ? "/eth/referral"
          : activeChain === "base"
          ? "/base/referral"
          : "/referral";
      case "wallets":
        return activeChain === "sol"
          ? "/sol/wallets"
          : activeChain === "eth"
          ? "/eth/wallets"
          : activeChain === "base"
          ? "/base/wallets"
          : "/wallets";
      case "transfer":
        return activeChain === "sol"
          ? "/sol/transfer"
          : activeChain === "eth"
          ? "/eth/transfer"
          : activeChain === "base"
          ? "/base/transfer"
          : "/transfer";
      case "bridge":
        return activeChain === "sol"
          ? "/sol/bridge"
          : activeChain === "eth"
          ? "/eth/bridge"
          : activeChain === "base"
          ? "/base/bridge"
          : "/bsc/bridge";
      case "privacy-policy":
        return "/privacy-policy";
      case "terms-of-service":
        return "/terms-of-service";
      default:
        return getHomeHref(activeChain);
    }
  }

  function getTokenHref(address, chain = "bsc") {
    const trimmed = String(address || "").trim();
    if (!trimmed) {
      return getHomeHref(chain);
    }
    return normalizeChain(chain) === "sol"
      ? `/sol/${encodeURIComponent(trimmed)}`
      : normalizeChain(chain) === "eth"
      ? `/eth/${encodeURIComponent(trimmed.toLowerCase())}`
      : normalizeChain(chain) === "base"
      ? `/base/${encodeURIComponent(trimmed.toLowerCase())}`
      : `/bsc/${encodeURIComponent(trimmed.toLowerCase())}`;
  }

  function readWalletSession() {
    try {
      return JSON.parse(
        window.localStorage.getItem(SPARTA_WALLET_SESSION_KEY) || "null"
      );
    } catch {
      return null;
    }
  }

  function writeWalletSession(walletType, address) {
    const session = {
      walletType,
      address,
      connectedAt: Date.now(),
    };
    window.localStorage.setItem(
      SPARTA_WALLET_SESSION_KEY,
      JSON.stringify(session)
    );
    window.dispatchEvent(
      new CustomEvent("sparta:wallet-session-changed", { detail: { session } })
    );
    return session;
  }

  function clearWalletSession() {
    window.localStorage.removeItem(SPARTA_WALLET_SESSION_KEY);
    window.dispatchEvent(
      new CustomEvent("sparta:wallet-session-changed", {
        detail: { session: null },
      })
    );
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }

  function getActivePageChain() {
    const params = new URLSearchParams(window.location.search);
    const requestedChain = String(params.get("chain") || "")
      .trim()
      .toLowerCase();
    if (requestedChain === "eth") {
      return "eth";
    }
    if (requestedChain === "base") {
      return "base";
    }
    if (requestedChain === "sol") {
      return "sol";
    }
    if (requestedChain === "bsc") {
      return "bsc";
    }

    const pathname = String(window.location.pathname || "").toLowerCase();
    if (
      pathname === "/base" ||
      pathname.startsWith("/base/") ||
      pathname.endsWith("/base.html") ||
      pathname.endsWith("base.html")
    ) {
      return "base";
    }
    if (
      pathname === "/eth" ||
      pathname.startsWith("/eth/") ||
      pathname.endsWith("/eth.html") ||
      pathname.endsWith("eth.html")
    ) {
      return "eth";
    }
    if (
      pathname === "/sol" ||
      pathname.startsWith("/sol/") ||
      pathname.endsWith("/solana.html") ||
      pathname.endsWith("solana.html")
    ) {
      return "sol";
    }
    return "bsc";
  }

  function getChainAwareHref(pathname) {
    const activeChain = getActivePageChain();
    const normalized = String(pathname || "").trim();
    switch (normalized) {
      case "./discover.html":
        return getPageHref("discover", activeChain);
      case "./settings.html":
        return getPageHref("settings", activeChain);
      case "./trade.html":
        return getPageHref("trade", activeChain);
      case "./launch.html":
        return getPageHref("launch", activeChain);
      case "./copytrade.html":
        return getPageHref("copytrade", activeChain);
      case "./ai-trading.html":
        return getPageHref("ai-trading", activeChain);
      case "./keyword.html":
        return getPageHref("keyword", activeChain);
      case "./orders.html":
        return getPageHref("orders", activeChain);
      case "./situation-room.html":
        return getPageHref("situation-room", activeChain);
      case "./events.html":
        return getPageHref("events", activeChain);
      case "./stats.html":
        return getPageHref("stats", activeChain);
      case "./points.html":
        return getPageHref("points", activeChain);
      case "./referral.html":
        return getPageHref("referral", activeChain);
      case "./wallets.html":
        return getPageHref("wallets", activeChain);
      case "./transfer.html":
        return getPageHref("transfer", activeChain);
      case "./bridge.html":
        return getPageHref("bridge", activeChain);
      case "./index.html":
        return getPageHref("home", activeChain);
      case "./privacy-policy.html":
        return getPageHref("privacy-policy", activeChain);
      case "./terms-of-service.html":
        return getPageHref("terms-of-service", activeChain);
      default:
        return activeChain === "sol" || activeChain === "base"
          ? `${pathname}?chain=${activeChain}`
          : pathname;
    }
  }

  window.SpartaRoutes = {
    CLEAN_ROUTE_PAGES,
    normalizeChain,
    getActivePageChain,
    getHomeHref,
    getPageHref,
    getTokenHref,
    getChainAwareHref,
  };

  function syncChainAwarePageLinks() {
    const activeChain = getActivePageChain();
    document.querySelectorAll("[data-sparta-page]").forEach((link) => {
      const page = String(link.dataset.spartaPage || "").trim();
      if (!page) {
        return;
      }
      link.href = getPageHref(page, activeChain);
    });
  }

  function getActivePageName() {
    const pathname = String(window.location.pathname || "").toLowerCase();
    if (
      pathname === "/" ||
      pathname === "/sol" ||
      pathname.endsWith("/index.html") ||
      pathname.endsWith("/solana.html")
    ) {
      return "home";
    }

    const cleanPath = pathname.replace(/\/+$/, "");
    const segments = cleanPath.split("/").filter(Boolean);
    if (!segments.length) {
      return "home";
    }

    const lastSegment = segments[segments.length - 1];
    if (
      lastSegment === "bsc" ||
      lastSegment === "sol" ||
      lastSegment === "eth" ||
      lastSegment === "base"
    ) {
      return "home";
    }

    return lastSegment;
  }

  function buildDesktopMoreMenuMarkup(chain) {
    const moreLinks = [
      ...(chain === "eth" ? [{ page: "copytrade", label: "Copy Trade" }] : []),
      { page: "keyword", label: "KeyWord Trading" },
      { page: "transfer", label: "Transfer" },
      { page: "situation-room", label: "Situation Room" },
      { page: "events", label: "Events" },
      { page: "bridge", label: "Bridge" },
    ];

    return moreLinks
      .map((item) => {
        if (item.page) {
          return `<a class="more-link" data-sparta-page="${
            item.page
          }" href="${escapeHtml(getPageHref(item.page, chain))}">${escapeHtml(
            item.label
          )}</a>`;
        }
        return `<a class="more-link" href="${escapeHtml(
          item.href
        )}">${escapeHtml(item.label)}</a>`;
      })
      .join("");
  }

  function buildMobileTopbarMarkup(chain) {
    const isSol = chain === "sol";
    const isEth = chain === "eth";
    const isBase = chain === "base";
    const homeHref = getHomeHref(chain);

    return `
    <div class="mobile-topbar-left">
      <a class="mobile-topbar-home" href="${escapeHtml(
        homeHref
      )}" aria-label="Go to Sparta home">
        <img class="mobile-topbar-home-image" src="/spartaicon.png" alt="" />
      </a>
      <details class="mobile-nav-menu">
        <summary class="mobile-nav-summary" aria-label="Open navigation menu">
          <span></span>
          <span></span>
          <span></span>
        </summary>
        <div class="mobile-nav-dropdown" aria-label="Mobile navigation">
          <div class="mobile-nav-links">
            <a class="more-link" data-sparta-page="discover" href="${escapeHtml(
              getPageHref("discover", chain)
            )}">Discover</a>
            <a class="more-link" data-sparta-page="trade" href="${escapeHtml(
              getPageHref("trade", chain)
            )}">Trade</a>
            ${
              chain === "eth"
                ? ""
                : `<a class="more-link" data-sparta-page="copytrade" href="${escapeHtml(
                    getPageHref("copytrade", chain)
                  )}">Copy Trade</a>`
            }
            <a class="more-link" data-sparta-page="ai-trading" href="${escapeHtml(
              getPageHref("ai-trading", chain)
            )}">AI Trading</a>
            ${
              chain === "eth" || chain === "base"
                ? `<a class="more-link" data-sparta-page="spam" href="${escapeHtml(
                    getPageHref("spam", chain)
                  )}">Spam</a>`
                : ""
            }
            <details class="mobile-submenu">
              <summary class="mobile-submenu-summary">More</summary>
              <div class="mobile-nav-more-list">
                ${
                  chain === "eth"
                    ? `<a class="more-link" data-sparta-page="copytrade" href="${escapeHtml(
                        getPageHref("copytrade", chain)
                      )}">Copy Trade</a>`
                    : ""
                }
                <a class="more-link" data-sparta-page="transfer" href="${escapeHtml(
                  getPageHref("transfer", chain)
                )}">Transfer</a>
                <a class="more-link" data-sparta-page="situation-room" href="${escapeHtml(
                  getPageHref("situation-room", chain)
                )}">Situation Room</a>
                <a class="more-link" data-sparta-page="events" href="${escapeHtml(
                  getPageHref("events", chain)
                )}">Events</a>
                <a class="more-link" data-sparta-page="stats" href="${escapeHtml(
                  getPageHref("stats", chain)
                )}">Stats</a>
                <a class="more-link" data-sparta-page="bridge" href="${escapeHtml(
                  getPageHref("bridge", chain)
                )}">Bridge</a>
                <a class="more-link" data-sparta-page="points" href="${escapeHtml(
                  getPageHref("points", chain)
                )}">Points</a>
              </div>
            </details>
          </div>
        </div>
      </details>
      <details class="mobile-chain-menu">
        <summary class="mobile-chain-summary">${escapeHtml(
          isSol ? "SOL" : isEth ? "ETH" : isBase ? "BASE" : "BNB"
        )}</summary>
        <div class="mobile-chain-dropdown" aria-label="Mobile chain selector">
          <a class="network-pill${
            !isSol && !isEth && !isBase ? " is-active" : ""
          }" href="/"${
      !isSol && !isEth && !isBase ? ' aria-current="page"' : ""
    }>BNB</a>
          <a class="network-pill${isSol ? " is-active" : ""}" href="/sol"${
      isSol ? ' aria-current="page"' : ""
    }>SOL</a>
          <a class="network-pill${isEth ? " is-active" : ""}" href="/eth"${
      isEth ? ' aria-current="page"' : ""
    }>ETH</a>
          <a class="network-pill${isBase ? " is-active" : ""}" href="/base"${
      isBase ? ' aria-current="page"' : ""
    }>BASE</a>
        </div>
      </details>
    </div>
  `;
  }

  function normalizeDesktopHeader(topbar, chain, activePage) {
    const actions = topbar.querySelector(".hero-actions.hero-actions-topbar");
    if (!actions) {
      return;
    }

    const requiredPrimaryLinks = [
      { page: "discover", label: "Discover" },
      { page: "trade", label: "Trade" },
      ...(chain === "eth" ? [] : [{ page: "copytrade", label: "Copy Trade" }]),
      { page: "ai-trading", label: "AI Trading" },
      ...(chain === "eth" || chain === "base"
        ? [{ page: "spam", label: "Spam" }]
        : []),
    ];
    const moreMenu = actions.querySelector(".more-menu");
    if (chain === "eth") {
      Array.from(actions.querySelectorAll("a.settings-trigger")).forEach(
        (candidate) => {
          const href = String(
            candidate.getAttribute("href") || ""
          ).toLowerCase();
          const text = String(candidate.textContent || "")
            .trim()
            .toLowerCase();
          if (
            candidate.dataset.spartaPage === "copytrade" ||
            candidate.id === "copytrade-trigger" ||
            candidate.id === "copytrade-self-link" ||
            text === "copy trade" ||
            href.includes("/copytrade")
          ) {
            candidate.remove();
          }
        }
      );
    }

    for (const { page, label } of requiredPrimaryLinks) {
      const candidates = Array.from(
        actions.querySelectorAll("a.settings-trigger")
      ).filter((candidate) => {
        const href = String(candidate.getAttribute("href") || "").toLowerCase();
        const text = String(candidate.textContent || "")
          .trim()
          .toLowerCase();
        if (candidate.dataset.spartaPage === page) {
          return true;
        }
        if (page === "copytrade" && candidate.id === "copytrade-trigger") {
          return true;
        }
        if (
          page === "ai-trading" &&
          (candidate.id === "token-ai-trading-link" ||
            candidate.id === "ai-trading-trigger")
        ) {
          return true;
        }
        if (text === label.toLowerCase()) {
          return true;
        }
        return href.includes(`/${page}`);
      });
      let link = candidates[0] || null;
      candidates.slice(1).forEach((duplicate) => duplicate.remove());
      if (!link) {
        link =
          Array.from(actions.querySelectorAll("a.settings-trigger")).find(
            (candidate) => {
              const href = String(
                candidate.getAttribute("href") || ""
              ).toLowerCase();
              return href.includes(`/${page}`);
            }
          ) || null;
      }

      if (!link) {
        link = document.createElement("a");
        link.className = "settings-trigger";
        if (page === "copytrade") {
          link.id = "copytrade-trigger";
        }
        if (moreMenu) {
          actions.insertBefore(link, moreMenu);
        } else {
          actions.appendChild(link);
        }
      }

      link.className = "settings-trigger";
      link.dataset.spartaPage = page;
      link.href = getPageHref(page, chain);
      link.textContent = label;
      if (page === activePage) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }

    let menu = moreMenu;
    if (!menu) {
      menu = document.createElement("details");
      menu.className = "more-menu";
      menu.innerHTML = `
      <summary class="settings-trigger more-summary">More</summary>
      <div class="more-dropdown" aria-label="More links"></div>
    `;
      actions.appendChild(menu);
    }

    const moreDropdown = menu.querySelector(".more-dropdown");
    if (moreDropdown) {
      moreDropdown.innerHTML = buildDesktopMoreMenuMarkup(chain);
    }
  }

  function normalizeUtilityHeader(topbar, chain) {
    const utility = topbar.querySelector(".hero-utility");
    if (!utility) {
      return;
    }

    const profileMenu = utility.querySelector(".wallet-menu");
    const themeToggle = utility.querySelector(".theme-toggle");
    const referenceNode = themeToggle || profileMenu || null;

    if (!utility.querySelector(".alert-menu")) {
      const alertMenu = document.createElement("details");
      alertMenu.className = "alert-menu";
      alertMenu.innerHTML = `
      <summary class="alert-summary" id="alert-summary" aria-label="Open alerts menu">
        <img class="alert-icon" src="/icons/icons8-alert-48.png" alt="Alerts" />
      </summary>
      <div class="wallet-dropdown alert-dropdown" aria-label="Alerts menu">
        <div class="alert-dropdown-head">
          <h3>Alerts</h3>
          <p>Choose which Sparta rows should trigger alerts.</p>
        </div>
        <label class="alert-option">
          <input id="alert-ai-picks" type="checkbox" />
          <span>New token in Sparta AI Picks</span>
        </label>
        <label class="alert-option">
          <input id="alert-migrated-picks" type="checkbox" />
          <span>New token in Migrated</span>
        </label>
      </div>
    `;
      utility.insertBefore(alertMenu, referenceNode);
    }

    let settingsLink = utility.querySelector(".settings-icon-link");
    if (!settingsLink) {
      settingsLink = document.createElement("a");
      settingsLink.className = "settings-icon-link";
      settingsLink.dataset.spartaPage = "settings";
      settingsLink.setAttribute("aria-label", "Open settings");
      settingsLink.innerHTML = `
      <svg class="settings-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path fill-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" clip-rule="evenodd"></path>
      </svg>
    `;
      utility.insertBefore(settingsLink, themeToggle || profileMenu || null);
    }
    settingsLink.dataset.spartaPage = "settings";
    settingsLink.href = getPageHref("settings", chain);
  }

  function getChainShortLabel(chain) {
    const normalizedChain = normalizeChain(chain);
    if (normalizedChain === "sol") {
      return "SOL";
    }
    if (normalizedChain === "eth") {
      return "ETH";
    }
    if (normalizedChain === "base") {
      return "BASE";
    }
    return "BNB";
  }

  function getNetworkToggleHref(targetChain, activePage) {
    const page =
      CLEAN_ROUTE_PAGES.has(activePage) || activePage === "home"
        ? activePage
        : "home";
    return getPageHref(page, targetChain);
  }

  function normalizeNetworkToggles(topbar, chain, activePage) {
    const chainOptions = [
      { chain: "bsc", label: "BNB" },
      { chain: "sol", label: "SOL" },
      { chain: "eth", label: "ETH" },
      { chain: "base", label: "BASE" },
    ];
    const findExistingChainLink = (links, option) =>
      links.find((link) => {
        const id = String(link.id || "").toLowerCase();
        const href = String(link.getAttribute("href") || "").toLowerCase();
        const label = String(link.textContent || "")
          .trim()
          .toLowerCase();
        if (id.includes(`network-${option.chain}`)) {
          return true;
        }
        if (label === option.label.toLowerCase()) {
          return true;
        }
        if (
          option.chain === "sol" &&
          (label === "solana" ||
            href.startsWith("/sol") ||
            href.includes("chain=sol"))
        ) {
          return true;
        }
        if (
          option.chain === "eth" &&
          (label === "ethereum" ||
            href.startsWith("/eth") ||
            href.includes("chain=eth"))
        ) {
          return true;
        }
        if (
          option.chain === "base" &&
          (href.startsWith("/base") || href.includes("chain=base"))
        ) {
          return true;
        }
        return (
          option.chain === "bsc" &&
          (label === "bnb" ||
            href === "/" ||
            href.startsWith("/bsc") ||
            href.includes("chain=bsc"))
        );
      });
    const syncDropdown = (dropdown) => {
      const existingLinks = Array.from(
        dropdown.querySelectorAll(":scope > a.network-pill")
      );
      const desiredLinks = chainOptions.map((option) => {
        const link =
          findExistingChainLink(existingLinks, option) ||
          document.createElement("a");
        link.className = `network-pill${
          option.chain === chain ? " is-active" : ""
        }`;
        link.href = getNetworkToggleHref(option.chain, activePage);
        link.textContent = option.label;
        if (option.chain === chain) {
          link.setAttribute("aria-current", "page");
        } else {
          link.setAttribute("aria-current", "false");
        }
        return link;
      });
      dropdown.replaceChildren(...desiredLinks);
    };

    topbar.querySelectorAll(".network-menu").forEach((menu) => {
      const summary = menu.querySelector(".network-summary");
      if (summary) {
        summary.textContent = getChainShortLabel(chain);
      }

      const dropdown = menu.querySelector(".network-dropdown");
      if (!dropdown) {
        return;
      }

      syncDropdown(dropdown);
    });

    topbar.querySelectorAll(".mobile-chain-menu").forEach((menu) => {
      const summary = menu.querySelector(".mobile-chain-summary");
      if (summary) {
        summary.textContent = getChainShortLabel(chain);
      }

      const dropdown = menu.querySelector(".mobile-chain-dropdown");
      if (!dropdown) {
        return;
      }

      syncDropdown(dropdown);
    });
  }

  function normalizeSharedHeader() {
    const topbar = document.querySelector(".hero-topbar");
    if (!topbar || topbar.classList.contains("prop-topbar")) {
      return;
    }

    const activePage = getActivePageName();
    const chain = getActivePageChain();
    normalizeNetworkToggles(topbar, chain, activePage);
    if (activePage === "home") {
      syncChainAwarePageLinks();
      return;
    }

    if (!topbar.querySelector(".mobile-topbar-left")) {
      topbar.insertAdjacentHTML("afterbegin", buildMobileTopbarMarkup(chain));
      normalizeNetworkToggles(topbar, chain, activePage);
    }

    normalizeDesktopHeader(topbar, chain, activePage);
    normalizeUtilityHeader(topbar, chain);
    syncChainAwarePageLinks();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        normalizeSharedHeader();
        syncChainAwarePageLinks();
      },
      { once: true }
    );
  } else {
    normalizeSharedHeader();
    syncChainAwarePageLinks();
  }

  const SPARTA_SELECTED_TOKEN_KEY = "spartaSelectedToken";
  const SHARED_SEARCH_INPUT_SELECTOR = ".search-input";
  const SHARED_SEARCH_DEBOUNCE_MS = 220;
  const BSC_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
  const SOL_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const BSC_NATIVE_TRADE_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildBscTradeHref(address) {
    const normalizedAddress = String(address || "")
      .trim()
      .toLowerCase();
    const baseHref = getPageHref("trade", "bsc");
    return normalizedAddress && normalizedAddress !== BSC_NATIVE_TRADE_ADDRESS
      ? getTokenHref(normalizedAddress, "bsc")
      : baseHref;
  }

  function buildSolTradeHref(address) {
    const normalizedAddress = String(address || "").trim();
    const baseHref = getPageHref("trade", "sol");
    return normalizedAddress
      ? getTokenHref(normalizedAddress, "sol")
      : baseHref;
  }

  function buildEthTradeHref(address) {
    const normalizedAddress = String(address || "")
      .trim()
      .toLowerCase();
    const baseHref = getPageHref("trade", "eth");
    return normalizedAddress &&
      normalizedAddress !== DEFAULT_ETH_TRADE_TOKEN_ADDRESS
      ? getTokenHref(normalizedAddress, "eth")
      : baseHref;
  }

  function buildBaseTradeHref(address) {
    const normalizedAddress = String(address || "")
      .trim()
      .toLowerCase();
    return normalizedAddress
      ? getTokenHref(normalizedAddress, "base")
      : getPageHref("trade", "base");
  }

  function buildChainTradeHref(chain, address) {
    const normalizedChain = normalizeChain(chain);
    return normalizedChain === "sol"
      ? buildSolTradeHref(address)
      : normalizedChain === "eth"
      ? buildEthTradeHref(address)
      : normalizedChain === "base"
      ? buildBaseTradeHref(address)
      : buildBscTradeHref(address);
  }

  function detectSearchResolver(rawQuery) {
    const normalizedQuery = String(rawQuery || "").trim();
    if (BSC_ADDRESS_PATTERN.test(normalizedQuery)) {
      return "evm";
    }
    if (SOL_ADDRESS_PATTERN.test(normalizedQuery)) {
      return "sol";
    }
    return "text";
  }

  function saveSelectedSearchToken(token) {
    try {
      window.localStorage.setItem(
        SPARTA_SELECTED_TOKEN_KEY,
        JSON.stringify(token)
      );
    } catch {}
  }

  async function fetchResolvedBscSearchToken(address) {
    const response = await fetch(
      `/api/bsc/search-token?address=${encodeURIComponent(address)}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        payload.error || payload.status || `api ${response.status}`
      );
    }
    return payload.token || null;
  }

  async function fetchResolvedSolSearchToken(address) {
    const response = await fetch(
      `/api/sol/search-token?address=${encodeURIComponent(address)}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.status === 400) {
      return { invalidAddress: true };
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        payload.error || payload.status || `api ${response.status}`
      );
    }
    return payload.token || null;
  }

  async function fetchResolvedEthSearchToken(address) {
    const response = await fetch(
      `/api/eth/search-token?address=${encodeURIComponent(address)}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        payload.error || payload.status || `api ${response.status}`
      );
    }
    return payload.token || null;
  }

  async function fetchResolvedBaseSearchToken(address) {
    const response = await fetch(
      `/api/base/search-token?address=${encodeURIComponent(address)}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        payload.error || payload.status || `api ${response.status}`
      );
    }
    return payload.token || null;
  }

  async function fetchSearchResults(query, limit = 50) {
    const activeChain = getActivePageChain();
    const response = await fetch(
      `/api/search-tokens?q=${encodeURIComponent(
        query
      )}&limit=${encodeURIComponent(limit)}&active_chain=${encodeURIComponent(
        activeChain
      )}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.error || payload.status || `api ${response.status}`
      );
    }
    return Array.isArray(payload.results) ? payload.results : [];
  }

  function getSearchChainLabel(chain) {
    const normalizedChain = normalizeChain(chain);
    return normalizedChain === "sol"
      ? "SOL"
      : normalizedChain === "eth"
      ? "ETH"
      : normalizedChain === "base"
      ? "BASE"
      : "BSC";
  }

  function getSearchTokenChain(token) {
    return normalizeChain(token?.chain || token?.network || token?.chainKey);
  }

  function getSearchTokenAddress(token) {
    const chain = getSearchTokenChain(token);
    const address = String(
      token?.address || token?.tokenAddress || token?.contractAddress || ""
    ).trim();
    return chain === "sol" ? address : address.toLowerCase();
  }

  function getSearchRouteLabel(token) {
    const chain = getSearchTokenChain(token);
    const poolStatus = String(token?.poolStatus || "")
      .trim()
      .toLowerCase();
    const explicitRoute = String(
      token?.routerLabel ||
        token?.dexLabel ||
        token?.dexId ||
        token?.source ||
        ""
    ).trim();
    if (
      poolStatus === "no_pool" ||
      explicitRoute.toUpperCase() === "NO LIVE POOL"
    ) {
      return "NO LIVE POOL";
    }
    if (explicitRoute) {
      return explicitRoute;
    }
    if (token?.isBonded) {
      return chain === "sol"
        ? "PumpSwap"
        : chain === "eth" || chain === "base"
        ? "Uniswap V3"
        : "Pancake V2";
    }
    return chain === "sol"
      ? "PumpFun"
      : chain === "eth" || chain === "base"
      ? "Uniswap Prebond"
      : "FourMeme Prebond";
  }

  function getSearchComparable(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function getSearchMetricValue(token, keys) {
    for (const key of keys) {
      const value = Number(token?.[key]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return 0;
  }

  function getSearchTokenScore(token, rawQuery, activeChain, index) {
    const query = getSearchComparable(rawQuery);
    const chain = getSearchTokenChain(token);
    const symbol = getSearchComparable(token?.shortName || token?.symbol);
    const name = getSearchComparable(token?.name);
    const address = getSearchComparable(getSearchTokenAddress(token));
    const routeLabel = getSearchRouteLabel(token).toUpperCase();
    const marketCap = getSearchMetricValue(token, [
      "marketCapUsd",
      "marketCap",
      "fdvUsd",
      "fdv",
    ]);
    const liquidity = getSearchMetricValue(token, [
      "liquidityUsd",
      "poolLiquidityUsd",
      "poolLiquidity",
      "reserveUsd",
      "reserveInUsd",
    ]);
    const volume = getSearchMetricValue(token, [
      "volume24hUsd",
      "volume24h",
      "volumeUsd",
      "volume",
    ]);

    let matchScore = 0;
    if (query && address === query) {
      matchScore = 900000000000;
    } else if (query && symbol === query) {
      matchScore = 800000000000;
    } else if (query && name === query) {
      matchScore = 700000000000;
    } else if (query && symbol.startsWith(query)) {
      matchScore = 600000000000;
    } else if (query && name.startsWith(query)) {
      matchScore = 500000000000;
    } else if (query && symbol.includes(query)) {
      matchScore = 400000000000;
    } else if (query && name.includes(query)) {
      matchScore = 300000000000;
    }

    const sizeScore = marketCap * 1000 + liquidity * 100 + volume;
    const poolScore = routeLabel === "NO LIVE POOL" ? -1000000000 : 1000000000;
    const activeChainTieBreak = chain === activeChain ? 1000 : 0;
    return matchScore + sizeScore + poolScore + activeChainTieBreak - index;
  }

  function sortSearchTokens(tokens, rawQuery) {
    const activeChain = getActivePageChain();
    return (Array.isArray(tokens) ? tokens : [])
      .map((token, index) => ({
        token,
        score: getSearchTokenScore(token, rawQuery, activeChain, index),
      }))
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.token);
  }

  function ensureSearchDropdown(input) {
    const host = input.closest(".hero-search") || input.parentElement;
    if (!host) {
      return null;
    }

    host.classList.add("has-search-dropdown");
    let dropdown = host.querySelector(".search-dropdown");
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.className = "search-dropdown";
      dropdown.hidden = true;
      host.appendChild(dropdown);
    }
    return dropdown;
  }

  function renderSearchDropdown(state) {
    const dropdown = state.dropdown;
    if (!dropdown) {
      return;
    }

    if (!state.query) {
      dropdown.hidden = true;
      dropdown.innerHTML = "";
      return;
    }

    if (state.loading) {
      dropdown.hidden = false;
      dropdown.innerHTML =
        '<div class="search-dropdown-message">Searching tokens...</div>';
      return;
    }

    if (state.errorMessage) {
      dropdown.hidden = false;
      dropdown.innerHTML = `<div class="search-dropdown-message">${escapeHtml(
        state.errorMessage
      )}</div>`;
      return;
    }

    if (!state.tokens.length) {
      dropdown.hidden = false;
      dropdown.innerHTML =
        '<div class="search-dropdown-message">No matching token found.</div>';
      return;
    }

    dropdown.hidden = false;
    dropdown.innerHTML = state.tokens
      .map((token, index) => {
        const imageMarkup = token.image
          ? `<img class="search-dropdown-avatar-image" src="${escapeHtml(
              token.image
            )}" alt="${escapeHtml(
              token.symbol || token.shortName || token.name || "Token"
            )}" loading="lazy" />`
          : `<span class="search-dropdown-avatar-fallback">${escapeHtml(
              (token.shortName || token.symbol || "T").slice(0, 1)
            )}</span>`;
        const normalizedChain = getSearchTokenChain(token);
        const chainLabel = getSearchChainLabel(normalizedChain);
        const statusLabel = getSearchRouteLabel(token);
        const address = getSearchTokenAddress(token);
        return `
      <button class="search-dropdown-option" type="button" data-search-index="${index}">
        <span class="search-dropdown-avatar">${imageMarkup}</span>
        <span class="search-dropdown-copy">
          <span class="search-dropdown-title">${escapeHtml(
            token.name || token.shortName || token.symbol || "Unknown"
          )}</span>
          <span class="search-dropdown-meta">${escapeHtml(
            chainLabel
          )} • ${escapeHtml(
          token.shortName || token.symbol || "TKN"
        )} • ${escapeHtml(statusLabel)} • ${escapeHtml(address)}</span>
        </span>
      </button>
    `;
      })
      .join("");

    Array.from(dropdown.querySelectorAll(".search-dropdown-option")).forEach(
      (option) => {
        const tokenIndex = Number(option.dataset.searchIndex || -1);
        const token = state.tokens[tokenIndex];
        if (!token) {
          return;
        }
        const prefetch = () => {
          prefetchTokenChart(
            getSearchTokenAddress(token),
            getSearchTokenChain(token)
          );
        };
        option.addEventListener("mouseenter", prefetch, { passive: true });
        option.addEventListener("mousedown", prefetch);
        option.addEventListener("focus", prefetch, { passive: true });
        option.addEventListener("click", () => {
          prefetch();
          saveSelectedSearchToken(token);
          window.location.href =
            token.targetHref ||
            buildChainTradeHref(
              getSearchTokenChain(token),
              getSearchTokenAddress(token)
            );
        });
      }
    );
  }

  async function runBscSearch(state, { immediate = false } = {}) {
    const rawQuery = String(state.input.value || "").trim();
    window.clearTimeout(state.debounceTimer);
    state.query = rawQuery;
    state.tokens = [];
    state.errorMessage = "";

    if (!rawQuery) {
      renderSearchDropdown(state);
      return null;
    }

    const resolver = detectSearchResolver(rawQuery);

    const requestId = state.requestId + 1;
    state.requestId = requestId;
    state.loading = true;
    renderSearchDropdown(state);

    const resolveRequest = async () => {
      try {
        let tokens = [];
        if (resolver === "evm") {
          const [bscToken, ethToken, baseToken] = await Promise.all([
            fetchResolvedBscSearchToken(rawQuery).catch(() => null),
            fetchResolvedEthSearchToken(rawQuery).catch(() => null),
            fetchResolvedBaseSearchToken(rawQuery).catch(() => null),
          ]);
          tokens = sortSearchTokens(
            [bscToken, ethToken, baseToken].filter(Boolean),
            rawQuery
          );
        } else if (resolver === "sol") {
          const token = await fetchResolvedSolSearchToken(rawQuery);
          if (token?.invalidAddress) {
            tokens = sortSearchTokens(
              await fetchSearchResults(rawQuery),
              rawQuery
            );
          } else {
            tokens = token ? [token] : [];
          }
        } else {
          tokens = sortSearchTokens(
            await fetchSearchResults(rawQuery),
            rawQuery
          );
        }
        if (state.requestId !== requestId) {
          return null;
        }
        state.loading = false;
        state.tokens = tokens;
        state.errorMessage = "";
        renderSearchDropdown(state);
        return tokens;
      } catch {
        if (state.requestId !== requestId) {
          return null;
        }
        state.loading = false;
        state.tokens = [];
        state.errorMessage = "Search is temporarily unavailable.";
        renderSearchDropdown(state);
        return null;
      }
    };

    if (immediate) {
      return resolveRequest();
    }

    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(
      resolveRequest,
      SHARED_SEARCH_DEBOUNCE_MS
    );
    return null;
  }

  function bindBscSearchInput(input) {
    if (!input || input.dataset.spartaSearchBound === "true") {
      return;
    }

    input.dataset.spartaSearchBound = "true";
    const state = {
      input,
      dropdown: ensureSearchDropdown(input),
      debounceTimer: 0,
      requestId: 0,
      query: "",
      tokens: [],
      errorMessage: "",
      loading: false,
    };

    const closeDropdown = () => {
      window.clearTimeout(state.debounceTimer);
      state.requestId += 1;
      state.loading = false;
      state.query = "";
      state.tokens = [];
      state.errorMessage = "";
      renderSearchDropdown(state);
    };

    input.addEventListener("input", () => {
      void runBscSearch(state);
    });

    input.addEventListener("focus", () => {
      if (state.query || state.tokens.length || state.errorMessage) {
        renderSearchDropdown(state);
      }
    });

    input.addEventListener(
      "keydown",
      async (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        window.clearTimeout(state.debounceTimer);

        let tokens = state.tokens;
        const rawQuery = String(input.value || "").trim();
        if (!tokens.length || rawQuery !== state.query) {
          tokens = await runBscSearch(state, { immediate: true });
        }

        const token = Array.isArray(tokens) ? tokens[0] : null;
        if (!token) {
          return;
        }

        saveSelectedSearchToken(token);
        window.location.href =
          token.targetHref ||
          buildChainTradeHref(
            getSearchTokenChain(token),
            getSearchTokenAddress(token)
          );
      },
      true
    );

    document.addEventListener("pointerdown", (event) => {
      if (
        input.contains(event.target) ||
        state.dropdown?.contains(event.target)
      ) {
        return;
      }
      closeDropdown();
    });
  }

  function initBscSharedSearch() {
    document.querySelectorAll(SHARED_SEARCH_INPUT_SELECTOR).forEach((input) => {
      bindBscSearchInput(input);
    });
  }

  function normalizeLegacyHrefValue(href) {
    const normalized = String(href || "").trim();
    switch (normalized) {
      case "/bsc/launch":
        return getPageHref("launch", getActivePageChain());
      case "/bsc/bridge":
        return getPageHref("bridge", getActivePageChain());
      case "./index.html":
        return getPageHref("home", getActivePageChain());
      case "./solana.html":
        return getHomeHref("sol");
      case "./settings.html":
      case "./settings.html?chain=bsc":
        return getPageHref("settings", "bsc");
      case "./settings.html?chain=sol":
        return getPageHref("settings", "sol");
      case "./trade.html":
        return getPageHref("trade", "bsc");
      case "./launch.html":
      case "./launch.html?chain=bsc":
        return getPageHref("launch", "bsc");
      case "./launch.html?chain=sol":
        return getPageHref("launch", "sol");
      case "./trade.html?/sol/So11111111111111111111111111111111111111112":
        return getPageHref("trade", "sol");
      case "./copytrade.html":
      case "./copytrade.html?chain=bsc":
        return getPageHref("copytrade", "bsc");
      case "./copytrade.html?chain=sol":
        return getPageHref("copytrade", "sol");
      case "./copytrade.html?chain=eth":
        return getPageHref("copytrade", "eth");
      case "./ai-trading.html":
      case "./ai-trading.html?chain=bsc":
        return getPageHref("ai-trading", "bsc");
      case "./ai-trading.html?chain=sol":
        return getPageHref("ai-trading", "sol");
      case "./ai-trading.html?chain=eth":
        return getPageHref("ai-trading", "eth");
      case "./orders.html":
      case "./orders.html?chain=bsc":
        return getPageHref("orders", "bsc");
      case "./orders.html?chain=sol":
        return getPageHref("orders", "sol");
      case "./situation-room.html":
      case "./situation-room.html?chain=bsc":
        return getPageHref("situation-room", "bsc");
      case "./situation-room.html?chain=sol":
        return getPageHref("situation-room", "sol");
      case "./events.html":
      case "./events.html?chain=bsc":
        return getPageHref("events", "bsc");
      case "./events.html?chain=sol":
        return getPageHref("events", "sol");
      case "./stats.html":
      case "./stats.html?chain=bsc":
        return getPageHref("stats", "bsc");
      case "./stats.html?chain=sol":
        return getPageHref("stats", "sol");
      case "./referral.html":
      case "./referral.html?chain=bsc":
      case "./referral.html?chain=sol":
        return getPageHref("referral", "bsc");
      case "./wallets.html":
      case "./wallets.html?chain=bsc":
        return getPageHref("wallets", "bsc");
      case "./wallets.html?chain=sol":
        return getPageHref("wallets", "sol");
      case "./transfer.html":
      case "./transfer.html?chain=bsc":
        return getPageHref("transfer", "bsc");
      case "./transfer.html?chain=sol":
        return getPageHref("transfer", "sol");
      case "./transfer.html?chain=eth":
        return getPageHref("transfer", "eth");
      case "./transfer.html?chain=base":
        return getPageHref("transfer", "base");
      case "./bridge.html":
        return getPageHref("bridge", getActivePageChain());
      case "./bridge.html?chain=bsc":
        return getPageHref("bridge", "bsc");
      case "./bridge.html?chain=sol":
        return getPageHref("bridge", "sol");
      case "./bridge.html?chain=eth":
        return getPageHref("bridge", "eth");
      case "./bridge.html?chain=base":
        return getPageHref("bridge", "base");
      case "./privacy-policy.html":
        return getPageHref("privacy-policy", "bsc");
      case "./terms-of-service.html":
        return getPageHref("terms-of-service", "bsc");
      default:
        return normalized;
    }
  }

  function normalizeLegacyDocumentLinks() {
    document.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href");
      const nextHref = normalizeLegacyHrefValue(href);
      if (nextHref && nextHref !== href) {
        link.setAttribute("href", nextHref);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      normalizeLegacyDocumentLinks,
      { once: true }
    );
  } else {
    normalizeLegacyDocumentLinks();
  }

  function readAllProfiles() {
    try {
      return JSON.parse(
        window.localStorage.getItem(SPARTA_PROFILE_KEY) || "{}"
      );
    } catch {
      return {};
    }
  }

  function getProfileScope(session) {
    if (!session?.address) {
      return "guest";
    }

    return `${String(session.walletType || "wallet").toLowerCase()}:${String(
      session.address
    ).toLowerCase()}`;
  }

  function shortAddress(address) {
    if (!address) {
      return "Guest";
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function mapProfileMenuError(
    error,
    fallbackMessage = "Request failed. Please try again."
  ) {
    const code = String(error?.message || "")
      .trim()
      .toLowerCase();
    if (!code) {
      return fallbackMessage;
    }

    const codeMap = {
      "metamask not found": "MetaMask is not available in this browser.",
      "metamask sdk unavailable":
        "MetaMask mobile connection is unavailable right now.",
      "metamask connection failed": "Unable to connect MetaMask.",
      "phantom not found": "Phantom is not available in this browser.",
      "phantom connection failed": "Unable to connect Phantom.",
      "rabby not found": "Rabby is not available in this browser.",
      "rabby connection failed": "Unable to connect Rabby.",
      "coinbase wallet not found":
        "Coinbase Wallet is not available in this browser.",
      "coinbase wallet sdk unavailable":
        "Coinbase Wallet mobile connection is unavailable right now.",
      "coinbase wallet connection failed": "Unable to connect Coinbase Wallet.",
      "walletconnect not configured":
        "WalletConnect is not configured. Add a Project ID.",
      "walletconnect not available": "WalletConnect library is not loaded.",
      "walletconnect connection failed": "Unable to connect WalletConnect.",
      wallet_app_redirect:
        "Opening the wallet app. Continue the login there if prompted.",
      wallet_provider_unavailable:
        "Wallet provider unavailable. Reconnect and try again.",
      wallet_not_connected: "Wallet is not connected.",
      auth_required: "Wallet signature required to continue.",
      unsupported_wallet_auth: "This wallet is not supported for this action.",
      signature_declined: "Signature request was declined.",
      missing_wallet: "Connect a wallet first.",
      missing_auth: "Connect a wallet first.",
      not_whitelisted: "This wallet is not whitelisted for Sparta Terminal.",
      invalid_auth_payload: "Authentication failed. Please try again.",
      challenge_expired: "Authentication expired. Please try again.",
      invalid_signature: "Wallet signature could not be verified.",
      invalid_origin: "Request blocked. Refresh the page and try again.",
      missing_csrf_token: "Session expired. Refresh the page and try again.",
      invalid_csrf_token: "Session expired. Refresh the page and try again.",
      missing_wallet_name: "Enter a wallet name first.",
      invalid_private_key: "Invalid private key format.",
      unsupported_chain: "Unsupported chain for this action.",
    };

    if (code.startsWith("wallet_sdk_load_failed:")) {
      return "Wallet SDK failed to load. Please refresh and try again.";
    }

    return codeMap[code] || fallbackMessage;
  }

  function defaultProfileName(session) {
    if (!session?.address) {
      return "Spartan";
    }

    return `${session.walletType || "Wallet"} ${session.address.slice(-4)}`;
  }

  function readProfile(session = readWalletSession()) {
    const profiles = readAllProfiles();
    const scope = getProfileScope(session);
    const existing = profiles[scope] || {};
    return {
      username:
        String(existing.username || "").trim() || defaultProfileName(session),
      avatarUrl: String(existing.avatarUrl || "").trim(),
    };
  }

  function saveProfile(values, session = readWalletSession()) {
    const profiles = readAllProfiles();
    const scope = getProfileScope(session);
    const nextProfile = {
      username:
        String(values.username || "").trim() || defaultProfileName(session),
      avatarUrl: String(values.avatarUrl || "").trim(),
    };
    profiles[scope] = nextProfile;
    window.localStorage.setItem(SPARTA_PROFILE_KEY, JSON.stringify(profiles));
    window.dispatchEvent(
      new CustomEvent("sparta:profile-updated", {
        detail: { profile: nextProfile },
      })
    );
    return nextProfile;
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

  const WALLET_SDK_SCRIPTS = {
    metamask: "/vendor/metamask-sdk.js",
    coinbase: "/vendor/coinbase-wallet-sdk.js",
    walletconnect: "/vendor/walletconnect-ethereum-provider.js",
  };

  const walletSdkScriptLoads = new Map();
  let metaMaskSdkInstance = null;
  let coinbaseSdkProvider = null;
  let walletConnectProvider = null;
  let walletConnectProviderPromise = null;

  function loadWalletSdkScript(src) {
    if (!src) {
      return Promise.reject(new Error("wallet_sdk_missing_src"));
    }

    if (walletSdkScriptLoads.has(src)) {
      return walletSdkScriptLoads.get(src);
    }

    const existing = document.querySelector(
      `script[data-wallet-sdk-src="${src}"]`
    );
    if (existing) {
      const promise = Promise.resolve();
      walletSdkScriptLoads.set(src, promise);
      return promise;
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.walletSdkSrc = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`wallet_sdk_load_failed:${src}`));
      document.head.appendChild(script);
    });

    walletSdkScriptLoads.set(src, promise);
    return promise;
  }

  function getWalletSdkMetadata() {
    return {
      name: "Sparta",
      appName: "Sparta",
      url: window.location.origin,
      iconUrl: `${window.location.origin}/spartaicon.png`,
      description: "Sparta mobile wallet connection",
    };
  }

  async function ensureMetaMaskSdk() {
    await loadWalletSdkScript(WALLET_SDK_SCRIPTS.metamask);
    const MetaMaskSdkCtor = window.SpartaMetaMaskSDK;
    if (!MetaMaskSdkCtor) {
      throw new Error("metamask sdk unavailable");
    }

    if (!metaMaskSdkInstance) {
      metaMaskSdkInstance = new MetaMaskSdkCtor({
        dappMetadata: getWalletSdkMetadata(),
        checkInstallationImmediately: false,
        checkInstallationOnAllCalls: false,
        preferDesktop: !isMobileDevice(),
        headless: true,
        injectProvider: false,
        shouldShimWeb3: false,
        extensionOnly: false,
        useDeeplink: true,
        enableAnalytics: false,
      });
      await metaMaskSdkInstance.init?.();
    }

    return metaMaskSdkInstance;
  }

  async function getMetaMaskProviderAsync() {
    const injected = getMetaMaskProvider();
    if (injected) {
      return injected;
    }

    const sdk = await ensureMetaMaskSdk();
    return sdk.getProvider?.() || null;
  }

  function getInjectedSolanaProvider() {
    const phantomProvider = window.phantom?.solana;
    if (phantomProvider?.isPhantom) {
      return phantomProvider;
    }

    const solanaProvider = window.solana;
    if (
      solanaProvider?.isPhantom ||
      (typeof solanaProvider?.connect === "function" &&
        typeof solanaProvider?.signMessage === "function")
    ) {
      return solanaProvider;
    }

    return null;
  }

  function getPhantomEvmProvider() {
    const phantomProvider = window.phantom?.ethereum;
    if (
      phantomProvider?.isPhantom &&
      typeof phantomProvider.request === "function"
    ) {
      return phantomProvider;
    }

    const ethereum = window.ethereum;
    if (!ethereum) {
      return null;
    }
    if (Array.isArray(ethereum.providers)) {
      return (
        ethereum.providers.find(
          (provider) =>
            provider?.isPhantom && typeof provider.request === "function"
        ) || null
      );
    }
    return ethereum.isPhantom && typeof ethereum.request === "function"
      ? ethereum
      : null;
  }

  function isMobileDevice() {
    const ua = String(window.navigator?.userAgent || "");
    return /android|iphone|ipad|ipod|iemobile|opera mini/i.test(ua);
  }

  const SPARTA_PENDING_WALLET_ACTION_KEY = "sparta.pendingWalletAction";
  const SPARTA_PENDING_WALLET_ACTION_TTL_MS = 10 * 60 * 1000;

  function readPendingWalletAction() {
    try {
      const raw = window.localStorage.getItem(SPARTA_PENDING_WALLET_ACTION_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        window.localStorage.removeItem(SPARTA_PENDING_WALLET_ACTION_KEY);
        return null;
      }
      const createdAt = Number(parsed.createdAt || 0);
      if (
        !Number.isFinite(createdAt) ||
        Date.now() - createdAt > SPARTA_PENDING_WALLET_ACTION_TTL_MS
      ) {
        window.localStorage.removeItem(SPARTA_PENDING_WALLET_ACTION_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writePendingWalletAction(walletType, intent = "connect") {
    try {
      window.localStorage.setItem(
        SPARTA_PENDING_WALLET_ACTION_KEY,
        JSON.stringify({
          walletType: String(walletType || "").trim(),
          intent: String(intent || "connect").trim(),
          createdAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage write failures and continue with best-effort redirect.
    }
  }

  function clearPendingWalletAction() {
    try {
      window.localStorage.removeItem(SPARTA_PENDING_WALLET_ACTION_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }

  function getCurrentPageUrl() {
    try {
      return window.location.href;
    } catch {
      return "/";
    }
  }

  function buildWalletBrowserDeepLink(walletType) {
    const currentUrl = getCurrentPageUrl();
    const encodedCurrentUrl = encodeURIComponent(currentUrl);
    const origin = encodeURIComponent(window.location.origin);
    switch (String(walletType || "").trim()) {
      case "MetaMask":
        return `https://metamask.app.link/dapp/${encodeURIComponent(
          String(currentUrl || "").replace(/^https?:\/\//i, "")
        )}`;
      case "Phantom":
        return `https://phantom.app/ul/browse/${encodedCurrentUrl}?ref=${origin}`;
      case "Coinbase Wallet":
        return `https://go.cb-w.com/dapp?cb_url=${encodedCurrentUrl}`;
      default:
        return "";
    }
  }

  function openWalletBrowserDeepLink(walletType) {
    const targetUrl = buildWalletBrowserDeepLink(walletType);
    if (!targetUrl) {
      return false;
    }
    window.location.assign(targetUrl);
    return true;
  }

  function isSupportedEvmWalletType(walletType) {
    return ["MetaMask", "Rabby", "Coinbase Wallet", "WalletConnect"].includes(
      String(walletType || "").trim()
    );
  }

  function isEvmWalletSession(session) {
    const walletType = String(session?.walletType || "").trim();
    const address = String(session?.address || "").trim();
    if (!address.startsWith("0x")) {
      return false;
    }
    return isSupportedEvmWalletType(walletType) || walletType === "Phantom";
  }

  async function finalizeWalletConnection(
    walletType,
    address,
    authFailureMessage
  ) {
    const session = writeWalletSession(walletType, address);
    try {
      await ensureServerAuth({ interactive: true });
    } catch (error) {
      clearWalletSession();
      throw new Error(error?.message || authFailureMessage);
    }
    return session;
  }

  async function connectMetaMask() {
    const injectedProvider = getMetaMaskProvider();
    let accounts = null;

    if (injectedProvider) {
      accounts = await injectedProvider.request({
        method: "eth_requestAccounts",
      });
    } else {
      const sdk = await ensureMetaMaskSdk();
      accounts = await sdk.connect();
    }

    const account = accounts?.[0];
    if (!account) {
      throw new Error("MetaMask connection failed");
    }

    return finalizeWalletConnection(
      "MetaMask",
      account,
      "MetaMask authentication failed"
    );
  }

  async function connectPhantom() {
    const shouldUseEvm = getActivePageChain() !== "sol";
    const phantomEvm = shouldUseEvm ? getPhantomEvmProvider() : null;
    if (phantomEvm) {
      const accounts = await phantomEvm.request({
        method: "eth_requestAccounts",
      });
      const account = accounts?.[0];
      if (!account) {
        throw new Error("Phantom connection failed");
      }
      return finalizeWalletConnection(
        "Phantom",
        account,
        "Phantom authentication failed"
      );
    }

    const phantom = getInjectedSolanaProvider();
    if (!phantom) {
      if (isMobileDevice()) {
        writePendingWalletAction("Phantom", "connect");
      }
      if (isMobileDevice() && openWalletBrowserDeepLink("Phantom")) {
        throw new Error("wallet_app_redirect");
      }
      throw new Error("Phantom not found");
    }

    const result = await phantom.connect();
    const address = result?.publicKey?.toString();
    if (!address) {
      throw new Error("Phantom connection failed");
    }

    return finalizeWalletConnection(
      "Phantom",
      address,
      "Phantom authentication failed"
    );
  }

  let pendingSpartaWalletRequest = null;

  function isMetaMaskDetected() {
    return Boolean(getMetaMaskProvider());
  }

  function isPhantomDetected() {
    return Boolean(getInjectedSolanaProvider() || getPhantomEvmProvider());
  }

  function getRabbyProvider() {
    const ethereum = window.ethereum;
    if (!ethereum) {
      return null;
    }
    if (Array.isArray(ethereum.providers)) {
      return ethereum.providers.find((p) => p.isRabby) || null;
    }
    return ethereum.isRabby ? ethereum : null;
  }

  function getCoinbaseProvider() {
    if (window.coinbaseWalletExtension) {
      return window.coinbaseWalletExtension;
    }
    const ethereum = window.ethereum;
    if (!ethereum) {
      return null;
    }
    if (Array.isArray(ethereum.providers)) {
      return ethereum.providers.find((p) => p.isCoinbaseWallet) || null;
    }
    return ethereum.isCoinbaseWallet ? ethereum : null;
  }

  async function getCoinbaseProviderAsync() {
    const injected = getCoinbaseProvider();
    if (injected) {
      return injected;
    }

    await loadWalletSdkScript(WALLET_SDK_SCRIPTS.coinbase);
    const createCoinbaseWalletSdk = window.SpartaCreateCoinbaseWalletSDK;
    const CoinbaseWalletSdkCtor = window.SpartaCoinbaseWalletSDK;
    if (!createCoinbaseWalletSdk && !CoinbaseWalletSdkCtor) {
      throw new Error("coinbase wallet sdk unavailable");
    }

    if (!coinbaseSdkProvider) {
      if (typeof createCoinbaseWalletSdk === "function") {
        const sdk = createCoinbaseWalletSdk({
          appName: "Sparta",
          appLogoUrl: `${window.location.origin}/spartaicon.png`,
          preference: { options: "all" },
        });
        coinbaseSdkProvider = sdk?.getProvider?.() || null;
      } else if (typeof CoinbaseWalletSdkCtor === "function") {
        const sdk = new CoinbaseWalletSdkCtor({
          appName: "Sparta",
          appLogoUrl: `${window.location.origin}/spartaicon.png`,
        });
        coinbaseSdkProvider =
          sdk?.makeWeb3Provider?.({ options: "all" }) || null;
      }
    }

    return coinbaseSdkProvider;
  }

  async function getWalletConnectProviderAsync() {
    if (walletConnectProvider) {
      return walletConnectProvider;
    }

    if (walletConnectProviderPromise) {
      return walletConnectProviderPromise;
    }

    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error("WalletConnect not configured");
    }

    walletConnectProviderPromise = (async () => {
      await loadWalletSdkScript(WALLET_SDK_SCRIPTS.walletconnect);
      const EthereumProvider = window.SpartaWalletConnectEthereumProvider;
      if (!EthereumProvider?.init) {
        throw new Error("WalletConnect not available");
      }

      const provider = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [56],
        optionalChains: [56],
        showQrModal: true,
        metadata: getWalletSdkMetadata(),
      });

      provider.on?.("disconnect", () => {
        if (walletConnectProvider === provider) {
          walletConnectProvider = null;
        }
      });

      walletConnectProvider = provider;
      return provider;
    })();

    try {
      return await walletConnectProviderPromise;
    } finally {
      walletConnectProviderPromise = null;
    }
  }

  function getConnectedEvmProvider(session = readWalletSession()) {
    const walletType = String(session?.walletType || "").trim();
    if (!walletType) {
      return null;
    }
    if (
      walletType === "Phantom" &&
      String(session?.address || "")
        .trim()
        .startsWith("0x")
    ) {
      return getPhantomEvmProvider();
    }
    if (walletType === "MetaMask") {
      return getMetaMaskProvider();
    }
    if (walletType === "Rabby") {
      return getRabbyProvider();
    }
    if (walletType === "Coinbase Wallet") {
      return getCoinbaseProvider();
    }
    if (walletType === "WalletConnect") {
      return walletConnectProvider;
    }
    return null;
  }

  async function getConnectedEvmProviderAsync(session = readWalletSession()) {
    const walletType = String(session?.walletType || "").trim();
    if (!walletType) {
      return null;
    }
    if (
      walletType === "Phantom" &&
      String(session?.address || "")
        .trim()
        .startsWith("0x")
    ) {
      return getPhantomEvmProvider();
    }
    if (walletType === "MetaMask") {
      return getMetaMaskProviderAsync();
    }
    if (walletType === "Rabby") {
      return getRabbyProvider();
    }
    if (walletType === "Coinbase Wallet") {
      return getCoinbaseProviderAsync();
    }
    if (walletType === "WalletConnect") {
      return getWalletConnectProviderAsync();
    }
    return null;
  }

  function isRabbyDetected() {
    return Boolean(getRabbyProvider());
  }

  function isCoinbaseDetected() {
    return Boolean(getCoinbaseProvider());
  }

  async function connectRabby() {
    const provider = getRabbyProvider();
    if (!provider) {
      throw new Error("Rabby not found");
    }
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = accounts?.[0];
    if (!account) {
      throw new Error("Rabby connection failed");
    }
    return finalizeWalletConnection(
      "Rabby",
      account,
      "Rabby authentication failed"
    );
  }

  async function connectCoinbase() {
    const provider = await getCoinbaseProviderAsync();
    if (!provider) {
      throw new Error("Coinbase Wallet not found");
    }
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = accounts?.[0];
    if (!account) {
      throw new Error("Coinbase Wallet connection failed");
    }
    return finalizeWalletConnection(
      "Coinbase Wallet",
      account,
      "Coinbase Wallet authentication failed"
    );
  }

  async function connectWalletConnect() {
    walletConnectProvider = await getWalletConnectProviderAsync();
    if (!walletConnectProvider) {
      throw new Error("WalletConnect not available");
    }
    await walletConnectProvider.connect?.();
    const accounts = await walletConnectProvider.enable();
    const account = accounts?.[0];
    if (!account) {
      throw new Error("WalletConnect connection failed");
    }
    return finalizeWalletConnection(
      "WalletConnect",
      account,
      "WalletConnect authentication failed"
    );
  }

  function getWalletLoginOptions() {
    const mobile = isMobileDevice();
    return [
      {
        id: "phantom",
        label: "Phantom",
        badge: isPhantomDetected() ? "Detected" : mobile ? "Open app" : "",
        iconMarkup: `
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="phantom-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ceb8ff"></stop>
              <stop offset="100%" stop-color="#8c87ff"></stop>
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#phantom-gradient)"></rect>
          <path d="M18 39c0-9.3 6.3-18 15.9-18 5.4 0 10.3 2.6 12.8 6.8 1.7 2.8 1.3 6.2-.9 8.6-1.8 1.9-4.5 3-7.1 3H18Z" fill="#fff7ff"></path>
          <path d="M27.2 41.6c0 3.2 2.6 5.8 5.8 5.8 2.6 0 4.8-1.7 5.5-4.1H27.4c-.1-.6-.2-1.1-.2-1.7Z" fill="#fff7ff"></path>
          <circle cx="36.8" cy="30.5" r="2.1" fill="#8c87ff"></circle>
          <circle cx="43.6" cy="30.5" r="2.1" fill="#8c87ff"></circle>
        </svg>
      `,
      },
      {
        id: "metamask",
        label: "MetaMask",
        badge: isMetaMaskDetected() ? "Detected" : mobile ? "Open app" : "",
        iconMarkup:
          '<img src="/icons/metamask-fox.svg" alt="" loading="lazy" />',
      },
      {
        id: "sparta",
        label: "Sparta Wallet",
        badge: "Create/Import",
        iconMarkup: '<img src="/spartaicon.png" alt="" loading="lazy" />',
      },
      {
        id: "rabby",
        label: "Rabby",
        badge: isRabbyDetected() ? "Detected" : "",
        iconMarkup: `
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <rect x="4" y="4" width="56" height="56" rx="16" fill="#7084FF"></rect>
          <ellipse cx="32" cy="34" rx="14" ry="10" fill="#1a1f5e"></ellipse>
          <ellipse cx="32" cy="34" rx="9" ry="6" fill="#7084FF"></ellipse>
          <circle cx="32" cy="34" r="3.5" fill="#1a1f5e"></circle>
          <circle cx="33" cy="33" r="1.4" fill="#fff" opacity="0.85"></circle>
          <rect x="26" y="14" width="5" height="13" rx="2.5" fill="#c4b5ff"></rect>
          <rect x="33" y="14" width="5" height="13" rx="2.5" fill="#c4b5ff"></rect>
        </svg>
      `,
      },
      {
        id: "coinbase",
        label: "Coinbase Wallet",
        badge: isCoinbaseDetected() ? "Detected" : mobile ? "Open app" : "",
        iconMarkup: `
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <rect x="4" y="4" width="56" height="56" rx="16" fill="#0052FF"></rect>
          <circle cx="32" cy="32" r="16" fill="#fff"></circle>
          <rect x="24" y="24" width="16" height="16" rx="3" fill="#0052FF"></rect>
        </svg>
      `,
      },
    ];
  }

  function buildAvatarMarkup(profile, session) {
    if (profile.avatarUrl) {
      return `<img class="profile-avatar-image" src="${profile.avatarUrl}" alt="" referrerpolicy="no-referrer" />`;
    }

    const seed = profile.username || session?.walletType || "S";
    return `<span class="profile-avatar-fallback">${seed
      .trim()
      .slice(0, 1)
      .toUpperCase()}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function ensureProfileModal() {
    let modal = document.getElementById("profile-modal");
    if (modal) {
      return modal;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
    <div class="profile-modal" id="profile-modal" hidden>
      <div class="profile-modal-backdrop" data-close-profile-modal="true"></div>
      <section class="profile-modal-card" aria-modal="true" role="dialog" aria-labelledby="profile-modal-title">
        <div class="profile-modal-head">
          <div>
            <p class="profile-modal-kicker">Sparta Profile</p>
            <h3 id="profile-modal-title">Edit Profile</h3>
          </div>
          <button class="profile-modal-close" type="button" data-close-profile-modal="true">Close</button>
        </div>
        <form class="profile-form" id="profile-form">
          <label class="settings-field" for="profile-username">
            <span>Username</span>
            <input id="profile-username" name="username" type="text" maxlength="24" placeholder="Spartan" />
          </label>
          <label class="settings-field" for="profile-avatar-url">
            <span>Profile picture URL</span>
            <input id="profile-avatar-url" name="avatar_url" type="url" placeholder="https://..." />
          </label>
          <div class="profile-form-actions">
            <button class="settings-save" type="submit">Save Profile</button>
          </div>
        </form>
        <p class="profile-form-status" id="profile-form-status"></p>
      </section>
    </div>
  `;

    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  function ensureSpartaWalletModal() {
    let modal = document.getElementById("sparta-wallet-modal");
    if (modal) {
      return modal;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
    <div class="profile-modal" id="sparta-wallet-modal" hidden>
      <div class="profile-modal-backdrop" data-close-sparta-wallet-modal="true"></div>
      <section class="profile-modal-card" aria-modal="true" role="dialog" aria-labelledby="sparta-wallet-modal-title">
        <div class="profile-modal-head">
          <div>
            <p class="profile-modal-kicker">Sparta Wallet</p>
            <h3 id="sparta-wallet-modal-title">Connect Sparta Wallet</h3>
          </div>
          <button class="profile-modal-close" type="button" data-close-sparta-wallet-modal="true">Close</button>
        </div>
        <form class="profile-form" id="sparta-wallet-form">
          <label class="settings-field" for="sparta-wallet-name">
            <span>Wallet name</span>
            <input id="sparta-wallet-name" name="wallet_name" type="text" maxlength="64" autocomplete="off" placeholder="Sparta Wallet One" />
          </label>
          <label class="settings-field" for="sparta-wallet-private-key">
            <span>Private key</span>
            <input id="sparta-wallet-private-key" name="private_key" type="text" autocomplete="off" placeholder="Leave empty to create a new Sparta Wallet" />
          </label>
          <div class="profile-form-actions">
            <button class="settings-save" type="button" data-sparta-wallet-submit="create">Create Wallet</button>
            <button class="wallet-option" type="button" data-sparta-wallet-submit="import">Import Wallet</button>
          </div>
        </form>
        <p class="profile-form-status" id="sparta-wallet-form-status"></p>
      </section>
    </div>
  `;

    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  function ensureSpartaWalletKeyModal() {
    let modal = document.getElementById("sparta-wallet-key-modal");
    if (modal) {
      return modal;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
    <div class="profile-modal" id="sparta-wallet-key-modal" hidden>
      <div class="profile-modal-backdrop" data-close-sparta-wallet-key-modal="true"></div>
      <section class="profile-modal-card" aria-modal="true" role="dialog" aria-labelledby="sparta-wallet-key-modal-title">
        <div class="profile-modal-head">
          <div>
            <p class="profile-modal-kicker">Sparta Wallet</p>
            <h3 id="sparta-wallet-key-modal-title">Save Your Private Key</h3>
          </div>
          <button class="profile-modal-close" type="button" data-close-sparta-wallet-key-modal="true">Close</button>
        </div>
        <div class="profile-form">
          <p class="profile-form-status">This private key is shown once. Save it now. Sparta cannot show it again later.</p>
          <label class="settings-field" for="sparta-wallet-key-output">
            <span>Private key</span>
            <textarea id="sparta-wallet-key-output" class="sparta-wallet-key-output" readonly></textarea>
          </label>
          <div class="profile-form-actions">
            <button class="settings-save" type="button" data-copy-sparta-wallet-key="true">Copy Private Key</button>
            <button class="wallet-option" type="button" data-close-sparta-wallet-key-modal="true">Done</button>
          </div>
          <p class="profile-form-status" id="sparta-wallet-key-status"></p>
        </div>
      </section>
    </div>
  `;

    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  function ensureWalletLoginModal() {
    let modal = document.getElementById("wallet-login-modal");
    if (modal) {
      return modal;
    }

    const optionsMarkup = getWalletLoginOptions()
      .map(
        (option) => `
    <button class="wallet-login-option" type="button" data-wallet-action="${
      option.id
    }">
      <span class="wallet-login-option-icon">${option.iconMarkup}</span>
      <span class="wallet-login-option-copy">
        <strong>${escapeHtml(option.label)}</strong>
        ${
          option.badge
            ? `<span class="wallet-login-option-badge">${escapeHtml(
                option.badge
              )}</span>`
            : ""
        }
      </span>
    </button>
  `
      )
      .join("");

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
    <div class="profile-modal wallet-login-modal" id="wallet-login-modal" hidden>
      <div class="profile-modal-backdrop" data-close-wallet-login-modal="true"></div>
      <section class="profile-modal-card wallet-login-modal-card" aria-modal="true" role="dialog" aria-labelledby="wallet-login-modal-title">
        <div class="profile-modal-head wallet-login-modal-head">
          <div>
            <p class="profile-modal-kicker">Wallet Access</p>
            <h3 id="wallet-login-modal-title">LOGIN</h3>
          </div>
          <button class="profile-modal-close" type="button" data-close-wallet-login-modal="true" aria-label="Close login modal">Close</button>
        </div>
        <div class="wallet-login-grid">${optionsMarkup}</div>
        <p class="profile-form-status wallet-login-status" id="wallet-login-status">${
          isMobileDevice()
            ? "Choose a wallet to sign in. Supported mobile wallets will continue into their approval flow automatically."
            : "Choose a wallet to sign in."
        }</p>
      </section>
    </div>
  `;

    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  function ensureHelpModal() {
    let modal = document.getElementById("profile-help-modal");
    if (modal) {
      return modal;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
    <div class="profile-modal" id="profile-help-modal" hidden>
      <div class="profile-modal-backdrop" data-close-help-modal="true"></div>
      <section class="profile-modal-card" aria-modal="true" role="dialog" aria-labelledby="profile-help-modal-title">
        <div class="profile-modal-head">
          <div>
            <p class="profile-modal-kicker">Sparta Help</p>
            <h3 id="profile-help-modal-title">Help & Onboarding</h3>
          </div>
          <button class="profile-modal-close" type="button" data-close-help-modal="true">Close</button>
        </div>
        <div class="profile-form">
          <p class="profile-form-status">
            Run the guided webapp tour again at any time. It will start from step 1 and guide you across pages.
          </p>
          <div class="profile-form-actions">
            <button class="settings-save" type="button" id="profile-help-replay-tour">Replay Tour</button>
          </div>
          <p class="profile-form-status">
            If you have any issues or questions, contact <a href="mailto:contact@sparta.wtf">contact@sparta.wtf</a>.
          </p>
        </div>
      </section>
    </div>
  `;

    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  function applySummaryUi() {
    const summary = document.getElementById("profile-summary");
    const summaryName = document.getElementById("profile-summary-name");
    const summaryId = document.getElementById("profile-summary-id");
    const summaryAvatar = document.getElementById("profile-summary-avatar");
    const session = readWalletSession();
    const profile = readProfile(session);

    if (summaryName) {
      summaryName.textContent = profile.username;
    }

    if (summaryId) {
      summaryId.textContent = session?.address ? "Connected" : "Not connected";
    }

    if (summaryAvatar) {
      summaryAvatar.innerHTML = buildAvatarMarkup(profile, session);
    }

    if (summary) {
      summary.dataset.connected = session?.address ? "true" : "false";
      summary.title = session?.address
        ? `${session.walletType || "Wallet"} connected: ${session.address}`
        : "No wallet connected";
    }

    if (summaryName) {
      summaryName.hidden = true;
    }

    if (summaryId) {
      summaryId.hidden = true;
    }
  }

  function closeMenu() {
    const menu = document.querySelector(".wallet-menu");
    if (menu) {
      menu.open = false;
    }
  }

  function isPropTradingSurface() {
    const pathname = String(window.location.pathname || "").toLowerCase();
    const hostname = String(window.location.hostname || "")
      .trim()
      .toLowerCase();
    return (
      hostname === "proptrading.sparta.wtf" ||
      pathname === "/proptrading" ||
      pathname === "/bsc/proptrading" ||
      pathname === "/proptrading.html" ||
      pathname === "/dashboard" ||
      pathname === "/bsc/dashboard" ||
      pathname === "/dashboard.html"
    );
  }

  function getPropDashboardHref() {
    const search = String(window.location.search || "").trim();
    const currentOrigin = String(window.location.origin || "").trim();
    const currentHost = String(window.location.hostname || "")
      .trim()
      .toLowerCase();
    const isLocalHost =
      currentHost === "localhost" ||
      currentHost === "127.0.0.1" ||
      currentHost === "0.0.0.0" ||
      currentHost === "[::1]";

    if (!isLocalHost) {
      return `https://proptrading.sparta.wtf/dashboard${search}`;
    }
    return `${currentOrigin}/dashboard${search}`;
  }

  function openProfileModal() {
    const modal = ensureProfileModal();
    const session = readWalletSession();
    const profile = readProfile(session);
    const usernameInput = modal.querySelector("#profile-username");
    const avatarInput = modal.querySelector("#profile-avatar-url");
    const status = modal.querySelector("#profile-form-status");

    if (usernameInput) {
      usernameInput.value = profile.username;
    }
    if (avatarInput) {
      avatarInput.value = profile.avatarUrl;
    }
    if (status) {
      status.textContent = session?.address
        ? ""
        : "Connect a wallet first to save a profile.";
    }

    modal.hidden = false;
    window.setTimeout(() => usernameInput?.focus(), 0);
  }

  function closeProfileModal() {
    const modal = document.getElementById("profile-modal");
    if (modal) {
      modal.hidden = true;
    }
  }

  function closeSpartaWalletModal(error = null) {
    const modal = document.getElementById("sparta-wallet-modal");
    if (modal) {
      modal.hidden = true;
    }

    if (pendingSpartaWalletRequest) {
      const pending = pendingSpartaWalletRequest;
      pendingSpartaWalletRequest = null;
      if (error) {
        pending.reject(error);
      }
    }
  }

  function openSpartaWalletKeyModal(privateKey) {
    const value = String(privateKey || "").trim();
    if (!value) {
      return;
    }

    const modal = ensureSpartaWalletKeyModal();
    const output = modal.querySelector("#sparta-wallet-key-output");
    const status = modal.querySelector("#sparta-wallet-key-status");
    if (output) {
      output.value = value;
    }
    if (status) {
      status.textContent = "";
    }
    modal.hidden = false;
    window.setTimeout(() => {
      output?.focus();
      output?.select();
    }, 0);
  }

  function closeSpartaWalletKeyModal() {
    const modal = document.getElementById("sparta-wallet-key-modal");
    if (!modal) {
      return;
    }
    modal.hidden = true;
    const output = modal.querySelector("#sparta-wallet-key-output");
    const status = modal.querySelector("#sparta-wallet-key-status");
    if (output) {
      output.value = "";
    }
    if (status) {
      status.textContent = "";
    }
  }

  function openWalletLoginModal() {
    const modal = ensureWalletLoginModal();
    const status = modal.querySelector("#wallet-login-status");
    if (status) {
      status.textContent = "Choose a wallet to sign in.";
    }
    modal.hidden = false;
  }

  function closeWalletLoginModal() {
    const modal = document.getElementById("wallet-login-modal");
    if (modal) {
      modal.hidden = true;
    }
  }

  function openHelpModal() {
    const modal = ensureHelpModal();
    modal.hidden = false;
  }

  function closeHelpModal() {
    const modal = document.getElementById("profile-help-modal");
    if (modal) {
      modal.hidden = true;
    }
  }

  function triggerTourReplay() {
    const chain = getActivePageChain();
    window.localStorage.setItem(SPARTA_THEME_KEY, "dark");
    if (document?.body) {
      document.body.dataset.theme = "dark";
    }
    window.localStorage.setItem(
      SPARTA_TOUR_STATE_KEY,
      JSON.stringify({
        completed: false,
        inProgress: true,
        stepIndex: 0,
        chain,
      })
    );
    window.location.assign(getHomeHref(chain));
  }

  function openSpartaWalletModal() {
    const modal = ensureSpartaWalletModal();
    const walletNameInput = modal.querySelector("#sparta-wallet-name");
    const privateKeyInput = modal.querySelector("#sparta-wallet-private-key");
    const status = modal.querySelector("#sparta-wallet-form-status");
    const activeChain = getActivePageChain();

    if (walletNameInput) {
      walletNameInput.value = "";
      walletNameInput.placeholder =
        activeChain === "sol" ? "Sparta Sol Wallet" : "Sparta BSC Wallet";
    }
    if (privateKeyInput) {
      privateKeyInput.value = "";
      privateKeyInput.placeholder = "0x... or base58 / [1,2,3,...]";
    }
    if (status) {
      status.textContent =
        "Import an existing BSC or Solana private key, or create a new Sparta Wallet for this page chain.";
    }

    modal.hidden = false;
    window.setTimeout(() => privateKeyInput?.focus(), 0);

    if (pendingSpartaWalletRequest) {
      pendingSpartaWalletRequest.reject(new Error("sparta_wallet_replaced"));
    }

    return new Promise((resolve, reject) => {
      pendingSpartaWalletRequest = { resolve, reject };
    });
  }

  async function submitSpartaWalletAuth(action) {
    const modal = ensureSpartaWalletModal();
    const walletNameInput = modal.querySelector("#sparta-wallet-name");
    const privateKeyInput = modal.querySelector("#sparta-wallet-private-key");
    const status = modal.querySelector("#sparta-wallet-form-status");
    const normalizedAction = action === "create" ? "create" : "import";
    const selectedChain = getActivePageChain();
    const walletName = String(walletNameInput?.value || "").trim();
    const privateKey = String(privateKeyInput?.value || "").trim();

    if (!walletName) {
      if (status) {
        status.textContent = "Enter a wallet name first.";
      }
      walletNameInput?.focus();
      return;
    }

    if (normalizedAction === "import" && !privateKey) {
      if (status) {
        status.textContent =
          "Paste a BSC or Solana private key to import a Sparta Wallet.";
      }
      privateKeyInput?.focus();
      return;
    }

    if (status) {
      status.textContent =
        normalizedAction === "create"
          ? "Creating Sparta Wallet..."
          : "Importing Sparta Wallet...";
    }

    try {
      const response = await fetch("/api/auth/sparta-wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: normalizedAction,
          chain: selectedChain,
          wallet_name: walletName,
          private_key: privateKey,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.error || payload.status || `api ${response.status}`
        );
      }

      const session = writeWalletSession("Sparta Wallet", payload.address);
      if (normalizedAction === "create" && payload.privateKey) {
        openSpartaWalletKeyModal(payload.privateKey);
      }

      const pending = pendingSpartaWalletRequest;
      pendingSpartaWalletRequest = null;
      modal.hidden = true;
      pending?.resolve({ session, privateKey: payload.privateKey || "" });
    } catch (error) {
      if (status) {
        status.textContent = mapProfileMenuError(
          error,
          "Sparta Wallet failed."
        );
      }
    }
  }

  function renderProfileDropdown(statusMessage = "") {
    const dropdown = document.getElementById("profile-dropdown");
    if (!dropdown) {
      return;
    }

    const session = readWalletSession();
    const profile = readProfile(session);
    const sessionLabel = session?.address
      ? `${escapeHtml(session.walletType || "Wallet")} · ${escapeHtml(
          shortAddress(session.address)
        )}`
      : "Connect a wallet to personalize this profile";
    const connectionMarkup = session?.address
      ? '<span class="profile-menu-connection-pill">Connected</span>'
      : '<span class="profile-menu-connection-pill is-disconnected">Not connected</span>';
    const propMenuActions = `
    <button class="wallet-option" type="button" data-profile-action="open-profile">Profile</button>
    <button class="wallet-option" type="button" data-profile-action="open-dashboard">Dashboard</button>
    ${
      session?.address
        ? '<button class="wallet-option wallet-option-danger" type="button" data-profile-action="logout">Logout</button>'
        : '<button class="wallet-option" type="button" data-profile-action="login">Login</button>'
    }
  `;
    const defaultMenuActions = `
    <button class="wallet-option" type="button" data-profile-action="open-profile">${
      session?.address ? "Profile" : "Set Up Profile"
    }</button>
    <button class="wallet-option" type="button" data-profile-action="open-settings">Settings</button>
    ${
      session?.address
        ? '<button class="wallet-option" type="button" data-profile-action="open-wallets">Wallets</button>'
        : ""
    }
    <button class="wallet-option" type="button" data-profile-action="open-orders">Orders</button>
    <button class="wallet-option" type="button" data-profile-action="open-referral">Referral</button>
    <button class="wallet-option" type="button" data-profile-action="open-stats">Stats</button>
    <button class="wallet-option" type="button" data-profile-action="open-points">Points</button>
    <button class="wallet-option" type="button" data-profile-action="help">Help</button>
    ${
      session?.address
        ? ""
        : '<button class="wallet-option" type="button" data-profile-action="login">Login</button>'
    }
    ${
      session?.address
        ? '<button class="wallet-option wallet-option-danger" type="button" data-profile-action="logout">Logout</button>'
        : ""
    }
  `;

    dropdown.innerHTML = `
    <section class="profile-menu-card">
      <div class="profile-menu-head">
        <div class="profile-menu-avatar">${buildAvatarMarkup(
          profile,
          session
        )}</div>
        <div class="profile-menu-copy">
          <h3>${escapeHtml(profile.username)}</h3>
          <p>ID: ${escapeHtml(sessionLabel)}</p>
          ${connectionMarkup}
        </div>
      </div>
      <div class="profile-menu-actions">
        ${isPropTradingSurface() ? propMenuActions : defaultMenuActions}
      </div>
      <p class="profile-menu-status" id="profile-menu-status">${escapeHtml(
        statusMessage
      )}</p>
    </section>
  `;
  }

  async function handleProfileDropdownClick(event) {
    const actionButton = event.target.closest(
      "[data-profile-action], [data-wallet-action]"
    );
    if (!actionButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const statusNode = document.getElementById("profile-menu-status");
    const setStatus = (value) => {
      if (statusNode) {
        statusNode.textContent = value;
      }
    };

    const walletAction = actionButton.dataset.walletAction;
    if (walletAction === "metamask") {
      try {
        await connectMetaMask();
        applySummaryUi();
        renderProfileDropdown("MetaMask connected.");
        closeMenu();
      } catch (error) {
        setStatus(mapProfileMenuError(error, "MetaMask failed."));
      }
      return;
    }

    if (walletAction === "phantom") {
      try {
        await connectPhantom();
        applySummaryUi();
        renderProfileDropdown("Phantom connected.");
        closeMenu();
      } catch (error) {
        setStatus(mapProfileMenuError(error, "Phantom failed."));
      }
      return;
    }

    if (walletAction === "sparta") {
      try {
        await openSpartaWalletModal();
        applySummaryUi();
        renderProfileDropdown("Sparta Wallet connected.");
        closeMenu();
      } catch (error) {
        if (
          error?.message &&
          !["sparta_wallet_cancelled", "sparta_wallet_replaced"].includes(
            error.message
          )
        ) {
          setStatus(mapProfileMenuError(error, "Sparta Wallet failed."));
        }
      }
      return;
    }

    if (walletAction === "rabby") {
      try {
        await connectRabby();
        applySummaryUi();
        renderProfileDropdown("Rabby connected.");
        closeMenu();
      } catch (error) {
        setStatus(mapProfileMenuError(error, "Rabby failed."));
      }
      return;
    }

    if (walletAction === "coinbase") {
      try {
        await connectCoinbase();
        applySummaryUi();
        renderProfileDropdown("Coinbase Wallet connected.");
        closeMenu();
      } catch (error) {
        setStatus(mapProfileMenuError(error, "Coinbase Wallet failed."));
      }
      return;
    }

    if (walletAction === "walletconnect") {
      try {
        await connectWalletConnect();
        applySummaryUi();
        renderProfileDropdown("WalletConnect connected.");
        closeMenu();
      } catch (error) {
        setStatus(mapProfileMenuError(error, "WalletConnect failed."));
      }
      return;
    }

    const action = actionButton.dataset.profileAction;
    if (action === "open-profile") {
      openProfileModal();
      return;
    }

    if (action === "open-settings") {
      window.location.href = getChainAwareHref("./settings.html");
      return;
    }

    if (action === "open-dashboard") {
      window.location.href = getPropDashboardHref();
      return;
    }

    if (action === "open-wallets") {
      window.location.href = getChainAwareHref("./wallets.html");
      return;
    }

    if (action === "open-orders") {
      window.location.href = getChainAwareHref("./orders.html");
      return;
    }

    if (action === "open-referral") {
      window.location.href = getChainAwareHref("./referral.html");
      return;
    }

    if (action === "open-stats") {
      window.location.href = getChainAwareHref("./stats.html");
      return;
    }

    if (action === "open-points") {
      window.location.href = getChainAwareHref("./points.html");
      return;
    }

    if (action === "login") {
      openWalletLoginModal();
      closeMenu();
      return;
    }

    if (action === "help") {
      openHelpModal();
      closeMenu();
      return;
    }

    if (action === "logout") {
      try {
        await window.phantom?.solana?.disconnect?.();
      } catch {}
      clearWalletSession();
      applySummaryUi();
      renderProfileDropdown("Wallet disconnected.");
      closeMenu();
    }
  }

  function bindProfileModal() {
    const modal = ensureProfileModal();
    modal.addEventListener("click", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-close-profile-modal="true"]')
      ) {
        closeProfileModal();
      }
    });

    modal
      .querySelector("#profile-form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        const session = readWalletSession();
        const status = modal.querySelector("#profile-form-status");
        if (!session?.address) {
          if (status) {
            status.textContent = "Connect a wallet first to save a profile.";
          }
          return;
        }

        const formData = new FormData(event.currentTarget);
        saveProfile(
          {
            username: formData.get("username"),
            avatarUrl: formData.get("avatar_url"),
          },
          session
        );

        if (status) {
          status.textContent = "Profile saved.";
        }
        applySummaryUi();
        renderProfileDropdown("Profile updated.");
        window.setTimeout(closeProfileModal, 300);
      });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeProfileModal();
      }
    });
  }

  function bindSpartaWalletModal() {
    const modal = ensureSpartaWalletModal();
    modal.addEventListener("click", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-close-sparta-wallet-modal="true"]')
      ) {
        closeSpartaWalletModal(new Error("sparta_wallet_cancelled"));
      }
    });

    modal.querySelectorAll("[data-sparta-wallet-submit]").forEach((button) => {
      button.addEventListener("click", async () => {
        await submitSpartaWalletAuth(button.dataset.spartaWalletSubmit);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeSpartaWalletModal(new Error("sparta_wallet_cancelled"));
      }
    });
  }

  function bindSpartaWalletKeyModal() {
    const modal = ensureSpartaWalletKeyModal();
    modal.addEventListener("click", async (event) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      if (event.target.closest('[data-close-sparta-wallet-key-modal="true"]')) {
        closeSpartaWalletKeyModal();
        return;
      }

      if (event.target.closest('[data-copy-sparta-wallet-key="true"]')) {
        const output = modal.querySelector("#sparta-wallet-key-output");
        const status = modal.querySelector("#sparta-wallet-key-status");
        const value = String(output?.value || "").trim();
        if (!value) {
          return;
        }
        try {
          if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
          } else {
            output?.focus();
            output?.select();
            document.execCommand("copy");
          }
          if (status) {
            status.textContent = "Private key copied.";
          }
        } catch {
          if (status) {
            status.textContent =
              "Copy failed. Select and copy the key manually.";
          }
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeSpartaWalletKeyModal();
      }
    });
  }

  function bindWalletLoginModal() {
    const modal = ensureWalletLoginModal();
    modal.addEventListener("click", async (event) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      if (event.target.closest('[data-close-wallet-login-modal="true"]')) {
        closeWalletLoginModal();
        return;
      }

      const actionButton = event.target.closest("[data-wallet-action]");
      if (!actionButton) {
        return;
      }

      const status = modal.querySelector("#wallet-login-status");
      const setStatus = (value) => {
        if (status) {
          status.textContent = value;
        }
      };

      const walletAction = actionButton.dataset.walletAction;
      if (walletAction === "metamask") {
        try {
          setStatus("Connecting MetaMask...");
          await connectMetaMask();
          closeWalletLoginModal();
          applySummaryUi();
          renderProfileDropdown("MetaMask connected.");
        } catch (error) {
          setStatus(mapProfileMenuError(error, "MetaMask failed."));
        }
        return;
      }

      if (walletAction === "phantom") {
        try {
          setStatus("Connecting Phantom...");
          await connectPhantom();
          closeWalletLoginModal();
          applySummaryUi();
          renderProfileDropdown("Phantom connected.");
        } catch (error) {
          setStatus(mapProfileMenuError(error, "Phantom failed."));
        }
        return;
      }

      if (walletAction === "sparta") {
        try {
          setStatus("Opening Sparta Wallet...");
          closeWalletLoginModal();
          await openSpartaWalletModal();
          applySummaryUi();
          renderProfileDropdown("Sparta Wallet connected.");
        } catch (error) {
          if (
            error?.message &&
            !["sparta_wallet_cancelled", "sparta_wallet_replaced"].includes(
              error.message
            )
          ) {
            openWalletLoginModal();
            setStatus(mapProfileMenuError(error, "Sparta Wallet failed."));
          }
        }
        return;
      }

      if (walletAction === "rabby") {
        try {
          setStatus("Connecting Rabby...");
          await connectRabby();
          closeWalletLoginModal();
          applySummaryUi();
          renderProfileDropdown("Rabby connected.");
        } catch (error) {
          setStatus(mapProfileMenuError(error, "Rabby failed."));
        }
        return;
      }

      if (walletAction === "coinbase") {
        try {
          setStatus("Connecting Coinbase Wallet...");
          await connectCoinbase();
          closeWalletLoginModal();
          applySummaryUi();
          renderProfileDropdown("Coinbase Wallet connected.");
        } catch (error) {
          setStatus(mapProfileMenuError(error, "Coinbase Wallet failed."));
        }
        return;
      }

      if (walletAction === "walletconnect") {
        try {
          setStatus("Connecting WalletConnect...");
          await connectWalletConnect();
          closeWalletLoginModal();
          applySummaryUi();
          renderProfileDropdown("WalletConnect connected.");
        } catch (error) {
          setStatus(mapProfileMenuError(error, "WalletConnect failed."));
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeWalletLoginModal();
      }
    });
  }

  async function resumePendingMobileWalletAction() {
    if (!isMobileDevice()) {
      return;
    }

    const pending = readPendingWalletAction();
    if (!pending?.walletType) {
      return;
    }

    const walletType = String(pending.walletType || "").trim();
    const intent = String(pending.intent || "connect").trim();
    const hasProvider =
      (walletType === "MetaMask" && Boolean(getMetaMaskProvider())) ||
      (walletType === "Phantom" && isPhantomDetected()) ||
      (walletType === "Coinbase Wallet" && Boolean(getCoinbaseProvider()));

    if (!hasProvider) {
      return;
    }

    clearPendingWalletAction();

    try {
      if (intent === "auth") {
        await ensureServerAuth({ interactive: true });
        applySummaryUi();
        renderProfileDropdown(`${walletType} connected.`);
        return;
      }

      if (walletType === "MetaMask") {
        await connectMetaMask();
        applySummaryUi();
        renderProfileDropdown("MetaMask connected.");
        return;
      }

      if (walletType === "Phantom") {
        await connectPhantom();
        applySummaryUi();
        renderProfileDropdown("Phantom connected.");
        return;
      }

      if (walletType === "Coinbase Wallet") {
        await connectCoinbase();
        applySummaryUi();
        renderProfileDropdown("Coinbase Wallet connected.");
      }
    } catch (error) {
      console.error("Unable to resume pending mobile wallet action.", error);
    }
  }

  function schedulePendingMobileWalletResume() {
    if (!isMobileDevice()) {
      return;
    }

    [0, 400, 1200, 2500].forEach((delay) => {
      window.setTimeout(() => {
        resumePendingMobileWalletAction().catch((error) => {
          console.error("Failed to resume mobile wallet action.", error);
        });
      }, delay);
    });
  }

  function bindHelpModal() {
    const modal = ensureHelpModal();
    modal.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      if (event.target.closest('[data-close-help-modal="true"]')) {
        closeHelpModal();
        return;
      }

      if (event.target.closest("#profile-help-replay-tour")) {
        closeHelpModal();
        triggerTourReplay();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeHelpModal();
      }
    });
  }

  function initProfileMenu() {
    if (!document.getElementById("profile-summary")) {
      return;
    }

    initMobileTopbarNav();
    applySummaryUi();
    renderProfileDropdown();
    bindProfileModal();
    bindSpartaWalletModal();
    bindSpartaWalletKeyModal();
    bindWalletLoginModal();
    bindHelpModal();

    document
      .getElementById("profile-dropdown")
      ?.addEventListener("click", handleProfileDropdownClick);
    document
      .getElementById("profile-dropdown")
      ?.addEventListener("pointerup", handleProfileDropdownClick);

    window.addEventListener("sparta:wallet-session-changed", () => {
      applySummaryUi();
      renderProfileDropdown();
    });

    window.addEventListener("sparta:profile-updated", () => {
      applySummaryUi();
      renderProfileDropdown();
    });

    schedulePendingMobileWalletResume();
    window.addEventListener("pageshow", schedulePendingMobileWalletResume);
    window.addEventListener("focus", schedulePendingMobileWalletResume);
  }

  function initMoreMenus() {
    const closableMenuSelectors = [
      ".more-menu",
      ".network-menu",
      ".alert-menu",
      ".wallet-menu",
      ".mobile-nav-menu",
      ".mobile-chain-menu",
      ".mobile-submenu",
    ];
    const menus = closableMenuSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((menu) => menu instanceof HTMLDetailsElement);

    if (!menus.length) {
      return;
    }

    const closeAllMenus = (exceptMenu = null) => {
      menus.forEach((menu) => {
        const isSameMenu = menu === exceptMenu;
        const isAncestorOfExcept =
          exceptMenu instanceof Element && menu.contains(exceptMenu);
        if (!isSameMenu && !isAncestorOfExcept) {
          menu.open = false;
        }
      });
    };

    menus.forEach((menu) => {
      menu.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
          window.setTimeout(() => closeAllMenus(), 0);
        });
      });

      menu.addEventListener("toggle", () => {
        if (menu.open) {
          closeAllMenus(menu);
        }
      });

      const summary = menu.querySelector(":scope > summary");
      if (!summary) {
        return;
      }

      summary.addEventListener("click", (event) => {
        event.preventDefault();
        const willOpen = !menu.open;
        closeAllMenus(menu);
        menu.open = willOpen;
      });
    });

    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const clickedMenu = event.target.closest(
        closableMenuSelectors.join(", ")
      );
      if (!clickedMenu) {
        closeAllMenus();
        return;
      }

      if (event.target.closest("summary")) {
        return;
      }

      if (event.target.closest("a")) {
        window.setTimeout(closeAllMenus, 0);
        return;
      }

      if (event.target.closest('button, [role="button"]')) {
        if (event.target.closest("#profile-dropdown")) {
          return;
        }
        closeAllMenus();
      }
    });
  }

  function detectCurrentPageForMenus() {
    const pathname = String(window.location.pathname || "").toLowerCase();
    if (
      pathname === "/bsc/copytrade" ||
      pathname === "/sol/copytrade" ||
      pathname === "/eth/copytrade" ||
      pathname === "/base/copytrade" ||
      pathname.endsWith("/copytrade.html")
    ) {
      return "copytrade";
    }
    if (
      pathname === "/transfer" ||
      pathname === "/sol/transfer" ||
      pathname === "/eth/transfer" ||
      pathname === "/base/transfer" ||
      pathname.endsWith("/transfer.html")
    ) {
      return "transfer";
    }
    if (
      pathname === "/bridge" ||
      pathname === "/bsc/bridge" ||
      pathname === "/sol/bridge" ||
      pathname === "/eth/bridge" ||
      pathname === "/base/bridge" ||
      pathname.endsWith("/bridge.html")
    ) {
      return "bridge";
    }
    if (
      pathname === "/bsc/keyword" ||
      pathname === "/sol/keyword" ||
      pathname === "/base/keyword" ||
      pathname.endsWith("/keyword.html")
    ) {
      return "keyword";
    }
    if (
      pathname === "/bsc/situation-room" ||
      pathname === "/sol/situation-room" ||
      pathname === "/base/situation-room" ||
      pathname.endsWith("/situation-room.html")
    ) {
      return "situation-room";
    }
    if (
      pathname === "/bsc/events" ||
      pathname === "/sol/events" ||
      pathname === "/base/events" ||
      pathname.endsWith("/events.html")
    ) {
      return "events";
    }
    return "";
  }

  function syncDesktopMoreMenus() {
    const activeChain = getActivePageChain();
    const currentPage = detectCurrentPageForMenus();
    const desiredLinks = [
      ...(activeChain === "eth"
        ? [{ page: "copytrade", label: "Copy Trade" }]
        : []),
      { page: "keyword", label: "Keyword Trading" },
      { page: "transfer", label: "Transfer" },
      { page: "situation-room", label: "Situation Room" },
      { page: "bridge", label: "Bridge" },
      { page: "events", label: "Events" },
    ];

    document.querySelectorAll(".more-dropdown").forEach((dropdown) => {
      const existingLinks = Array.from(
        dropdown.querySelectorAll(":scope > a.more-link")
      );
      const findExistingLink = (page) =>
        existingLinks.find((link) => {
          const href = String(link.getAttribute("href") || "").toLowerCase();
          const text = String(link.textContent || "")
            .trim()
            .toLowerCase();
          if (page === "copytrade") {
            return (
              link.dataset.spartaPage === "copytrade" ||
              href.includes("copytrade") ||
              text === "copy trade"
            );
          }
          if (page === "keyword") {
            return (
              link.dataset.spartaPage === "keyword" || text.includes("keyword")
            );
          }
          if (page === "transfer") {
            return href.includes("transfer") || text === "transfer";
          }
          if (page === "situation-room") {
            return (
              href.includes("situation-room") || text.includes("situation room")
            );
          }
          if (page === "bridge") {
            return href.includes("bridge") || text === "bridge";
          }
          if (page === "events") {
            return href.includes("events") || text === "events";
          }
          return false;
        });

      const fragment = document.createDocumentFragment();
      desiredLinks.forEach(({ page, label }) => {
        const link = findExistingLink(page) || document.createElement("a");
        link.className = "more-link";
        link.href = getPageHref(page, activeChain);
        link.textContent = label;
        if (page === "keyword" || page === "copytrade") {
          link.dataset.spartaPage = page;
        } else {
          delete link.dataset.spartaPage;
        }
        if (currentPage === page) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
        fragment.appendChild(link);
      });

      dropdown.replaceChildren(fragment);
    });
  }

  function buildMobileNavMarkup() {
    const activeChain = getActivePageChain();
    const chainLabel =
      activeChain === "sol"
        ? "SOL"
        : activeChain === "eth"
        ? "ETH"
        : activeChain === "base"
        ? "BASE"
        : "BNB";
    const homeHref = getHomeHref(activeChain);
    const discoverHref = getPageHref("discover", activeChain);
    const tradeHref = getPageHref("trade", activeChain);
    const copyTradeHref = getPageHref("copytrade", activeChain);
    const aiTradingHref = getPageHref("ai-trading", activeChain);
    const spamHref = getPageHref("spam", activeChain);
    const keywordHref = getPageHref("keyword", activeChain);
    const transferHref = getPageHref("transfer", activeChain);
    const situationRoomHref = getPageHref("situation-room", activeChain);
    const eventsHref = getPageHref("events", activeChain);
    const statsHref = getPageHref("stats", activeChain);
    const bridgeHref = getPageHref("bridge", activeChain);
    const pointsHref = getPageHref("points", activeChain);
    return `
    <div class="mobile-topbar-left">
      <a class="mobile-topbar-home" href="${escapeHtml(
        homeHref
      )}" aria-label="Go to Sparta home">
        <img class="mobile-topbar-home-image" src="/spartaicon.png" alt="" />
      </a>
      <details class="mobile-nav-menu">
        <summary class="mobile-nav-summary" aria-label="Open navigation menu">
          <span></span>
          <span></span>
          <span></span>
        </summary>
        <div class="mobile-nav-dropdown" aria-label="Mobile navigation">
          <div class="mobile-nav-links">
            <a class="more-link" href="${escapeHtml(discoverHref)}">Discover</a>
            <a class="more-link" href="${escapeHtml(tradeHref)}">Trade</a>
            ${
              activeChain === "eth"
                ? ""
                : `<a class="more-link" href="${escapeHtml(
                    copyTradeHref
                  )}">Copy Trade</a>`
            }
            <a class="more-link" href="${escapeHtml(
              aiTradingHref
            )}">AI Trading</a>
            ${
              activeChain === "eth" || activeChain === "base"
                ? `<a class="more-link" href="${escapeHtml(spamHref)}">Spam</a>`
                : ""
            }
            <details class="mobile-submenu">
              <summary class="mobile-submenu-summary">More</summary>
              <div class="mobile-nav-more-list">
                ${
                  activeChain === "eth"
                    ? `<a class="more-link" href="${escapeHtml(
                        copyTradeHref
                      )}">Copy Trade</a>`
                    : ""
                }
                <a class="more-link" href="${escapeHtml(
                  keywordHref
                )}">Keyword Trading</a>
                <a class="more-link" href="${escapeHtml(
                  transferHref
                )}">Transfer</a>
                <a class="more-link" href="${escapeHtml(
                  situationRoomHref
                )}">Situation Room</a>
                <a class="more-link" href="${escapeHtml(bridgeHref)}">Bridge</a>
                <a class="more-link" href="${escapeHtml(eventsHref)}">Events</a>
                <a class="more-link" href="${escapeHtml(statsHref)}">Stats</a>
                <a class="more-link" href="${escapeHtml(pointsHref)}">Points</a>
              </div>
            </details>
          </div>
        </div>
      </details>
      <details class="mobile-chain-menu">
        <summary class="mobile-chain-summary">${escapeHtml(
          chainLabel
        )}</summary>
        <div class="mobile-chain-dropdown" aria-label="Mobile chain selector">
          <a class="network-pill${
            activeChain === "bsc" ? " is-active" : ""
          }" href="${escapeHtml(getHomeHref("bsc"))}"${
      activeChain === "bsc" ? ' aria-current="page"' : ""
    }>BNB</a>
          <a class="network-pill${
            activeChain === "sol" ? " is-active" : ""
          }" href="${escapeHtml(getHomeHref("sol"))}"${
      activeChain === "sol" ? ' aria-current="page"' : ""
    }>SOL</a>
          <a class="network-pill${
            activeChain === "eth" ? " is-active" : ""
          }" href="${escapeHtml(getHomeHref("eth"))}"${
      activeChain === "eth" ? ' aria-current="page"' : ""
    }>ETH</a>
          <a class="network-pill${
            activeChain === "base" ? " is-active" : ""
          }" href="${escapeHtml(getHomeHref("base"))}"${
      activeChain === "base" ? ' aria-current="page"' : ""
    }>BASE</a>
        </div>
      </details>
    </div>
  `;
  }

  function initMobileTopbarNav() {
    const topbar = document.querySelector(".hero-topbar");
    if (!topbar) {
      return;
    }

    const existingMobileNav = topbar.querySelector(".mobile-topbar-left");
    if (existingMobileNav) {
      return;
    }

    const actions = topbar.querySelector(".hero-actions-topbar");
    if (!actions) {
      return;
    }

    actions.insertAdjacentHTML("beforebegin", buildMobileNavMarkup());
  }

  async function ensureServerAuth(options = {}) {
    const interactive = options.interactive !== false;
    const session = readWalletSession();
    if (!session?.address) {
      throw new Error("missing_wallet");
    }

    const normalizedAddress = isEvmWalletSession(session)
      ? String(session.address || "")
          .trim()
          .toLowerCase()
      : String(session.address || "").trim();
    const sessionResponse = await fetch("/api/auth/session", {
      cache: "no-store",
    });
    if (sessionResponse.ok) {
      const payload = await sessionResponse.json();
      const sessionAddress = isEvmWalletSession(session)
        ? String(payload.address || "")
            .trim()
            .toLowerCase()
        : String(payload.address || "").trim();
      if (sessionAddress === normalizedAddress) {
        return payload;
      }
    }

    if (!interactive) {
      if (isEvmWalletSession(session)) {
        const provider = getConnectedEvmProvider(session);
        if (!provider) {
          throw new Error("wallet_provider_unavailable");
        }
        const accounts = await provider.request({ method: "eth_accounts" });
        const account = String(accounts?.[0] || "")
          .trim()
          .toLowerCase();
        if (account !== normalizedAddress) {
          throw new Error("wallet_not_connected");
        }
        throw new Error("auth_required");
      }

      if (session.walletType === "Phantom") {
        const phantom = getInjectedSolanaProvider();
        if (!phantom) {
          throw new Error("wallet_provider_unavailable");
        }
        const connectedAddress = String(
          phantom.publicKey?.toString() || ""
        ).trim();
        if (connectedAddress !== String(session.address || "").trim()) {
          throw new Error("wallet_not_connected");
        }
        throw new Error("auth_required");
      }

      throw new Error("auth_required");
    }

    const challengeResponse = await fetch(
      `/api/auth/challenge?address=${encodeURIComponent(normalizedAddress)}`,
      {
        cache: "no-store",
      }
    );
    const challengePayload = await challengeResponse.json();
    if (!challengeResponse.ok) {
      throw new Error(
        challengePayload.error ||
          challengePayload.status ||
          `api ${challengeResponse.status}`
      );
    }

    let signature = "";
    let signatureFormat = "";
    let messageEncoding = "utf8";
    let signedMessage = "";
    let signedMessageFormat = "";
    try {
      if (isEvmWalletSession(session)) {
        const provider = interactive
          ? await getConnectedEvmProviderAsync(session)
          : getConnectedEvmProvider(session);
        if (!provider) {
          throw new Error("wallet_provider_unavailable");
        }

        const hexMessage = `0x${Array.from(
          new TextEncoder().encode(challengePayload.message),
          (byte) => byte.toString(16).padStart(2, "0")
        ).join("")}`;
        const attempts = [
          {
            method: "personal_sign",
            params: [challengePayload.message, normalizedAddress],
            messageEncoding: "utf8",
          },
          {
            method: "personal_sign",
            params: [hexMessage, normalizedAddress],
            messageEncoding: "hex",
          },
          {
            method: "personal_sign",
            params: [normalizedAddress, challengePayload.message],
            messageEncoding: "utf8",
          },
          {
            method: "personal_sign",
            params: [normalizedAddress, hexMessage],
            messageEncoding: "hex",
          },
        ];
        let lastSignError = null;
        for (const attempt of attempts) {
          try {
            signature = await provider.request({
              method: attempt.method,
              params: attempt.params,
            });
            messageEncoding = attempt.messageEncoding;
            break;
          } catch (error) {
            const code = Number(error?.code);
            const message = String(error?.message || "").toLowerCase();
            if (
              code === 4001 ||
              code === -32002 ||
              message.includes("user rejected") ||
              message.includes("user denied") ||
              message.includes("request already pending")
            ) {
              throw error;
            }
            lastSignError = error;
          }
        }

        if (!signature) {
          throw lastSignError || new Error("signature_declined");
        }
      } else if (session.walletType === "Phantom") {
        const phantom = getInjectedSolanaProvider();
        if (!phantom) {
          if (interactive && isMobileDevice()) {
            writePendingWalletAction("Phantom", "auth");
          }
          if (
            interactive &&
            isMobileDevice() &&
            openWalletBrowserDeepLink("Phantom")
          ) {
            throw new Error("wallet_app_redirect");
          }
          throw new Error("wallet_provider_unavailable");
        }

        const encodedMessage = new TextEncoder().encode(
          challengePayload.message
        );
        const signed = await phantom.signMessage(encodedMessage, "utf8");
        const signatureBytes = signed?.signature || signed;
        const signedMessageBytes =
          signed?.signedMessage || signed?.message || encodedMessage;
        signature = btoa(String.fromCharCode(...signatureBytes));
        signatureFormat = "base64";
        signedMessage = btoa(String.fromCharCode(...signedMessageBytes));
        signedMessageFormat = "base64";
      } else if (session.walletType === "Sparta Wallet") {
        if (!interactive) {
          throw new Error("auth_required");
        }

        await openSpartaWalletModal();
        const refreshedSession = readWalletSession();
        if (refreshedSession?.address) {
          return { status: "ok", address: refreshedSession.address };
        }
        throw new Error("auth_required");
      } else {
        throw new Error("unsupported_wallet_auth");
      }
    } catch (error) {
      if (
        error.message === "wallet_app_redirect" ||
        error.message === "wallet_provider_unavailable" ||
        error.message === "unsupported_wallet_auth" ||
        error.message === "wallet_not_connected" ||
        error.message === "auth_required"
      ) {
        throw error;
      }
      throw new Error("signature_declined");
    }

    const verifyResponse = await fetch("/api/auth/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: normalizedAddress,
        signature,
        signature_format: signatureFormat,
        message_encoding: messageEncoding,
        signed_message: signedMessage,
        signed_message_format: signedMessageFormat,
      }),
    });
    const verifyPayload = await verifyResponse.json();
    if (!verifyResponse.ok) {
      throw new Error(
        verifyPayload.error ||
          verifyPayload.status ||
          `api ${verifyResponse.status}`
      );
    }

    return verifyPayload;
  }

  window.SpartaProfileMenu = {
    readWalletSession,
    clearWalletSession,
    readProfile,
    saveProfile,
    shortAddress,
    ensureServerAuth,
    getConnectedEvmProvider,
    getConnectedEvmProviderAsync,
    initBscSharedSearch,
  };

  installCsrfFetchProtection();
  initBscSharedSearch();
  initProfileMenu();
  syncDesktopMoreMenus();
  initMoreMenus();
})();
