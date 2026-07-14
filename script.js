const menuToggleButton = document.getElementById("menu-toggle");
const primaryNav = document.getElementById("primary-nav");
const landingLogoShell = document.getElementById("landing-logo-shell");
const logoFloat = document.getElementById("logo-float");
const logoFloatImage = document.getElementById("logo-float-image");
const brandLogoTarget = document.getElementById("brand-logo-target");
const revealElements = document.querySelectorAll(".reveal-on-scroll");

let logoRenderComplete = false;
let logoRenderTimer = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, t) => start + (end - start) * t;

const getMorphProgress = () => {
  const maxScroll = Math.max(window.innerHeight * 0.65, 220);
  return clamp(window.scrollY / maxScroll, 0, 1);
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

const finishLogoRender = () => {
  if (logoRenderTimer) {
    window.clearInterval(logoRenderTimer);
    logoRenderTimer = null;
  }

  if (logoFloatImage) {
    logoFloatImage.style.setProperty("--logo-clip", "0%");
  }

  document.body.classList.remove("logo-render-active");
  document.body.classList.add("logo-render-complete");
  logoRenderComplete = true;
};

const startLogoRender = () => {
  if (!logoFloatImage || logoRenderComplete) {
    logoRenderComplete = true;
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishLogoRender();
    return;
  }

  let remainingPercent = 100;
  document.body.classList.add("logo-render-active");
  logoFloatImage.style.setProperty("--logo-clip", "100%");

  logoRenderTimer = window.setInterval(() => {
    remainingPercent -= 2;

    if (remainingPercent <= 0) {
      finishLogoRender();
      return;
    }

    logoFloatImage.style.setProperty("--logo-clip", `${remainingPercent}%`);
  }, 26);
};

const updateScrollState = () => {
  updateLogoPosition();
  const isScrolled = getMorphProgress() > 0.02;

  if (isScrolled && !logoRenderComplete) {
    finishLogoRender();
  }
};

if (menuToggleButton && primaryNav) {
  menuToggleButton.addEventListener("click", () => {
    const isOpen = primaryNav.classList.toggle("open");
    menuToggleButton.setAttribute("aria-expanded", String(isOpen));
  });

  primaryNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      primaryNav.classList.remove("open");
      menuToggleButton.setAttribute("aria-expanded", "false");
    });
  });
}

if (logoFloat) {
  logoFloat.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  });
}

document.body.classList.add("logo-ready");

window.addEventListener("scroll", updateScrollState, { passive: true });
window.addEventListener("resize", updateScrollState);

updateScrollState();

if (window.scrollY <= 6) {
  startLogoRender();
} else {
  finishLogoRender();
}

if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealElements.forEach((element) => {
    element.classList.add("is-revealed");
  });
} else if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
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
