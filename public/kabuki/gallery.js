(() => {
  const links = Array.from(document.querySelectorAll('a[data-lightbox]'));
  const dlg = document.getElementById('lightbox');
  if (!dlg || typeof dlg.showModal !== 'function' || !links.length) return;
  const img = dlg.querySelector('img');
  const cap = dlg.querySelector('figcaption');
  let i = 0;
  const show = (n) => {
    i = (n + links.length) % links.length;
    const a = links[i];
    img.src = a.href;
    img.alt = a.dataset.alt || '';
    cap.textContent = a.dataset.caption || '';
  };
  links.forEach((a, n) => a.addEventListener('click', (e) => {
    e.preventDefault();
    show(n);
    dlg.showModal();
  }));
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-prev]').addEventListener('click', () => show(i - 1));
  dlg.querySelector('[data-next]').addEventListener('click', () => show(i + 1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.addEventListener('keydown', (e) => {
    if (!dlg.open) return;
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  });
})();
