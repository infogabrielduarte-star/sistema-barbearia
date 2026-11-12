// Primeira seção do site (hero) — ilustrações em SVG (metal envelhecido, couro, relevo) e movimento discreto.
// Tudo aqui é decorativo (aria-hidden); textos, links e botões continuam em HTML real.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

/* ---------- Definições compartilhadas: gradientes e filtros ---------- */
const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <linearGradient spreadMethod="reflect" id="hg-gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ebdcae"/><stop offset=".16" stop-color="#c3a671"/><stop offset=".42" stop-color="#8b7146"/>
    <stop offset=".58" stop-color="#5d4a2b"/><stop offset=".8" stop-color="#a48a59"/><stop offset="1" stop-color="#d3bd8a"/>
  </linearGradient>
  <linearGradient spreadMethod="reflect" id="hg-gold-d" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#dcc795"/><stop offset=".35" stop-color="#977c4c"/><stop offset=".7" stop-color="#55422a"/><stop offset="1" stop-color="#2a1f10"/>
  </linearGradient>
  <linearGradient spreadMethod="reflect" id="hg-gold-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3a2c16"/><stop offset=".18" stop-color="#8e7447"/><stop offset=".34" stop-color="#e8d7a8"/>
    <stop offset=".5" stop-color="#a68b5a"/><stop offset=".78" stop-color="#574325"/><stop offset="1" stop-color="#271d0e"/>
  </linearGradient>
  <linearGradient spreadMethod="reflect" id="hg-chrome-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3b3e43"/><stop offset=".2" stop-color="#a9afb6"/><stop offset=".33" stop-color="#f4f6f7"/>
    <stop offset=".48" stop-color="#7d838a"/><stop offset=".7" stop-color="#2c2f33"/><stop offset=".88" stop-color="#8f959c"/><stop offset="1" stop-color="#43474c"/>
  </linearGradient>
  <linearGradient spreadMethod="reflect" id="hg-chrome-v" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f5f7f8"/><stop offset=".35" stop-color="#9aa0a7"/><stop offset=".6" stop-color="#3a3d42"/><stop offset="1" stop-color="#b8bdc3"/>
  </linearGradient>
  <radialGradient id="hg-ball" cx=".35" cy=".3" r=".75">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".25" stop-color="#c9ced3"/><stop offset=".6" stop-color="#4a4e54"/><stop offset="1" stop-color="#16181b"/>
  </radialGradient>
  <linearGradient id="hg-shade-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset=".22" stop-color="#000" stop-opacity=".08"/>
    <stop offset=".32" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".72" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity=".72"/>
  </linearGradient>
  <linearGradient spreadMethod="reflect" id="hg-leather-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#1f120a"/><stop offset=".22" stop-color="#5b3720"/><stop offset=".36" stop-color="#9a6238"/>
    <stop offset=".52" stop-color="#6a4025"/><stop offset=".8" stop-color="#341f11"/><stop offset="1" stop-color="#170d06"/>
  </linearGradient>
  <linearGradient id="hg-bristle" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1f1a16"/><stop offset=".3" stop-color="#4a433c"/><stop offset=".6" stop-color="#8a8378"/><stop offset=".85" stop-color="#c9c2b6"/><stop offset="1" stop-color="#e9e4da"/>
  </linearGradient>
  <linearGradient id="hg-redleather" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7a2518"/><stop offset=".5" stop-color="#4c140c"/><stop offset="1" stop-color="#260805"/>
  </linearGradient>
  <radialGradient id="hg-field" cx=".45" cy=".35" r=".8">
    <stop offset="0" stop-color="#8a6448"/><stop offset=".55" stop-color="#5c3f2a"/><stop offset="1" stop-color="#2c1b10"/>
  </radialGradient>
  <pattern id="hp-knurl" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <path d="M0 0H5M0 0V5" stroke="#2a1d0b" stroke-width="1.3" opacity=".55"/>
  </pattern>
  <!-- relevo metálico: luz especular sobre a forma -->
  <filter id="hf-bevel" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="b"/>
    <feSpecularLighting in="b" surfaceScale="3.2" specularConstant=".85" specularExponent="22" lighting-color="#fff1d0" result="s">
      <feDistantLight azimuth="225" elevation="42"/>
    </feSpecularLighting>
    <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
    <feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".75" k4="0"/>
  </filter>
  <filter id="hf-bevel-soft" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b"/>
    <feSpecularLighting in="b" surfaceScale="4" specularConstant=".6" specularExponent="16" lighting-color="#ffe9bd" result="s">
      <feDistantLight azimuth="225" elevation="48"/>
    </feSpecularLighting>
    <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
    <feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".55" k4="0"/>
  </filter>
  <!-- couro: granulado com luz -->
  <filter id="hf-leather" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" seed="7" result="n"/>
    <feDiffuseLighting in="n" surfaceScale="1.6" diffuseConstant="1.05" lighting-color="#ffffff" result="l">
      <feDistantLight azimuth="225" elevation="55"/>
    </feDiffuseLighting>
    <feComposite in="l" in2="SourceAlpha" operator="in" result="l2"/>
    <feBlend in="SourceGraphic" in2="l2" mode="multiply"/>
  </filter>
  <filter id="hf-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="1.4 .06" numOctaves="2" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .35 0" result="a"/>
    <feComposite in="a" in2="SourceAlpha" operator="in" result="a2"/>
    <feBlend in="SourceGraphic" in2="a2" mode="multiply"/>
  </filter>
</defs></svg>`;

/* ---------- Ornamentos (arabescos) ---------- */
// meia-voluta; espelhada para formar o arabesco simétrico
const scrollHalf = `
  <path d="M0 0 C-8 -9 -22 -10 -30 -3 C-38 4 -33 15 -24 13 C-17 11 -19 3 -25 5"/>
  <path d="M0 6 C-14 10 -34 14 -52 6 C-62 1 -62 -10 -53 -11 C-46 -12 -45 -4 -50 -2"/>
  <path d="M-30 -3 C-34 -12 -46 -16 -56 -12"/>
  <path d="M0 -4 C-3 -12 -1 -18 4 -22"/>`;
const arabesque = (x, y, s = 1, flip = false) => `
  <g transform="translate(${x} ${y}) scale(${s} ${flip ? -s : s})" fill="none" stroke="url(#hg-gold-d)" stroke-width="2.4" stroke-linecap="round">
    ${scrollHalf}<g transform="scale(-1 1)">${scrollHalf}</g>
    <path d="M0 -6 C3 -1 3 5 0 9 C-3 5 -3 -1 0 -6Z" fill="url(#hg-gold)" stroke-width="1"/>
  </g>`;

/* ---------- Brasão (escudo) ---------- */
const SHIELD = 'M20 44 C62 36 104 26 135 14 C166 26 208 36 250 44 C253 50 252 58 249 64 L249 204 C249 262 211 302 135 342 C59 302 21 262 21 204 L21 64 C18 58 17 50 20 44Z';
const inset = (k, dy = 0) => `translate(${135 * (1 - k)} ${(180 + dy) * (1 - k)}) scale(${k})`;
function crestSVG() {
  return `<svg viewBox="-14 0 298 362" xmlns="http://www.w3.org/2000/svg">
  <!-- couro vermelho atrás, com costura -->
  <g transform="translate(-9 6) ${inset(1.03)}">
    <path d="${SHIELD}" fill="url(#hg-redleather)" filter="url(#hf-leather)"/>
    <path d="${SHIELD}" transform="${inset(.965)}" fill="none" stroke="#c39a57" stroke-width="1.3" stroke-dasharray="4 3" opacity=".7"/>
  </g>
  <!-- espessura do metal -->
  <path d="${SHIELD}" transform="translate(5 7)" fill="#2a1c0a"/>
  <path d="${SHIELD}" transform="translate(2.5 3.5)" fill="#5a3f17"/>
  <!-- aro externo -->
  <path d="${SHIELD}" fill="url(#hg-gold)" filter="url(#hf-bevel)"/>
  <path d="${SHIELD}" transform="${inset(.94)}" fill="#24170b"/>
  <path d="${SHIELD}" transform="${inset(.925)}" fill="url(#hg-gold-d)" filter="url(#hf-bevel-soft)"/>
  <!-- campo de couro -->
  <path d="${SHIELD}" transform="${inset(.88)}" fill="url(#hg-field)" filter="url(#hf-leather)"/>
  <path d="${SHIELD}" transform="${inset(.83)}" fill="none" stroke="#c9a362" stroke-width="1.1" opacity=".55"/>
  <!-- arabescos -->
  <g filter="url(#hf-bevel-soft)">${arabesque(135, 74, 1)}${arabesque(135, 288, .82, true)}</g>
  <!-- rebites -->
  ${[[38, 58], [232, 58], [40, 210], [230, 210]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2" fill="url(#hg-ball)"/><circle cx="${x}" cy="${y}" r="4.2" fill="url(#hg-gold)" opacity=".75"/>`).join('')}
  <!-- monograma em relevo -->
  <g font-family="'DM Sans',Arial,sans-serif" font-weight="700" font-size="142" letter-spacing="-8" text-anchor="middle">
    ${[6, 5, 4, 3, 2, 1].map(i => `<text x="${135 + i * .9}" y="${214 + i * 1.3}" fill="${i > 3 ? '#140d05' : '#3d2a10'}">BM</text>`).join('')}
    <text x="135" y="214" fill="url(#hg-gold)" filter="url(#hf-bevel)">BM</text>
    <text x="135" y="214" fill="none" stroke="#fff3cf" stroke-opacity=".28" stroke-width=".8">BM</text>
  </g>
  <!-- faixa BARBEARIA MODELO -->
  <path d="M36 230 Q135 246 234 230 L238 260 Q135 278 32 260Z" fill="#1c1209" transform="translate(2 4)"/>
  <path d="M36 230 Q135 246 234 230 L238 260 Q135 278 32 260Z" fill="url(#hg-gold)" filter="url(#hf-bevel-soft)"/>
  <path d="M42 235 Q135 251 228 235 M38 255 Q135 272 232 255" fill="none" stroke="#5a3f17" stroke-width=".9" opacity=".8"/>
  <path id="hband" d="M40 251 Q135 266 230 251" fill="none"/>
  <text font-family="'Barlow Condensed','Arial Narrow',sans-serif" font-weight="700" font-size="17" letter-spacing=".8" fill="#2b1c0a">
    <textPath href="#hband" startOffset="50%" text-anchor="middle">BARBEARIA MODELO</textPath>
  </text>
</svg>`;
}

/* ---------- Poste de barbeiro ---------- */
function poleSVG(id) {
  const bands = [];
  const colors = ['#b3141c', '#ece8e1', '#1d3f9e', '#ece8e1'];
  for (let i = -10; i < 22; i++) {
    const y = i * 11;
    bands.push(`<polygon points="8,${y + 14} 52,${y - 12} 52,${y - 1} 8,${y + 25}" fill="${colors[((i % 4) + 4) % 4]}"/>`);
  }
  return `<svg viewBox="0 0 60 250" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="pc-${id}"><rect x="10" y="50" width="40" height="150" rx="2"/></clipPath></defs>
  <path d="M8 36 C8 14 18 3 30 3 C42 3 52 14 52 36Z" fill="url(#hg-ball)"/><path d="M14 30 C15 18 21 9 28 7" stroke="#fff" stroke-opacity=".6" stroke-width="2" fill="none"/>
  <rect x="5" y="34" width="50" height="12" rx="3" fill="url(#hg-chrome-h)"/>
  <rect x="7" y="45" width="46" height="5" fill="url(#hg-chrome-h)" opacity=".9"/>
  <g clip-path="url(#pc-${id})">
    <rect x="10" y="50" width="40" height="150" fill="#ece8e1"/>${bands.join('')}
    <rect x="10" y="50" width="40" height="150" fill="url(#hg-shade-h)"/>
    <rect x="17" y="50" width="3" height="150" fill="#fff" opacity=".35"/>
  </g>
  <rect x="9.5" y="50" width="41" height="150" fill="none" stroke="#000" stroke-opacity=".35"/>
  <rect x="7" y="200" width="46" height="5" fill="url(#hg-chrome-h)"/>
  <rect x="5" y="204" width="50" height="13" rx="3" fill="url(#hg-chrome-h)"/>
  <path d="M14 217 L46 217 L40 232 L20 232Z" fill="url(#hg-chrome-h)"/>
  <circle cx="30" cy="238" r="8" fill="url(#hg-ball)"/>
</svg>`;
}

/* ---------- Aparelho de barbear (cabeça cromada, cabo de latão recartilhado) ---------- */
function razorSVG() {
  return `<svg viewBox="-22 0 134 310" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(45 0) scale(1.55 1.25) translate(-45 0)">
  <path d="M6 14 Q45 2 84 14 L84 30 Q45 22 6 30Z" fill="url(#hg-chrome-v)"/>
  <path d="M6 14 Q45 2 84 14" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>
  <rect x="4" y="29" width="82" height="5" rx="1" fill="#d9dde1"/>
  <path d="M8 34 H82 L80 44 H10Z" fill="url(#hg-chrome-h)"/>
  ${Array.from({ length: 18 }, (_, i) => `<rect x="${11 + i * 3.9}" y="36" width="1.6" height="8" fill="#1d1f22" opacity=".35"/>`).join('')}
  </g>
  <path d="M34 54 H56 L50 78 H40Z" fill="url(#hg-gold-h)"/>
  <rect x="31" y="76" width="28" height="9" rx="2" fill="url(#hg-gold-h)"/>
  <rect x="32" y="84" width="26" height="182" rx="5" fill="url(#hg-gold-h)"/>
  <rect x="32" y="92" width="26" height="166" fill="url(#hp-knurl)"/>
  <rect x="32" y="84" width="26" height="182" rx="5" fill="url(#hg-shade-h)" opacity=".55"/>
  <rect x="30" y="264" width="30" height="8" rx="2" fill="url(#hg-gold-h)"/>
  <path d="M32 272 H58 L56 296 Q45 302 34 296Z" fill="url(#hg-gold-h)"/>
</svg>`;
}

/* ---------- Pente ---------- */
function combSVG(dark = false) {
  const teeth = [];
  let x = 18;
  while (x < 282) {
    const coarse = x < 140, w = coarse ? 3.4 : 2.1, gap = coarse ? 2.7 : 1.7, len = coarse ? 46 : 41;
    teeth.push(`<rect x="${x.toFixed(1)}" y="19" width="${w}" height="${len}" rx="${w / 2}" fill="url(#hg-gold)"/>`);
    x += w + gap;
  }
  return `<svg viewBox="0 0 300 70" xmlns="http://www.w3.org/2000/svg">
  <g ${dark ? 'opacity=".92"' : ''}>
    <g filter="url(#hf-grain)">${teeth.join('')}</g>
    <path d="M6 10 Q6 2 14 2 H290 Q297 2 297 10 V22 H6Z" fill="url(#hg-gold)" filter="url(#hf-bevel-soft)"/>
    <path d="M6 10 Q6 2 14 2 H290 Q297 2 297 10 V66 Q297 69 293 69 H289 V22 H17 V66 Q17 69 13 69 H9 Q6 69 6 66Z" fill="url(#hg-gold)" opacity=".001"/>
    <rect x="6" y="18" width="11" height="50" rx="3" fill="url(#hg-gold-h)"/>
    <rect x="286" y="18" width="11" height="44" rx="3" fill="url(#hg-gold-h)"/>
    <path d="M14 6 H290" stroke="#fff4d2" stroke-opacity=".55" stroke-width="1.2"/>
    <path d="M10 21.5 H294" stroke="#2f2009" stroke-opacity=".6" stroke-width="1.2"/>
  </g>
</svg>`;
}

/* ---------- Pincel de barba ---------- */
function brushSVG() {
  // fios: pseudo-aleatório determinístico
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const strands = [];
  for (let i = 0; i < 70; i++) {
    const x0 = 34 + rnd() * 52, a = (x0 - 60) / 26, x1 = 60 + a * 58 + (rnd() - .5) * 16, y1 = 276 + rnd() * 26 - Math.abs(a) * 24;
    const light = rnd() > .45;
    strands.push(`<path d="M${x0.toFixed(1)} 196 Q${(x0 + (x1 - x0) * .4).toFixed(1)} ${(230 + rnd() * 10).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${light ? '#f4efe6' : '#2d2722'}" stroke-opacity="${light ? .32 : .4}" stroke-width="${(.7 + rnd() * .9).toFixed(2)}" fill="none"/>`);
  }
  return `<svg viewBox="0 0 120 310" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="60" cy="47" rx="31" ry="8" fill="#2a1d0b"/>
  <rect x="29" y="18" width="62" height="29" fill="url(#hg-gold-h)"/>
  <ellipse cx="60" cy="18" rx="31" ry="9" fill="url(#hg-gold)" filter="url(#hf-bevel-soft)"/>
  <ellipse cx="60" cy="18" rx="25" ry="6" fill="none" stroke="#fff1c8" stroke-opacity=".35"/>
  <path d="M34 47 H86 C84 75 80 95 82 110 C84 128 86 140 87 152 H33 C34 140 36 128 38 110 C40 95 36 75 34 47Z" fill="url(#hg-leather-h)" filter="url(#hf-leather)"/>
  <path d="M40 52 C42 80 44 100 42 148 M80 52 C78 80 76 100 78 148" stroke="#d9b98b" stroke-width="1.1" stroke-dasharray="3.5 3" fill="none" opacity=".75"/>
  <rect x="28" y="150" width="64" height="9" rx="2" fill="url(#hg-gold-h)"/>
  <path d="M30 158 H90 L88 194 H32Z" fill="url(#hg-gold-h)"/>
  <path d="M30 170 H90 M31 182 H89" stroke="#2b1e0b" stroke-opacity=".5"/>
  <path d="M32 192 C4 214 -6 252 8 282 C30 312 90 312 112 282 C126 252 116 214 88 192Z" fill="url(#hg-bristle)"/>
  <g stroke-linecap="round">${strands.join('')}</g>
  <path d="M8 282 C30 312 90 312 112 282" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2"/>
</svg>`;
}

/* ---------- Setas curvas ao redor do brasão ---------- */
function arrowsSVG() {
  const C = [287, 298], R = 205, pt = a => [C[0] + R * Math.cos(a * Math.PI / 180), C[1] + R * Math.sin(a * Math.PI / 180)];
  const arc = (a0, a1) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 ${a1 > a0 ? 1 : 0} ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const head = (a, dir) => { // ponta tangente ao arco
    const [x, y] = pt(a), t = (a + 90 * dir) * Math.PI / 180, n = a * Math.PI / 180, L = 13, W = 6;
    const bx = x - Math.cos(t) * L, by = y - Math.sin(t) * L;
    return `M${(bx + Math.cos(n) * W).toFixed(1)} ${(by + Math.sin(n) * W).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${(bx - Math.cos(n) * W).toFixed(1)} ${(by - Math.sin(n) * W).toFixed(1)}`;
  };
  return `<svg viewBox="0 0 560 610" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="${C[0]}" cy="${C[1]}" r="${R}" stroke="#c9a365" stroke-opacity=".1" stroke-width="1.5"/>
  <g stroke="url(#hg-gold-d)" stroke-width="2.6" opacity=".85">
    <path d="${arc(-122, -52)}"/><path d="${head(-52, 1)}"/>
    <path d="${arc(58, 112)}"/><path d="${head(112, 1)}"/>
  </g>
</svg>`;
}

/* ---------- Cantoneiras da moldura ---------- */
const cornerSVG = `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="url(#hg-gold-d)" stroke-linecap="round">
  <path d="M4 56 V12 Q4 4 12 4 H56" stroke-width="2"/>
  <path d="M10 46 C10 26 18 14 30 12 C40 10 46 16 42 22 C38 28 30 24 33 19" stroke-width="2.2"/>
  <path d="M12 34 C16 30 22 30 24 34 C26 38 21 41 18 38" stroke-width="1.8"/>
  <path d="M30 12 C36 6 46 6 50 10" stroke-width="1.6"/>
  <circle cx="11" cy="11" r="2.6" fill="url(#hg-gold)" stroke="none"/>
</svg>`;

const ICONS = {
  pin: `<svg viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 29 12 29S22.5 19 22.5 11.3C22.5 5.5 18 1 12 1Z" fill="url(#hg-gold)"/><circle cx="12" cy="11.2" r="4" fill="#1a130b"/></svg>`,
  clock: `<svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="15" r="14" fill="url(#hg-gold)"/><path d="M15 7.5V15.5L20.5 19" stroke="#1a130b" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`
};

/* ---------- Montagem ---------- */
const hero = document.querySelector('.h2a');
if (hero) {
  document.body.insertAdjacentHTML('afterbegin', DEFS);
  const put = (sel, html) => hero.querySelectorAll(sel).forEach(el => { el.innerHTML = html; });
  put('[data-art="crest"] .h2a-float', crestSVG());
  hero.querySelectorAll('[data-art="pole"] .h2a-float').forEach((el, i) => { el.innerHTML = poleSVG(i); });
  put('[data-art="razor"] .h2a-float', razorSVG());
  put('[data-art="comb"] .h2a-float', combSVG());
  put('[data-art="brush"] .h2a-float', brushSVG());
  put('[data-art="arrows"]', arrowsSVG());
  put('.h2a-corner', cornerSVG);
  hero.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
  requestAnimationFrame(() => hero.classList.add('is-ready'));

  /* paralaxe discreta conforme o cursor (só mouse; nada em movimento reduzido) */
  if (!reduce && finePointer) {
    // as variáveis valem para o cabeçalho e a seção inteira (rotação da cena, sombras e reflexos)
    const scope = hero.closest('#website') || document.documentElement;
    const cur = { x: 0, y: 0 }, tgt = { x: 0, y: 0 };
    // reflexos que correm pelo metal das ferramentas: desloca os gradientes de ouro/cromo conforme a luz
    const grads = [['hg-gold', 0, 1], ['hg-gold-d', 1, 1], ['hg-gold-h', 1, 0], ['hg-chrome-h', 1, 0], ['hg-chrome-v', 0, 1], ['hg-leather-h', 1, 0]]
      .map(([id, gx, gy]) => [document.getElementById(id), gx, gy]).filter(g => g[0]);
    let raf = 0;
    const tick = () => {
      cur.x += (tgt.x - cur.x) * .08; cur.y += (tgt.y - cur.y) * .08;
      scope.style.setProperty('--px', cur.x.toFixed(4)); scope.style.setProperty('--py', cur.y.toFixed(4));
      for (const [g, gx, gy] of grads) g.setAttribute('gradientTransform', `translate(${(gx * -cur.x * .14).toFixed(4)} ${(gy * -cur.y * .12).toFixed(4)})`);
      raf = Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) > .0005 ? requestAnimationFrame(tick) : 0;
    };
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const r = hero.getBoundingClientRect();
      if (r.bottom < 0) return;
      tgt.x = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1));
      tgt.y = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1));
      if (!raf) raf = requestAnimationFrame(tick);
    });

    /* moldura: inclinação sutil ao passar o mouse */
    const photo = hero.querySelector('.h2a-photo');
    photo?.addEventListener('pointermove', e => {
      const r = photo.getBoundingClientRect();
      photo.style.setProperty('--tx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
      photo.style.setProperty('--ty', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
    });
    photo?.addEventListener('pointerleave', () => { photo.style.setProperty('--tx', 0); photo.style.setProperty('--ty', 0); });
  }
}
