// Identidade imersiva global: luz que segue o mouse, paralaxe leve em destaques, inclinação de cartões,
// revelação ao rolar e transição entre abas/telas. Tudo desligado em movimento reduzido; no toque, só a revelação.
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* luz global + variáveis de paralaxe (-1..1) */
if (fine && !reduce) {
  const cur = { x: innerWidth / 2, y: innerHeight * .3 }, tgt = { ...cur };
  let raf = 0;
  const tick = () => {
    cur.x += (tgt.x - cur.x) * .12; cur.y += (tgt.y - cur.y) * .12;
    root.style.setProperty('--mx', cur.x.toFixed(1) + 'px'); root.style.setProperty('--my', cur.y.toFixed(1) + 'px');
    root.style.setProperty('--gx', (cur.x / innerWidth * 2 - 1).toFixed(3)); root.style.setProperty('--gy', (cur.y / innerHeight * 2 - 1).toFixed(3));
    raf = Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) > .5 ? requestAnimationFrame(tick) : 0;
  };
  addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; tgt.x = e.clientX; tgt.y = e.clientY; if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
}

/* elementos: paralaxe (destaques), inclinação (cartões) e revelação (blocos do site) */
const DEPTH = [['#website .section-heading h2', 8], ['.dash-heading h1', 5], ['.staff-welcome h1', 5], ['.planner-top h2', 4], ['#website .last-call h2', 6], ['.login-card', 4]];
const TILT = '#website .service, .team-grid article, .location-address, .location-social, .stat-card, .performance-card, .access-card, .shortcut, .priority-tile';
const REVEAL = '#website .service-grid, #website .price-list, #website .team-grid, #website .space-grid, #website .location-grid, #website .last-call, #website .review-invite';
const seen = new WeakSet();
let io = null;
if (!reduce && 'IntersectionObserver' in window) io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('im-in'); io.unobserve(e.target); } }), { threshold: .08, rootMargin: '0px 0px -6% 0px' });

function tilt(el) {
  el.classList.add('im-tilt');
  el.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', ((x - .5) * 7).toFixed(2) + 'deg'); el.style.setProperty('--rx', ((.5 - y) * 6).toFixed(2) + 'deg');
    el.style.setProperty('--sx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--sy', (y * 100).toFixed(1) + '%');
  });
  el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); el.style.removeProperty('--sx'); el.style.removeProperty('--sy'); });
}
function scan(scope = document) {
  if (fine && !reduce) {
    for (const [sel, d] of DEPTH) scope.querySelectorAll(sel).forEach(el => { if (!seen.has(el)) { seen.add(el); el.classList.add('im-depth'); el.style.setProperty('--depth', d); } });
    scope.querySelectorAll(TILT).forEach(el => { if (!seen.has(el)) { seen.add(el); tilt(el); } });
  }
  if (io) scope.querySelectorAll(REVEAL).forEach(el => { if (!seen.has(el)) { seen.add(el); el.classList.add('im-reveal'); io.observe(el); } });
}
scan();
// painéis são redesenhados pelo app: aplica nos novos elementos
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n.parentElement || n); })
  .observe(document.body, { childList: true, subtree: true });

/* transição suave ao trocar de aba no painel do dono e na área do barbeiro */
if (!reduce) document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab],[data-staff-tab],[data-goto],[data-stock-view]'); if (!tab) return;
  const body = document.querySelector(tab.closest('#staff-area') ? '#staff-body' : '#dash-body'); if (!body) return;
  body.classList.remove('im-swap'); void body.offsetWidth; body.classList.add('im-swap');
  clearTimeout(body._imT); body._imT = setTimeout(() => body.classList.remove('im-swap'), 700);
}, true);
