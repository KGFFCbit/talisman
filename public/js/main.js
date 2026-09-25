// Days-since counter — epoch is the last gluttening (reset 2026-09-20), no server needed.
const GLUTTEN_EPOCH = new Date("2026-09-20T00:00:00");

function daysSince(date) {
  const ms = Date.now() - date.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function tickCounter(el) {
  const target = daysSince(GLUTTEN_EPOCH);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || target === 0) {
    el.textContent = target;
    return;
  }

  const duration = 1400;
  const start = performance.now();

  function frame(now) {
    const elapsed = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    el.textContent = Math.round(eased * target);
    if (elapsed < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

document.addEventListener("DOMContentLoaded", () => {
  const figure = document.querySelector("[data-counter]");
  if (figure) tickCounter(figure);

  // Close the mobile masthead menu when a link inside it is chosen.
  const menu = document.querySelector(".mast-menu");
  if (menu) {
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => { menu.open = false; });
    });
  }
});
