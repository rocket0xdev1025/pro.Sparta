(function () {
  "use strict";

  var STORAGE_KEY = "sparta:language";
  var DEFAULT_LANGUAGE = "en";
  var SUPPORTED_LANGUAGES = ["en", "zh-CN", "nl-NL"];
  var LANGUAGE_OPTIONS = [
    { code: "en", flag: "🇬🇧", labelKey: "language.english", shortLabel: "EN" },
    { code: "nl-NL", flag: "🇳🇱", labelKey: "language.dutch", shortLabel: "NL" },
    {
      code: "zh-CN",
      flag: "🇨🇳",
      labelKey: "language.simplifiedChinese",
      shortLabel: "ZH",
    },
  ];
  var dictionaries = {};
  var currentLanguage = DEFAULT_LANGUAGE;
  var readyPromise = null;

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function getPathValue(object, path) {
    if (!object || !path) return undefined;

    return path.split(".").reduce(function (value, part) {
      if (value && hasOwn(value, part)) return value[part];
      return undefined;
    }, object);
  }

  function interpolate(template, values) {
    if (typeof template !== "string" || !values) return template;

    return template.replace(/\{(\w+)\}/g, function (match, key) {
      return hasOwn(values, key) ? String(values[key]) : match;
    });
  }

  function normalizeLanguage(language) {
    if (!language) return DEFAULT_LANGUAGE;
    if (SUPPORTED_LANGUAGES.indexOf(language) !== -1) return language;

    var lowerLanguage = String(language).toLowerCase();
    if (
      lowerLanguage === "zh" ||
      lowerLanguage === "zh-cn" ||
      lowerLanguage.indexOf("zh-hans") === 0
    ) {
      return "zh-CN";
    }
    if (
      lowerLanguage === "nl" ||
      lowerLanguage === "nl-nl" ||
      lowerLanguage.indexOf("nl-") === 0
    ) {
      return "nl-NL";
    }
    if (lowerLanguage === "en" || lowerLanguage.indexOf("en-") === 0) {
      return "en";
    }

    return DEFAULT_LANGUAGE;
  }

  function getSavedLanguage() {
    try {
      return normalizeLanguage(
        window.localStorage.getItem(STORAGE_KEY) || navigator.language
      );
    } catch (error) {
      return DEFAULT_LANGUAGE;
    }
  }

  function saveLanguage(language) {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (error) {
      // localStorage can be unavailable in private browsing or embedded contexts.
    }
  }

  function loadDictionary(language) {
    var normalizedLanguage = normalizeLanguage(language);

    if (dictionaries[normalizedLanguage]) {
      return Promise.resolve(dictionaries[normalizedLanguage]);
    }

    return fetch("/locales/" + normalizedLanguage + ".json", {
      cache: "default",
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Unable to load locale: " + normalizedLanguage);
        }
        return response.json();
      })
      .then(function (dictionary) {
        dictionaries[normalizedLanguage] = dictionary || {};
        return dictionaries[normalizedLanguage];
      });
  }

  function translate(key, values) {
    var activeDictionary = dictionaries[currentLanguage] || {};
    var fallbackDictionary = dictionaries[DEFAULT_LANGUAGE] || {};
    var translatedValue = getPathValue(activeDictionary, key);

    if (translatedValue === undefined && currentLanguage !== DEFAULT_LANGUAGE) {
      translatedValue = getPathValue(fallbackDictionary, key);
    }

    if (translatedValue === undefined) {
      return key;
    }

    return interpolate(translatedValue, values);
  }

  function setText(element, value) {
    if (value === undefined || value === null) return;
    element.textContent = value;
  }

  function setAttribute(element, attributeName, value) {
    if (value === undefined || value === null) return;
    element.setAttribute(attributeName, value);
  }

  function getLanguageOption(language) {
    var normalizedLanguage = normalizeLanguage(language);
    for (var index = 0; index < LANGUAGE_OPTIONS.length; index += 1) {
      if (LANGUAGE_OPTIONS[index].code === normalizedLanguage) {
        return LANGUAGE_OPTIONS[index];
      }
    }
    return LANGUAGE_OPTIONS[0];
  }

  function createLanguageOption(option) {
    var button = document.createElement("button");
    var flag = document.createElement("span");
    var label = document.createElement("span");

    button.className = "sparta-language-option";
    button.type = "button";
    button.setAttribute("data-sparta-language-option", option.code);

    flag.className = "sparta-language-flag";
    flag.setAttribute("aria-hidden", "true");
    flag.textContent = option.flag;

    label.className = "sparta-language-option-label";
    label.setAttribute("data-sparta-language-option-label", option.code);

    button.appendChild(flag);
    button.appendChild(label);
    button.addEventListener("click", function () {
      var menu = button.closest(".sparta-language-menu");
      setLanguage(option.code).then(function () {
        if (menu) menu.removeAttribute("open");
      });
    });

    return button;
  }

  function createLanguageSelector() {
    var menu = document.createElement("details");
    var summary = document.createElement("summary");
    var flag = document.createElement("span");
    var shortLabel = document.createElement("span");
    var dropdown = document.createElement("div");

    menu.className = "sparta-language-menu";
    menu.setAttribute("data-sparta-language-menu", "true");

    summary.className = "sparta-language-summary";
    summary.setAttribute("aria-label", "Language");

    flag.className = "sparta-language-current-flag";
    flag.setAttribute("aria-hidden", "true");

    shortLabel.className = "sparta-language-current-code";
    shortLabel.setAttribute("aria-hidden", "true");

    dropdown.className = "sparta-language-dropdown";
    dropdown.setAttribute("role", "menu");

    LANGUAGE_OPTIONS.forEach(function (option) {
      dropdown.appendChild(createLanguageOption(option));
    });

    summary.appendChild(flag);
    summary.appendChild(shortLabel);
    menu.appendChild(summary);
    menu.appendChild(dropdown);

    return menu;
  }

  function injectLanguageSelectors() {
    Array.prototype.forEach.call(
      document.querySelectorAll(".hero-utility"),
      function (utility) {
        if (utility.querySelector("[data-sparta-language-menu]")) return;

        var selector = createLanguageSelector();
        var alertMenu = utility.querySelector(".alert-menu");
        var settingsLink = utility.querySelector(".settings-icon-link");
        var insertionTarget =
          alertMenu || settingsLink || utility.firstElementChild;

        if (insertionTarget) {
          utility.insertBefore(selector, insertionTarget);
        } else {
          utility.appendChild(selector);
        }
      }
    );
  }

  function updateLanguageSelectors() {
    var activeOption = getLanguageOption(currentLanguage);

    Array.prototype.forEach.call(
      document.querySelectorAll(".sparta-language-menu"),
      function (menu) {
        var summary = menu.querySelector(".sparta-language-summary");
        var currentFlag = menu.querySelector(".sparta-language-current-flag");
        var currentCode = menu.querySelector(".sparta-language-current-code");

        if (summary) {
          summary.setAttribute(
            "aria-label",
            translate("language.selectorLabel")
          );
          summary.setAttribute("title", translate("language.selectorLabel"));
        }
        if (currentFlag) currentFlag.textContent = activeOption.flag;
        if (currentCode) currentCode.textContent = activeOption.shortLabel;

        Array.prototype.forEach.call(
          menu.querySelectorAll(".sparta-language-option"),
          function (button) {
            var optionCode = button.getAttribute("data-sparta-language-option");
            var option = getLanguageOption(optionCode);
            var label = button.querySelector(
              "[data-sparta-language-option-label]"
            );
            var isActive = option.code === currentLanguage;

            button.setAttribute("aria-pressed", isActive ? "true" : "false");
            button.classList.toggle("is-active", isActive);
            if (label) label.textContent = translate(option.labelKey);
          }
        );
      }
    );
  }

  function applyTranslations(root) {
    var scope = root || document;

    injectLanguageSelectors();

    Array.prototype.forEach.call(
      scope.querySelectorAll("[data-i18n]"),
      function (element) {
        setText(element, translate(element.getAttribute("data-i18n")));
      }
    );

    Array.prototype.forEach.call(
      scope.querySelectorAll("[data-i18n-placeholder]"),
      function (element) {
        setAttribute(
          element,
          "placeholder",
          translate(element.getAttribute("data-i18n-placeholder"))
        );
      }
    );

    Array.prototype.forEach.call(
      scope.querySelectorAll("[data-i18n-title]"),
      function (element) {
        setAttribute(
          element,
          "title",
          translate(element.getAttribute("data-i18n-title"))
        );
      }
    );

    Array.prototype.forEach.call(
      scope.querySelectorAll("[data-i18n-aria-label]"),
      function (element) {
        setAttribute(
          element,
          "aria-label",
          translate(element.getAttribute("data-i18n-aria-label"))
        );
      }
    );

    Array.prototype.forEach.call(
      scope.querySelectorAll("[data-i18n-value]"),
      function (element) {
        setAttribute(
          element,
          "value",
          translate(element.getAttribute("data-i18n-value"))
        );
      }
    );

    document.documentElement.setAttribute("lang", currentLanguage);
    updateLanguageSelectors();
    document.dispatchEvent(
      new CustomEvent("sparta:i18n-applied", {
        detail: { language: currentLanguage },
      })
    );
  }

  function setLanguage(language, options) {
    var normalizedLanguage = normalizeLanguage(language);
    var shouldPersist = !options || options.persist !== false;

    return Promise.all([
      loadDictionary(DEFAULT_LANGUAGE),
      loadDictionary(normalizedLanguage),
    ])
      .then(function () {
        currentLanguage = normalizedLanguage;
        if (shouldPersist) saveLanguage(normalizedLanguage);
        applyTranslations(document);

        document.dispatchEvent(
          new CustomEvent("sparta:i18n-change", {
            detail: { language: currentLanguage },
          })
        );

        return currentLanguage;
      })
      .catch(function (error) {
        if (normalizedLanguage === DEFAULT_LANGUAGE) {
          throw error;
        }
        return setLanguage(DEFAULT_LANGUAGE, { persist: false });
      });
  }

  function init() {
    if (readyPromise) return readyPromise;

    readyPromise = setLanguage(getSavedLanguage(), { persist: false }).then(
      function () {
        document.dispatchEvent(
          new CustomEvent("sparta:i18n-ready", {
            detail: { language: currentLanguage },
          })
        );
        return currentLanguage;
      }
    );

    return readyPromise;
  }

  window.SpartaI18n = {
    apply: applyTranslations,
    init: init,
    languages: SUPPORTED_LANGUAGES.slice(),
    getLanguage: function () {
      return currentLanguage;
    },
    setLanguage: setLanguage,
    t: translate,
  };

  window.t = translate;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
