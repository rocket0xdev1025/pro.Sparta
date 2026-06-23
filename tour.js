(function () {
  const TOUR_STATE_KEY = "sparta-tour-state-v1";
  const HOME_PATH_BY_CHAIN = {
    bsc: "/",
    sol: "/sol",
  };
  const START_PATHS = new Set(["/", "/sol"]);

  const steps = [
    {
      title: "Chain Selector",
      text: "Use this selector to switch between different blockchain networks.",
      route: (chain) => HOME_PATH_BY_CHAIN[chain],
      selectors: [
        ".mobile-chain-menu .mobile-chain-summary",
        ".mobile-chain-menu",
        ".network-menu",
      ],
      prepare: () => {
        if (isMobileViewport()) {
          const mobileChainMenu = document.querySelector(".mobile-chain-menu");
          if (mobileChainMenu instanceof HTMLDetailsElement) {
            mobileChainMenu.open = true;
          }
        }
      },
    },
    {
      title: "Trending",
      text: "This row displays trending tokens for the active chain, along with key live metrics such as pair address, transaction count, volume, market cap, and token age.",
      route: (chain) => HOME_PATH_BY_CHAIN[chain],
      selectors: ["#deploy-feed", '[data-mobile-row-panel="deploy"]'],
    },
    {
      title: "Sparta AI Picks",
      text: "This is the Sparta AI Agent, designed to detect potential high-performing tokens. The AI Market Cap displays the token's market cap when the AI posted it, while the multiplier next to it shows the maximum multiplier reached afterward. The profit percentage below the age reflects the current profit based on the entry point identified by the AI.",
      route: (chain) => HOME_PATH_BY_CHAIN[chain],
      selectors: ["#ai-picks-feed", '[data-mobile-row-panel="ai-picks"]'],
      prepare: () => {
        ensureMobileRowTab("ai-picks");
      },
    },
    {
      title: "Migrated Tokens",
      text: "This row displays all tokens that have been migrated in the last 24 hours on Pump.fun or Four.meme.",
      route: (chain) => HOME_PATH_BY_CHAIN[chain],
      selectors: [
        "#migrated-ai-picks-feed",
        '[data-mobile-row-panel="moonshots"]',
      ],
      prepare: () => {
        ensureMobileRowTab("moonshots");
      },
    },
    {
      title: "Instant Buy Button",
      text: "Click the Buy button to instantly execute a trade (when the buy confirmation popup is disabled).",
      route: (chain) => HOME_PATH_BY_CHAIN[chain],
      target: () => {
        const buttons = Array.from(
          document.querySelectorAll("#ai-picks-feed .token-buy-button")
        );
        const visibleButton = buttons.find((node) => isVisible(node));
        if (visibleButton) {
          return visibleButton;
        }
        return document.querySelector("#ai-picks-feed");
      },
      selectors: [
        "#ai-picks-feed .token-card-link:first-of-type .token-buy-button",
        "#ai-picks-feed .token-buy-button:first-of-type",
        "#ai-picks-feed",
      ],
      prepare: () => {
        ensureMobileRowTab("ai-picks");
      },
    },
    {
      title: "Settings",
      text: "This is the Settings page, where you can configure how Sparta behaves and customize your preferences.",
      route: (chain) => `/${chain}/settings`,
      selectors: [".settings-icon-link", ".settings-panel", "#settings-form"],
    },
    {
      title: "Discover Page",
      text: "This is the Discover page, where you can explore Sparta AI Picks, trending tokens, and upcoming launches.",
      route: (chain) => `/${chain}/discover`,
      selectors: [
        "#discover-ai-picks-feed",
        ".board",
        '[data-mobile-row-panel="ai-picks"]',
      ],
    },
    {
      title: "Trade Terminal",
      text: "This is the Trading Terminal. Opening a chart from the main page or search results will take you here for live trading of that token.",
      route: (chain) =>
        window.SpartaRoutes?.getPageHref?.("trade", chain) ||
        (chain === "sol"
          ? "/sol/So11111111111111111111111111111111111111112"
          : "/bsc/0xb2acf3ae051c7f0b0b8de90cbb4ed99312574444"),
      selectors: [".token-terminal-panel", ".token-detail-panel"],
      disableAutoScroll: true,
    },
    {
      title: "Copy Trade",
      text: "Copy Trade allows you to track selected wallets and automatically mirror their trading activity from this page.",
      route: (chain) => `/${chain}/copytrade`,
      selectors: [".copytrade-panel", "#copytrade-list"],
    },
    {
      title: "AI Trading",
      text: "Enable the Sparta AI Agent here. Once turned on, it automatically executes trades according to your chosen presets. It will buy every new token that appears in the Sparta AI Picks section.",
      route: (chain) => `/${chain}/ai-trading`,
      selectors: ["#ai-trading-controls", ".settings-panel"],
    },
    {
      title: "KeyWord Trading",
      text: "Use KeyWord Trading to configure automatic buys based on token names or symbols that match your chosen keywords.",
      route: (chain) => `/${chain}/keyword`,
      selectors: ["#keyword-enabled", ".keyword-panel", "#keyword-slots"],
    },
    {
      title: "Bridge",
      text: "Use Bridge to move native BNB and SOL between chains using the integrated Bungee flow.",
      route: (chain) => `/${chain}/bridge`,
      selectors: ["#bridge-open", "#bridge-form", ".settings-panel"],
    },
    {
      title: "Profile Toggle • Stats",
      text: "Click Profile -> Stats to access your personal performance dashboard.",
      route: (chain) => `/${chain}/ai-trading`,
      selectors: [
        "#profile-summary",
        '#profile-dropdown [data-profile-action="open-stats"]',
        ".wallet-menu",
      ],
      prepare: () => {
        const menu = document.querySelector(".wallet-menu");
        if (menu instanceof HTMLDetailsElement) {
          menu.open = true;
        }
      },
    },
    {
      title: "Stats Page",
      text: "The Stats section provides a complete overview of your trading performance and key metrics in one dashboard.",
      route: (chain) => `/${chain}/stats`,
      selectors: [
        "#stats-chain-grid",
        "#stats-summary-grid",
        ".referral-layout",
      ],
    },
    {
      title: "Transfer Page",
      text: "Use Transfer to easily move native funds or tokens between wallets.",
      route: (chain) => (chain === "sol" ? "/sol/transfer" : "/transfer"),
      selectors: ["#transfer-form", ".settings-panel"],
    },
    {
      title: "Referral Page",
      text: "The Referral section gives you access to your invite dashboard, referral link, and commission overview.",
      route: () => "/referral",
      selectors: [
        "#referral-summary-grid",
        "#referral-chain-grid",
        ".referral-layout",
      ],
    },
    {
      title: "Login / Profile",
      text: "Use this toggle to log in and quickly connect, create or import a new account.",
      route: () => "/referral",
      selectors: ["#profile-summary", ".wallet-menu"],
    },
    {
      title: "Wallet Access",
      text: "Here you can create or import a Sparta Wallet, or connect an existing wallet using MetaMask or Phantom.",
      route: () => "/referral",
      selectors: [
        "#wallet-login-modal:not([hidden]) .wallet-login-modal-card",
        "#wallet-login-modal .wallet-login-modal-card",
        "#wallet-login-modal",
        "#profile-summary",
      ],
      prepare: ({ stepIndex }) => {
        const walletMenu = document.querySelector(".wallet-menu");
        if (walletMenu instanceof HTMLDetailsElement) {
          walletMenu.open = true;
        }

        const openLoginModal = () => {
          const loginButton = document.querySelector(
            '#profile-dropdown [data-profile-action="login"]'
          );
          if (!(loginButton instanceof HTMLElement)) {
            return false;
          }

          loginButton.click();
          window.setTimeout(() => {
            const state = readState();
            if (
              state.inProgress &&
              !state.completed &&
              state.stepIndex === stepIndex
            ) {
              showStep(steps[stepIndex], stepIndex);
            }
          }, 80);
          return true;
        };

        if (openLoginModal()) {
          return;
        }

        window.setTimeout(openLoginModal, 80);
        window.setTimeout(openLoginModal, 220);
      },
    },
  ];

  function normalizePath(pathname) {
    const raw = String(pathname || "/");
    if (raw.length > 1) {
      return raw.replace(/\/+$/, "");
    }
    return raw;
  }

  function currentPath() {
    return normalizePath(window.location.pathname);
  }

  function detectChain(pathname) {
    const path = normalizePath(pathname);
    if (path === "/sol" || path.startsWith("/sol/")) {
      return "sol";
    }
    return "bsc";
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(TOUR_STATE_KEY);
      if (!raw) {
        return {
          completed: false,
          inProgress: false,
          stepIndex: 0,
          chain: null,
        };
      }
      const parsed = JSON.parse(raw);
      return {
        completed: Boolean(parsed.completed),
        inProgress: Boolean(parsed.inProgress),
        stepIndex: Number.isFinite(parsed.stepIndex)
          ? Math.max(0, parsed.stepIndex)
          : 0,
        chain: parsed.chain === "sol" ? "sol" : "bsc",
      };
    } catch (error) {
      return {
        completed: false,
        inProgress: false,
        stepIndex: 0,
        chain: null,
      };
    }
  }

  function writeState(nextState) {
    window.localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(nextState));
  }

  function getOrCreateRoot() {
    let root = document.getElementById("sparta-tour-root");
    if (root) {
      return root;
    }
    root = document.createElement("div");
    root.id = "sparta-tour-root";
    root.hidden = true;
    root.innerHTML = `
      <div class="sparta-tour-overlay" aria-hidden="true"></div>
      <section class="sparta-tour-popover" role="dialog" aria-modal="true" aria-live="polite">
        <p class="sparta-tour-kicker" id="sparta-tour-kicker">Sparta Tour</p>
        <h3 class="sparta-tour-title" id="sparta-tour-title"></h3>
        <p class="sparta-tour-copy" id="sparta-tour-copy"></p>
        <div class="sparta-tour-actions">
          <button type="button" class="sparta-tour-btn sparta-tour-btn-muted" id="sparta-tour-skip">Skip</button>
          <button type="button" class="sparta-tour-btn sparta-tour-btn-muted" id="sparta-tour-back">Back</button>
          <button type="button" class="sparta-tour-btn sparta-tour-btn-primary" id="sparta-tour-next">Next</button>
        </div>
      </section>
    `;
    document.body.appendChild(root);
    return root;
  }

  function getOrCreatePrompt() {
    let prompt = document.getElementById("sparta-tour-start");
    if (prompt) {
      return prompt;
    }
    prompt = document.createElement("div");
    prompt.id = "sparta-tour-start";
    prompt.hidden = true;
    prompt.innerHTML = `
      <div class="sparta-tour-overlay" aria-hidden="true"></div>
      <section class="sparta-tour-popover sparta-tour-start-popover" role="dialog" aria-modal="true">
        <p class="sparta-tour-kicker">Welcome to Sparta</p>
        <h3 class="sparta-tour-title">Start a quick tour?</h3>
        <p class="sparta-tour-copy">See the main pages and controls in under a minute.</p>
        <div class="sparta-tour-actions">
          <button type="button" class="sparta-tour-btn sparta-tour-btn-muted" id="sparta-tour-start-skip">Skip</button>
          <button type="button" class="sparta-tour-btn sparta-tour-btn-primary" id="sparta-tour-start-go">Start Tour</button>
        </div>
      </section>
    `;
    document.body.appendChild(prompt);
    return prompt;
  }

  function clearHighlight() {
    document.querySelectorAll(".sparta-tour-target").forEach((node) => {
      node.classList.remove("sparta-tour-target");
    });
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function ensureMobileRowTab(tabName) {
    if (!isMobileViewport()) {
      return;
    }

    const tab = document.querySelector(
      `[data-mobile-row-tab="${CSS.escape(String(tabName || ""))}"]`
    );
    if (!(tab instanceof HTMLElement)) {
      return;
    }
    const pressed = tab.getAttribute("aria-pressed");
    if (pressed === "true" || tab.classList.contains("is-active")) {
      return;
    }
    tab.click();
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const styles = window.getComputedStyle(node);
    if (styles.display === "none" || styles.visibility === "hidden") {
      return false;
    }
    return node.getClientRects().length > 0;
  }

  function findTarget(step) {
    if (typeof step.target === "function") {
      const customTarget = step.target();
      if (customTarget instanceof HTMLElement) {
        return customTarget;
      }
    }

    let fallback = null;
    for (const selector of step.selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      const visibleMatch = matches.find((node) => isVisible(node));
      if (visibleMatch) {
        return visibleMatch;
      }
      if (!fallback && matches[0]) {
        fallback = matches[0];
      }
    }
    return fallback;
  }

  function positionPopover(popover) {
    if (!(popover instanceof HTMLElement)) {
      return;
    }
    popover.style.top = "50%";
    popover.style.left = "50%";
    popover.style.transform = "translate(-50%, -50%)";
  }

  function hideStartPrompt() {
    const prompt = document.getElementById("sparta-tour-start");
    if (prompt) {
      prompt.hidden = true;
    }
  }

  function finishTour() {
    const state = readState();
    writeState({
      completed: true,
      inProgress: false,
      stepIndex: steps.length - 1,
      chain: state.chain || detectChain(currentPath()),
    });
    const root = document.getElementById("sparta-tour-root");
    if (root) {
      root.hidden = true;
    }
    hideStartPrompt();
    clearHighlight();
  }

  function skipTour() {
    finishTour();
  }

  function gotoNextStep() {
    const state = readState();
    const nextIndex = state.stepIndex + 1;
    if (nextIndex >= steps.length) {
      finishTour();
      return;
    }
    writeState({
      completed: false,
      inProgress: true,
      stepIndex: nextIndex,
      chain: state.chain || detectChain(currentPath()),
    });
    runTour();
  }

  function gotoPrevStep() {
    const state = readState();
    const prevIndex = Math.max(0, state.stepIndex - 1);
    writeState({
      completed: false,
      inProgress: true,
      stepIndex: prevIndex,
      chain: state.chain || detectChain(currentPath()),
    });
    runTour();
  }

  function bindTourControls(root) {
    const skipButton = root.querySelector("#sparta-tour-skip");
    const nextButton = root.querySelector("#sparta-tour-next");
    const backButton = root.querySelector("#sparta-tour-back");

    skipButton?.addEventListener("click", skipTour);
    nextButton?.addEventListener("click", gotoNextStep);
    backButton?.addEventListener("click", gotoPrevStep);

    window.addEventListener("resize", () => {
      const state = readState();
      if (!state.inProgress || state.completed) {
        return;
      }
      const popover = root.querySelector(".sparta-tour-popover");
      positionPopover(popover);
    });
  }

  function showStep(step, stepIndex) {
    const root = getOrCreateRoot();
    const popover = root.querySelector(".sparta-tour-popover");
    const kicker = root.querySelector("#sparta-tour-kicker");
    const title = root.querySelector("#sparta-tour-title");
    const copy = root.querySelector("#sparta-tour-copy");
    const nextButton = root.querySelector("#sparta-tour-next");
    const backButton = root.querySelector("#sparta-tour-back");

    clearHighlight();

    const target = findTarget(step);
    if (target instanceof HTMLElement) {
      target.classList.add("sparta-tour-target");
      if (!isMobileViewport() && !step.disableAutoScroll) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      }
    }

    kicker.textContent = `Sparta Tour • Step ${stepIndex + 1} of ${
      steps.length
    }`;
    title.textContent = step.title;
    copy.textContent = step.text;
    nextButton.textContent = stepIndex === steps.length - 1 ? "Finish" : "Next";
    backButton.hidden = stepIndex === 0;

    root.hidden = false;
    positionPopover(popover);
  }

  function runTour() {
    const state = readState();
    if (state.completed || !state.inProgress) {
      return;
    }

    const chain = state.chain || detectChain(currentPath());
    const stepIndex = Math.min(state.stepIndex, steps.length - 1);
    const step = steps[stepIndex];
    const expectedRoute = normalizePath(step.route(chain));

    if (currentPath() !== expectedRoute) {
      window.location.assign(expectedRoute);
      return;
    }

    if (typeof step.prepare === "function") {
      step.prepare({ chain, stepIndex });
    }

    showStep(step, stepIndex);
  }

  function showStartPrompt() {
    const prompt = getOrCreatePrompt();
    prompt.hidden = false;

    const startButton = prompt.querySelector("#sparta-tour-start-go");
    const skipButton = prompt.querySelector("#sparta-tour-start-skip");

    if (startButton && !startButton.dataset.bound) {
      startButton.dataset.bound = "true";
      startButton.addEventListener("click", () => {
        const chain = detectChain(currentPath());
        writeState({
          completed: false,
          inProgress: true,
          stepIndex: 0,
          chain,
        });
        prompt.hidden = true;
        runTour();
      });
    }

    if (skipButton && !skipButton.dataset.bound) {
      skipButton.dataset.bound = "true";
      skipButton.addEventListener("click", () => {
        skipTour();
      });
    }
  }

  function maybeStart() {
    const path = currentPath();
    const state = readState();
    const isStartPath = START_PATHS.has(path);

    const root = getOrCreateRoot();
    if (!root.dataset.bound) {
      bindTourControls(root);
      root.dataset.bound = "true";
    }

    if (state.inProgress && !state.completed) {
      runTour();
      return;
    }

    if (!state.completed && isStartPath) {
      showStartPrompt();
    }
  }

  window.SpartaTour = {
    start: function startTour() {
      const chain = detectChain(currentPath());
      writeState({
        completed: false,
        inProgress: true,
        stepIndex: 0,
        chain,
      });
      hideStartPrompt();
      runTour();
    },
    reset: function resetTour() {
      writeState({
        completed: false,
        inProgress: false,
        stepIndex: 0,
        chain: null,
      });
      const root = document.getElementById("sparta-tour-root");
      if (root) {
        root.hidden = true;
      }
      hideStartPrompt();
      clearHighlight();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeStart, { once: true });
  } else {
    maybeStart();
  }
})();
