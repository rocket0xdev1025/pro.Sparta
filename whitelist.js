(() => {
  const WALLET_SESSION_KEY = "spartaWalletSession";
  const WHITELIST_ACCESS_KEY = "spartaWhitelistAccess";
  const RETWEET_POST_URL =
    "https://x.com/Spartaeth_Bot/status/2069370918892388664";

  let overlay = null;
  let statusNode = null;
  let accessInput = null;
  let applyNameInput = null;
  let applyTelegramInput = null;
  let applyTwitterInput = null;
  let applyAddressInput = null;
  let applySubmitButton = null;
  let communityStepButtons = [];
  let lastCheckedAddress = "";
  let checkInFlight = null;
  const communitySteps = {
    retweet: false,
    twitter: false,
    telegram: false,
  };

  function readJsonStorage(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function shortAddress(address) {
    const value = String(address || "").trim();
    return value.length > 12
      ? `${value.slice(0, 6)}...${value.slice(-4)}`
      : value;
  }

  function normalizeGateAddress(address) {
    const value = String(address || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      return value.toLowerCase();
    }
    return value;
  }

  function setStatus(message, tone = "") {
    if (!statusNode) {
      return;
    }
    statusNode.textContent = message;
    statusNode.dataset.tone = tone;
  }

  function hasCompletedCommunitySteps() {
    return (
      communitySteps.retweet &&
      communitySteps.twitter &&
      communitySteps.telegram
    );
  }

  function updateCommunityStepsUi() {
    communityStepButtons.forEach((button) => {
      const step = button.dataset.step;
      const isDone = Boolean(step && communitySteps[step]);
      button.dataset.done = isDone ? "true" : "false";
      const badge = button.querySelector(".sparta-whitelist-step-badge");
      if (badge) {
        badge.textContent = isDone
          ? "Done"
          : `Step ${button.dataset.stepNumber || ""}`.trim();
      }
    });

    if (applySubmitButton) {
      applySubmitButton.disabled = false;
      applySubmitButton.setAttribute("aria-disabled", "false");
    }
  }

  function showOverlay() {
    if (overlay) {
      overlay.hidden = false;
    }
    document.body.classList.add("sparta-whitelist-locked");
  }

  function hideOverlay() {
    if (overlay) {
      overlay.hidden = true;
    }
    document.body.classList.remove("sparta-whitelist-locked");
  }

  function readWalletSession() {
    return readJsonStorage(WALLET_SESSION_KEY);
  }

  function writeWhitelistAccess(address) {
    const normalizedAddress = normalizeGateAddress(address);
    window.localStorage.setItem(
      WHITELIST_ACCESS_KEY,
      JSON.stringify({
        address: normalizedAddress,
        approvedAt: Date.now(),
      })
    );
  }

  function clearWhitelistAccess() {
    window.localStorage.removeItem(WHITELIST_ACCESS_KEY);
  }

  function readWhitelistAccess() {
    return readJsonStorage(WHITELIST_ACCESS_KEY);
  }

  async function checkWhitelist(address) {
    const normalizedAddress = normalizeGateAddress(address);
    if (!normalizedAddress) {
      return { approved: false, status: "missing_address" };
    }
    const response = await fetch(
      `/api/whitelist/check?address=${encodeURIComponent(normalizedAddress)}`,
      {
        cache: "no-store",
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        approved: false,
        status: payload.status || payload.error || `api_${response.status}`,
        address: normalizedAddress,
      };
    }
    return payload;
  }

  async function applyForWhitelist(name, address) {
    const telegramUsername = String(applyTelegramInput?.value || "").trim();
    const twitterHandle = String(applyTwitterInput?.value || "").trim();
    const response = await fetch("/api/whitelist/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        address,
        telegram_username: telegramUsername,
        twitter_handle: twitterHandle,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload.status || payload.error || `api_${response.status}`
      );
    }
    return payload;
  }

  async function unlockWithAddress(address, { fromWallet = false } = {}) {
    const normalizedAddress = normalizeGateAddress(address);
    if (!normalizedAddress) {
      showOverlay();
      setStatus("Enter your wallet address to check whitelist access.");
      return false;
    }

    if (checkInFlight && lastCheckedAddress === normalizedAddress) {
      return checkInFlight;
    }

    lastCheckedAddress = normalizedAddress;
    setStatus("Checking whitelist access...");
    checkInFlight = checkWhitelist(normalizedAddress)
      .then((payload) => {
        if (payload.approved) {
          writeWhitelistAccess(payload.address || normalizedAddress);
          hideOverlay();
          setStatus(
            `Access approved for ${shortAddress(
              payload.address || normalizedAddress
            )}.`,
            "success"
          );
          return true;
        }

        clearWhitelistAccess();
        showOverlay();
        if (fromWallet) {
          setStatus(
            `Wallet ${shortAddress(
              normalizedAddress
            )} is not whitelisted yet. Apply below.`,
            "warning"
          );
        } else if (payload.status === "invalid_address") {
          setStatus("Enter a valid EVM or Solana wallet address.", "warning");
        } else {
          setStatus(
            "This wallet is not whitelisted yet. Apply below.",
            "warning"
          );
        }
        return false;
      })
      .catch(() => {
        showOverlay();
        setStatus(
          "Whitelist check is temporarily unavailable. Try again in a moment.",
          "warning"
        );
        return false;
      })
      .finally(() => {
        checkInFlight = null;
      });

    return checkInFlight;
  }

  function buildOverlay() {
    if (overlay) {
      return;
    }

    const wrapper = document.createElement("section");
    wrapper.className = "sparta-whitelist-gate";
    wrapper.hidden = true;
    wrapper.setAttribute("aria-label", "Sparta whitelist access");
    wrapper.innerHTML = `
      <div class="sparta-whitelist-backdrop" aria-hidden="true"></div>
      <div class="sparta-whitelist-card" role="dialog" aria-modal="true" aria-labelledby="sparta-whitelist-title">
        <div class="sparta-whitelist-mark">
          <img src="/spartaicon.png" alt="" />
          <span>Private Beta</span>
        </div>
        <p class="sparta-whitelist-kicker">Sparta PRO Whitelist</p>
        <h2 id="sparta-whitelist-title">Enter The Arena</h2>
        <p class="sparta-whitelist-copy">
          Sparta is opening access wallet by wallet. Check your approved wallet or apply below to join the whitelist queue.
        </p>
        <form class="sparta-whitelist-form" id="sparta-whitelist-check-form">
          <label class="sparta-whitelist-field">
            <span>Wallet address</span>
            <input id="sparta-whitelist-address" name="address" autocomplete="off" spellcheck="false" placeholder="0x... or Solana address" />
          </label>
          <button class="sparta-whitelist-primary" type="submit">Check Access</button>
        </form>
        <div class="sparta-whitelist-divider">
          <span>Not on the list yet?</span>
        </div>
        <section class="sparta-whitelist-steps" aria-labelledby="sparta-whitelist-steps-title">
          <div class="sparta-whitelist-steps-head">
            <p class="sparta-whitelist-steps-kicker">Complete these first</p>
            <h3 id="sparta-whitelist-steps-title">Support Sparta before you apply</h3>
          </div>
          <div class="sparta-whitelist-step-grid">
            <a
              class="sparta-whitelist-step-card"
              data-step="retweet"
              data-step-number="1"
              href="${RETWEET_POST_URL}"
              target="_blank"
              rel="noreferrer"
            >
              <span class="sparta-whitelist-step-badge">Step 1</span>
              <span class="sparta-whitelist-step-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path fill="currentColor" d="M7 7h8.586l-2.293-2.293 1.414-1.414L19.414 8l-4.707 4.707-1.414-1.414L15.586 9H7c-1.103 0-2 .897-2 2v1H3v-1c0-2.206 1.794-4 4-4Zm10 10H8.414l2.293 2.293-1.414 1.414L4.586 16l4.707-4.707 1.414 1.414L8.414 15H17c1.103 0 2-.897 2-2v-1h2v1c0 2.206-1.794 4-4 4Z"/>
                </svg>
              </span>
              <span class="sparta-whitelist-step-copy">
                <strong>Retweet the Sparta post</strong>
                <span>Post link coming soon</span>
              </span>
            </a>
            <a
              class="sparta-whitelist-step-card"
              data-step="twitter"
              data-step-number="2"
              href="https://x.com/Spartaeth_Bot"
              target="_blank"
              rel="noreferrer"
            >
              <span class="sparta-whitelist-step-badge">Step 2</span>
              <span class="sparta-whitelist-step-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path fill="currentColor" d="M18.901 2H22l-6.768 7.736L23.193 22h-6.231l-4.88-7.405L5.602 22H2.5l7.239-8.277L.807 2h6.39l4.41 6.701L18.9 2Zm-1.09 18.09h1.717L6.275 3.81H4.434L17.81 20.09Z"/>
                </svg>
              </span>
              <span class="sparta-whitelist-step-copy">
                <strong>Follow Sparta on X</strong>
                <span>@Spartaeth_Bot</span>
              </span>
            </a>
            <a
              class="sparta-whitelist-step-card"
              data-step="telegram"
              data-step-number="3"
              href="https://t.me/Spartaeth_Bot_portal"
              target="_blank"
              rel="noreferrer"
            >
              <span class="sparta-whitelist-step-badge">Step 3</span>
              <span class="sparta-whitelist-step-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path fill="currentColor" d="M21.944 4.667c.32-.128.667.16.571.507l-3.178 15.114c-.08.38-.496.56-.827.357l-4.876-2.995-2.486 2.396a.49.49 0 0 1-.829-.29l-.398-4.55L18.3 7.64c.226-.205-.045-.55-.309-.39L7.62 13.71 3.14 12.305c-.406-.127-.43-.694-.038-.855L21.944 4.667Z"/>
                </svg>
              </span>
              <span class="sparta-whitelist-step-copy">
                <strong>Join the Sparta Telegram</strong>
                <span>t.me/Spartaeth_Bot_portal</span>
              </span>
            </a>
          </div>
        </section>
        <form class="sparta-whitelist-form sparta-whitelist-apply" id="sparta-whitelist-apply-form">
          <label class="sparta-whitelist-field">
            <span>Name</span>
            <input id="sparta-whitelist-name" name="name" autocomplete="name" maxlength="80" placeholder="Your name" />
          </label>
          <label class="sparta-whitelist-field">
            <span>Telegram username</span>
            <input id="sparta-whitelist-telegram" name="telegram_username" autocomplete="off" spellcheck="false" maxlength="64" placeholder="@yourtelegram" />
          </label>
          <label class="sparta-whitelist-field">
            <span>Twitter handle</span>
            <input id="sparta-whitelist-twitter" name="twitter_handle" autocomplete="off" spellcheck="false" maxlength="64" placeholder="@yourxhandle" />
          </label>
          <label class="sparta-whitelist-field">
            <span>Wallet address</span>
            <input id="sparta-whitelist-apply-address" name="address" autocomplete="off" spellcheck="false" placeholder="Wallet for whitelist review" />
          </label>
          <button class="sparta-whitelist-secondary" id="sparta-whitelist-apply-submit" type="submit">Apply For Whitelist</button>
        </form>
        <p class="sparta-whitelist-status" id="sparta-whitelist-status" role="status">Checking access...</p>
      </div>
    `;

    document.body.appendChild(wrapper);
    overlay = wrapper;
    statusNode = wrapper.querySelector("#sparta-whitelist-status");
    accessInput = wrapper.querySelector("#sparta-whitelist-address");
    applyNameInput = wrapper.querySelector("#sparta-whitelist-name");
    applyTelegramInput = wrapper.querySelector("#sparta-whitelist-telegram");
    applyTwitterInput = wrapper.querySelector("#sparta-whitelist-twitter");
    applyAddressInput = wrapper.querySelector(
      "#sparta-whitelist-apply-address"
    );
    applySubmitButton = wrapper.querySelector("#sparta-whitelist-apply-submit");
    communityStepButtons = Array.from(
      wrapper.querySelectorAll(".sparta-whitelist-step-card")
    );
    communityStepButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const step = button.dataset.step;
        if (
          step &&
          Object.prototype.hasOwnProperty.call(communitySteps, step)
        ) {
          communitySteps[step] = true;
          updateCommunityStepsUi();
          if (hasCompletedCommunitySteps()) {
            setStatus(
              "Community steps completed. You can apply for whitelist now."
            );
          }
        }
      });
    });
    updateCommunityStepsUi();

    wrapper
      .querySelector("#sparta-whitelist-check-form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        unlockWithAddress(accessInput?.value || "").catch(() => {});
      });

    wrapper
      .querySelector("#sparta-whitelist-apply-form")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!hasCompletedCommunitySteps()) {
          setStatus(
            "Follow Step 1, Step 2, and Step 3 above before applying for whitelist.",
            "warning"
          );
          return;
        }
        const name = String(applyNameInput?.value || "").trim();
        const telegramUsername = String(applyTelegramInput?.value || "").trim();
        const address = String(
          applyAddressInput?.value || accessInput?.value || ""
        ).trim();
        if (!name || !telegramUsername || !address) {
          setStatus(
            "Fill in your name, Telegram username, and wallet address to apply.",
            "warning"
          );
          return;
        }

        setStatus("Submitting whitelist application...");
        try {
          const payload = await applyForWhitelist(name, address);
          setStatus(
            `Application received for ${shortAddress(
              payload.application?.address || address
            )}. Access stays locked until approved.`,
            "success"
          );
        } catch (error) {
          if (error.message === "invalid_address") {
            setStatus("Enter a valid EVM or Solana wallet address.", "warning");
          } else if (error.message === "invalid_name") {
            setStatus("Enter a name with at least 2 characters.", "warning");
          } else if (error.message === "invalid_telegram_username") {
            setStatus("Enter a valid Telegram username.", "warning");
          } else if (error.message === "invalid_twitter_handle") {
            setStatus(
              "Enter a valid Twitter handle or leave it empty.",
              "warning"
            );
          } else {
            setStatus(
              "Could not submit the application. Try again shortly.",
              "warning"
            );
          }
        }
      });
  }

  async function refreshAccess() {
    buildOverlay();

    const session = readWalletSession();
    const storedAccess = readWhitelistAccess();
    if (storedAccess?.address) {
      const normalizedStoredAddress = normalizeGateAddress(
        storedAccess.address
      );
      if (accessInput) {
        accessInput.value = normalizedStoredAddress;
      }
      if (applyAddressInput) {
        applyAddressInput.value = normalizedStoredAddress;
      }
      await unlockWithAddress(normalizedStoredAddress);
      return;
    }

    if (session?.address) {
      const normalizedSessionAddress = normalizeGateAddress(session.address);
      if (accessInput) {
        accessInput.value = session.address;
      }
      if (applyAddressInput) {
        applyAddressInput.value = session.address;
      }
      showOverlay();
      await unlockWithAddress(normalizedSessionAddress, { fromWallet: true });
      return;
    }

    showOverlay();
    setStatus("Enter your wallet address to check whitelist access.");
  }

  window.SpartaWhitelist = {
    checkAddress: unlockWithAddress,
    handleWalletSession: (session) => {
      const storedAccess = readWhitelistAccess();
      if (storedAccess?.address) {
        refreshAccess().catch(() => {});
        return;
      }
      if (session?.address) {
        unlockWithAddress(normalizeGateAddress(session.address), {
          fromWallet: true,
        }).catch(() => {});
      } else {
        refreshAccess().catch(() => {});
      }
    },
  };

  window.addEventListener("sparta:wallet-session-changed", (event) => {
    window.SpartaWhitelist.handleWalletSession(event.detail?.session || null);
  });

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        refreshAccess().catch(() => {});
      },
      { once: true }
    );
  } else {
    refreshAccess().catch(() => {});
  }
})();
