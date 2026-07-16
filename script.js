const menuToggleButton = document.getElementById("menu-toggle");
const primaryNav = document.getElementById("primary-nav");
const siteHeader = document.querySelector(".site-header");
const brandToggle = document.querySelector(".brand");
const workCards = document.querySelectorAll("#work .card");
const landingLogoShell = document.getElementById("landing-logo-shell");
const logoFloat = document.getElementById("logo-float");
const logoFloatImage = document.getElementById("logo-float-image");
const brandLogoTarget = document.getElementById("brand-logo-target");
const heroSection = document.querySelector(".hero");
const logoBootLine = document.getElementById("logo-bootline");
const revealElements = document.querySelectorAll(".reveal-on-scroll");
const projectMenus = document.querySelectorAll(".nav-projects");

let logoRenderComplete = false;
let logoRenderTimer = null;
let logoCursorTailTimer = null;
let logoBootTypeTimer = null;
let introAutoScrollTimer = null;
let introAutoScrollFrame = null;
let introAutoScrollDone = false;
let userInterruptedIntroAutoScroll = false;

const BOOT_LINE_TEXT = "> render_logo --mode=scanline";
const THEME_STORAGE_KEY = "portfolio-theme";
const LIGHT_THEME = "light";
const DARK_THEME = "dark";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, t) => start + (end - start) * t;

const cancelIntroAutoScroll = () => {
  userInterruptedIntroAutoScroll = true;
  if (introAutoScrollTimer) {
    window.clearTimeout(introAutoScrollTimer);
    introAutoScrollTimer = null;
  }
  if (introAutoScrollFrame) {
    window.cancelAnimationFrame(introAutoScrollFrame);
    introAutoScrollFrame = null;
  }
};

const animateIntroScrollTo = (targetY, durationMs = 1850) => {
  const startY = window.scrollY;
  const distance = targetY - startY;

  if (Math.abs(distance) < 2) {
    window.scrollTo(0, targetY);
    return;
  }

  const startTime = performance.now();
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

  const step = (timestamp) => {
    if (userInterruptedIntroAutoScroll) {
      introAutoScrollFrame = null;
      return;
    }

    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeInOutSine(progress);
    window.scrollTo(0, startY + distance * eased);

    if (progress < 1) {
      introAutoScrollFrame = window.requestAnimationFrame(step);
    } else {
      introAutoScrollFrame = null;
    }
  };

  introAutoScrollFrame = window.requestAnimationFrame(step);
};

const scheduleIntroAutoScroll = () => {
  if (
    introAutoScrollDone ||
    userInterruptedIntroAutoScroll ||
    !document.body.classList.contains("home-page") ||
    !heroSection
  ) {
    return;
  }

  introAutoScrollDone = true;
  introAutoScrollTimer = window.setTimeout(() => {
    if (userInterruptedIntroAutoScroll || window.scrollY > 6) {
      return;
    }

    const headerHeight = siteHeader ? siteHeader.offsetHeight : 0;
    const heroTop = window.scrollY + heroSection.getBoundingClientRect().top;
    const targetY = Math.max(0, heroTop - headerHeight - 10);
    animateIntroScrollTo(targetY);
  }, 320);
};

const applyTheme = (theme) => {
  const isDark = theme === DARK_THEME;
  document.body.classList.toggle("theme-dark", isDark);

  if (brandToggle) {
    brandToggle.setAttribute("aria-pressed", String(isDark));
    brandToggle.setAttribute("title", isDark ? "Toggle light mode" : "Toggle dark mode");
  }
};

const getStoredTheme = () => localStorage.getItem(THEME_STORAGE_KEY);

const toggleTheme = () => {
  const currentTheme = document.body.classList.contains("theme-dark")
    ? DARK_THEME
    : LIGHT_THEME;
  const nextTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
  applyTheme(nextTheme);
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
};

const getMorphProgress = () => {
  const maxScroll = Math.max(window.innerHeight * 0.65, 220);
  return clamp(window.scrollY / maxScroll, 0, 1);
};

const clearBootLine = () => {
  if (logoBootTypeTimer) {
    window.clearInterval(logoBootTypeTimer);
    logoBootTypeTimer = null;
  }

  if (logoBootLine) {
    logoBootLine.textContent = "";
  }
};

const startBootLineTyping = () => {
  if (!logoBootLine) {
    return;
  }

  clearBootLine();

  let index = 0;
  logoBootTypeTimer = window.setInterval(() => {
    index += 1;
    logoBootLine.textContent = BOOT_LINE_TEXT.slice(0, index);

    if (index >= BOOT_LINE_TEXT.length) {
      window.clearInterval(logoBootTypeTimer);
      logoBootTypeTimer = null;
    }
  }, 45);
};

const updateLogoPosition = () => {
  if (!landingLogoShell || !logoFloat || !brandLogoTarget) {
    return;
  }

  const startRect = landingLogoShell.getBoundingClientRect();
  const endRect = brandLogoTarget.getBoundingClientRect();
  const progress = getMorphProgress();

  logoFloat.style.top = `${lerp(startRect.top, endRect.top, progress)}px`;
  logoFloat.style.left = `${lerp(startRect.left, endRect.left, progress)}px`;
  logoFloat.style.width = `${lerp(startRect.width, endRect.width, progress)}px`;
  logoFloat.style.padding = `${lerp(10, 4, progress)}px`;
  document.body.classList.toggle("is-scrolled", progress > 0.02);
};

const finishLogoRender = ({ withTail = true, scheduleAutoScroll = true } = {}) => {
  if (logoRenderTimer) {
    window.clearInterval(logoRenderTimer);
    logoRenderTimer = null;
  }

  if (logoCursorTailTimer) {
    window.clearTimeout(logoCursorTailTimer);
    logoCursorTailTimer = null;
  }

  if (logoFloatImage) {
    logoFloatImage.style.setProperty("--logo-clip-bottom", "0%");
  }

  if (logoFloat) {
    logoFloat.style.setProperty("--cursor-y", "98%");
  }

  document.body.classList.remove("logo-render-active");
  document.body.classList.remove("logo-render-tail");
  clearBootLine();

  if (withTail) {
    document.body.classList.add("logo-render-tail");
    logoCursorTailTimer = window.setTimeout(() => {
      document.body.classList.remove("logo-render-tail");
    }, 1250);
  }

  document.body.classList.add("logo-render-complete");
  logoRenderComplete = true;

  if (scheduleAutoScroll) {
    scheduleIntroAutoScroll();
  }
};

const startLogoRender = () => {
  if (!logoFloatImage || logoRenderComplete) {
    logoRenderComplete = true;
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishLogoRender({ withTail: false });
    return;
  }

  let remainingPercent = 100;
  document.body.classList.add("logo-render-active");
  document.body.classList.remove("logo-render-tail");
  logoFloatImage.style.setProperty("--logo-clip-bottom", "100%");
  startBootLineTyping();
  if (logoFloat) {
    logoFloat.style.setProperty("--cursor-y", "1%");
  }

  logoRenderTimer = window.setInterval(() => {
    remainingPercent -= 0.8;

    if (remainingPercent <= 0) {
      finishLogoRender();
      return;
    }

    logoFloatImage.style.setProperty("--logo-clip-bottom", `${remainingPercent}%`);
    if (logoFloat) {
      const cursorY = Math.min(Math.max(100 - remainingPercent, 1), 98);
      logoFloat.style.setProperty("--cursor-y", `${cursorY}%`);
    }
  }, 35);
};

const updateScrollState = () => {
  updateLogoPosition();
  const isScrolled = getMorphProgress() > 0.02;

  if (isScrolled && !logoRenderComplete) {
    finishLogoRender({ withTail: false, scheduleAutoScroll: false });
  }
};

if (menuToggleButton && primaryNav) {
  const setMobileNavState = (isOpen) => {
    primaryNav.classList.toggle("open", isOpen);
    menuToggleButton.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("nav-open", isOpen);
  };

  menuToggleButton.addEventListener("click", () => {
    const isOpen = !primaryNav.classList.contains("open");
    setMobileNavState(isOpen);
  });

  primaryNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      setMobileNavState(false);
      projectMenus.forEach((menu) => {
        menu.open = false;
      });
    });
  });
}

projectMenus.forEach((menu) => {
  const summary = menu.querySelector("summary");
  if (!summary) {
    return;
  }

  summary.addEventListener("click", () => {
    projectMenus.forEach((other) => {
      if (other !== menu) {
        other.open = false;
      }
    });
  });
});

document.addEventListener("click", (event) => {
  projectMenus.forEach((menu) => {
    if (!menu.contains(event.target)) {
      menu.open = false;
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  projectMenus.forEach((menu) => {
    menu.open = false;
  });
});

if (logoFloat) {
  logoFloat.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  });
}

if (document.body.classList.contains("home-page")) {
  const cancelKeys = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

  window.addEventListener("wheel", cancelIntroAutoScroll, { passive: true });
  window.addEventListener("touchstart", cancelIntroAutoScroll, { passive: true });
  window.addEventListener("pointerdown", cancelIntroAutoScroll, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (cancelKeys.has(event.key)) {
      cancelIntroAutoScroll();
    }
  });
}

const storedTheme = getStoredTheme();
if (storedTheme === DARK_THEME) {
  applyTheme(DARK_THEME);
} else {
  applyTheme(LIGHT_THEME);
}

if (brandToggle) {
  brandToggle.addEventListener("click", (event) => {
    event.preventDefault();
    toggleTheme();
  });

  brandToggle.addEventListener("keydown", (event) => {
    if (event.key === " ") {
      event.preventDefault();
      toggleTheme();
    }
  });
}

workCards.forEach((card) => {
  const label = card.querySelector(".card-label");
  const link = card.querySelector("h3 a");
  if (!label || !link || label.textContent.trim().toLowerCase() !== "essay") {
    return;
  }

  card.classList.add("card-clickable");
  card.setAttribute("role", "link");
  card.tabIndex = 0;

  card.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      return;
    }
    window.location.href = link.href;
  });

  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    window.location.href = link.href;
  });
});

document.body.classList.add("logo-ready");

window.addEventListener("scroll", updateScrollState, { passive: true });
window.addEventListener("resize", updateScrollState);

updateScrollState();

if (window.scrollY <= 6) {
  startLogoRender();
} else {
  finishLogoRender({ withTail: false, scheduleAutoScroll: false });
}

if (document.body.classList.contains("essay-page")) {
  revealElements.forEach((element) => {
    element.classList.add("is-revealed");
  });
} else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealElements.forEach((element) => {
    element.classList.add("is-revealed");
  });
} else if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-revealed", entry.isIntersecting);
      });
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  revealElements.forEach((element) => {
    revealObserver.observe(element);
  });
} else {
  revealElements.forEach((element) => {
    element.classList.add("is-revealed");
  });
}
