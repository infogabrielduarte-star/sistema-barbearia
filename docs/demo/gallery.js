// Fotos do espaço: carrossel no topo + ampliação ao clicar (topo e galeria "O espaço").
const PHOTOS = [
  { src: 'assets/fotos/salao-principal.jpg', alt: 'Salão da Barbearia Modelo com cadeiras, mesa de sinuca, troféus e geladeira', caption: 'O salão, com a sinuca para quem espera' },
  { src: 'assets/fotos/salao-cadeiras.jpg', alt: 'As três cadeiras da Barbearia Modelo, com capas personalizadas', caption: 'As cadeiras, com a capa da casa' },
  { src: 'assets/fotos/salao-detalhe.jpg', alt: 'Cadeiras de barbeiro com capas personalizadas da Barbearia Modelo', caption: 'Cadeiras com a marca da casa' }
];
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- Carrossel do topo ---------- */
const frame = $('[data-gallery-hero]');
let current = 0, timer = 0, paused = false;
const DELAY = 5000;
if (frame) {
  const slides = $$('.hero-slides img', frame);
  const bars = $$('.slide-bars button', frame);
  const show = i => {
    current = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('is-active', k === current));
    bars.forEach((b, k) => {
      b.setAttribute('aria-selected', String(k === current));
      b.classList.toggle('is-done', k < current);
      b.classList.remove('is-running'); void b.offsetWidth;   // reinicia a barra
      if (k === current && !reduce && !paused) b.classList.add('is-running');
    });
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (reduce || paused) return;
    timer = setTimeout(() => show(current + 1), DELAY);
  };
  const pause = on => {
    paused = on; frame.classList.toggle('is-paused', on);
    if (on) clearTimeout(timer); else show(current);
  };
  bars.forEach((b, k) => b.addEventListener('click', e => { e.stopPropagation(); show(k); }));
  frame.addEventListener('mouseenter', () => pause(true));
  frame.addEventListener('mouseleave', () => pause(false));
  document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(timer) : schedule());
  frame.addEventListener('click', e => { if (!e.target.closest('.slide-bars')) openLightbox(Number(slides[current].dataset.photo ?? current), slides[current]); });
  frame.style.cursor = 'zoom-in';
  show(0);
}

/* ---------- Galeria "O espaço" ---------- */
$$('figure[data-photo]').forEach(fig => {
  const open = () => openLightbox(Number(fig.dataset.photo), fig.querySelector('img'));
  fig.addEventListener('click', open);
  fig.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
});

/* ---------- Ampliação ---------- */
const lb = $('#lightbox');
const img = lb && $('.lb-img', lb);
let index = 0, zoomed = false, dragging = null;

// encaixa a foto no espaço disponível, ampliando se o arquivo for menor que a tela
function fit() {
  if (!img.naturalWidth) return;
  const stage = $('.lb-stage', lb), cs = getComputedStyle(stage);
  const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const r = img.naturalWidth / img.naturalHeight;
  const fw = Math.min(w, h * r);
  img.style.width = Math.round(fw) + 'px'; img.style.height = Math.round(fw / r) + 'px';
}
function render() {
  const p = PHOTOS[index];
  img.style.width = img.style.height = '';
  img.src = p.src; img.alt = p.alt;
  if (img.complete && img.naturalWidth) fit(); else img.addEventListener('load', fit, { once: true });
  $('.lb-caption', lb).textContent = p.caption;
  $('.lb-count', lb).textContent = `${index + 1} / ${PHOTOS.length}`;
  setZoom(false);
}
function setZoom(on, x = 50, y = 50) {
  zoomed = on;
  lb.classList.toggle('is-zoomed', on);
  img.style.transformOrigin = `${x}% ${y}%`;
}
function go(step) {
  index = (index + step + PHOTOS.length) % PHOTOS.length;
  img.classList.remove('is-in'); void img.offsetWidth;
  render(); img.classList.add('is-in');
}
function openLightbox(i, fromEl) {
  if (!lb) return;
  index = i; render();
  lb.showModal();
  $('.lb-stage', lb).focus({ preventScroll: true });
  document.documentElement.classList.add('lb-open');
  if (reduce || !fromEl) { img.classList.add('is-in'); return; }
  // ampliação a partir da foto clicada (FLIP)
  const from = fromEl.getBoundingClientRect();
  const go2 = () => {
    fit();
    const to = img.getBoundingClientRect();
    if (!to.width) { img.classList.add('is-in'); return; }
    const sx = from.width / to.width, sy = from.height / to.height;
    img.style.transition = 'none';
    img.style.transform = `translate(${from.left - to.left + (from.width - to.width) / 2}px, ${from.top - to.top + (from.height - to.height) / 2}px) scale(${Math.max(sx, sy)})`;
    img.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transition = ''; img.style.transform = ''; img.style.opacity = '';
      img.classList.add('is-in');
    }));
  };
  if (img.complete && img.naturalWidth) go2(); else img.addEventListener('load', go2, { once: true });
}
if (lb) {
  $('.lb-stage', lb).setAttribute('tabindex', '-1');
  addEventListener('resize', () => { if (lb.open) fit(); });
  const close = () => { lb.close(); };
  lb.addEventListener('close', () => { document.documentElement.classList.remove('lb-open'); img.classList.remove('is-in'); setZoom(false); });
  $('.lb-close', lb).addEventListener('click', close);
  $('.lb-prev', lb).addEventListener('click', () => go(-1));
  $('.lb-next', lb).addEventListener('click', () => go(1));
  lb.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
  // clicar fora da foto fecha
  lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('lb-stage')) close(); });

  // zoom: clique/toque na foto alterna 2x no ponto escolhido; mouse ou dedo movem a área ampliada
  const pct = e => {
    const r = img.getBoundingClientRect();
    return [Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100)), Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100))];
  };
  img.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; try { img.setPointerCapture(e.pointerId); } catch {} });
  img.addEventListener('pointermove', e => {
    if (zoomed && (e.pointerType === 'mouse' || dragging)) { const [x, y] = pct(e); img.style.transformOrigin = `${x}% ${y}%`; }
    if (dragging && Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) > 8) dragging.moved = true;
  });
  img.addEventListener('pointerup', e => {
    const d = dragging; dragging = null; if (!d) return;
    const dx = e.clientX - d.x;
    if (!zoomed && d.moved && Math.abs(dx) > 50) { go(dx < 0 ? 1 : -1); return; }   // arrastar troca de foto
    if (!d.moved) { const [x, y] = pct(e); setZoom(!zoomed, x, y); }
  });
  img.addEventListener('pointercancel', () => { dragging = null; });
}
