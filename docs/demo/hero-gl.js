// Cena 3D da primeira seção — WebGL2 puro (sem bibliotecas; o ambiente do projeto não tem acesso à rede para trazer Three.js).
// 1) Fundo vivo: penumbra com textura, luz que segue o mouse, luzes desfocadas em camadas de profundidade, poeira no ar
//    e a foto real do salão como névoa ao fundo (paralaxe).
// 2) Brasão físico: escudo de bronze + couro + medalhão com a logo oficial, iluminado em tempo real; o salão se reflete no metal.
// Sem WebGL2 (ou com falha), as camadas estáticas em SVG/imagem continuam valendo. Movimento reduzido: um quadro fixo.

const hero = document.querySelector('.h2a');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mouse = { x: 0, y: 0, tx: 0, ty: 0, last: -1e9 };

/* ---------- utilidades ---------- */
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); }
};
const M = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  persp(f, a, n, fa) { const t = 1 / Math.tan(f / 2), o = new Float32Array(16); o[0] = t / a; o[5] = t; o[10] = (fa + n) / (n - fa); o[11] = -1; o[14] = 2 * fa * n / (n - fa); return o; },
  look(e, c, u) { const z = V.norm(V.sub(e, c)), x = V.norm(V.cross(u, z)), y = V.cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, e), -V.dot(y, e), -V.dot(z, e), 1]); },
  trans(x, y, z) { const o = M.ident(); o[12] = x; o[13] = y; o[14] = z; return o; },
  rx(a) { const o = M.ident(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
  ry(a) { const o = M.ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
  rz(a) { const o = M.ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; }
};
function context(canvas, alpha) {
  const gl = canvas.getContext('webgl2', { alpha, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  return gl || null;
}
function program(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  ['aPos', 'aNor', 'aUv'].forEach((n, i) => gl.bindAttribLocation(p, i, n));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const cache = {}; p.u = n => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n)));
  return p;
}
function texture(gl, img, mip) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

const NOISE = `
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+7.1; a*=.5; } return s; }`;

/* ============================================================
   1) Fundo vivo
   ============================================================ */
const BG_VS = `#version 300 es
in vec3 aPos; void main(){ gl_Position=vec4(aPos.xy,0.,1.); }`;
const BG_FS = `#version 300 es
precision highp float; out vec4 o;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform sampler2D uPhoto; uniform float uPhotoAsp; uniform float uHasPhoto;
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes, p=(gl_FragCoord.xy-.5*uRes)/uRes.y; float t=uTime;
  vec3 c=mix(vec3(.016,.018,.022),vec3(.038,.045,.05),uv.y);
  // a barbearia real, desfocada ao fundo, com paralaxe lenta
  if(uHasPhoto>.5){
    float asp=uRes.x/uRes.y; vec2 s=asp>uPhotoAsp?vec2(1.,uPhotoAsp/asp):vec2(asp/uPhotoAsp,1.);
    vec2 q=(uv-.5)*s*.86+.5+vec2(-uMouse.x*.018,uMouse.y*.012)+vec2(sin(t*.05),cos(t*.043))*.008;
    vec3 ph=textureLod(uPhoto,q,4.6).rgb; ph=mix(vec3(dot(ph,vec3(.3,.59,.11))),ph,.5);
    c+=ph*.36;
  }
  // luz avermelhada à esquerda (respira devagar) e tom frio à direita
  c+=vec3(.44,.075,.045)*smoothstep(.78,0.,length((uv-vec2(.02,.52))*vec2(1.,1.25)))*(.88+.12*sin(t*.35));
  c+=vec3(.02,.085,.095)*smoothstep(.8,0.,length((uv-vec2(.93,.6))*vec2(1.,1.1)));
  // luz principal da cena: acompanha o cursor
  vec2 L=vec2(.52+uMouse.x*.22,.56-uMouse.y*.18);
  float pool=smoothstep(.62,0.,length((uv-L)*vec2(uRes.x/uRes.y,1.)*.75));
  c+=vec3(.6,.42,.2)*.13*pool;
  // feixe de luz suave vindo do alto
  float beam=exp(-pow((p.x-(uMouse.x*.25)-(.5-uv.y)*.28)*2.6,2.))*smoothstep(-.1,.9,uv.y);
  c+=vec3(.5,.38,.22)*.035*beam*(.8+.2*fbm(vec2(p.x*3.,uv.y*2.-t*.05)));
  // luzes desfocadas em três profundidades (paralaxe diferente em cada uma)
  for(int k=0;k<3;k++){
    float z=1.+float(k);
    vec2 q=p*(2.6+z*1.5)+vec2(uMouse.x*.12*z,-uMouse.y*.08*z)+vec2(t*.006*z,t*.012*z);
    vec2 id=floor(q),f=fract(q)-.5; float h=hash(id+z*13.1);
    if(h>.74){
      vec2 of=(vec2(hash(id+3.1),hash(id+7.7))-.5)*.55; float r=.07+.13*hash(id+1.3), d=length(f-of);
      float b=smoothstep(r,r*.5,d)*.75+smoothstep(r,r*.92,d)*smoothstep(r*.72,r,d)*.55;
      float tw=.55+.45*sin(t*(.25+h*.4)+h*30.);
      c+=mix(vec3(1.,.62,.3),vec3(.9,.25,.18),step(.93,h))*b*.055*tw/(z*.7)*smoothstep(.05,.45,uv.y);
    }
  }
  // poeira no ar, visível só onde há luz
  vec2 dq=p*30.+vec2(t*.18,t*.32+sin(t*.2)*2.); vec2 di=floor(dq),df=fract(dq)-.5; float dh=hash(di);
  if(dh>.975){ float sp=smoothstep(.09,.0,length(df-(vec2(hash(di+2.),hash(di+5.))-.5)*.6)); c+=vec3(1.,.86,.62)*sp*(.25+.75*pool)*(.5+.5*sin(t*2.+dh*50.))*.5; }
  // textura sutil (reboco/couro) e vinheta
  c*=.86+.26*fbm(p*7.+vec2(0.,t*.01));
  c*=mix(.32,1.,smoothstep(1.2,.28,length((uv-.5)*vec2(1.25,1.))));
  c=mix(c,vec3(.043,.047,.055),smoothstep(.13,0.,uv.y));
  c+=(hash(gl_FragCoord.xy+fract(t)*100.)-.5)*.014;
  o=vec4(c,1.);
}`;

async function startBackground(state) {
  const bg = hero.querySelector('.h2a-bg'); if (!bg) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'h2a-gl-bg';
  const gl = context(canvas, false); if (!gl) return null;
  let prog; try { prog = program(gl, BG_VS, BG_FS); } catch (e) { console.warn('hero-gl fundo:', e.message); return null; }
  bg.prepend(canvas);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const photo = await loadImg(bg.querySelector('img')?.src || 'assets/fotos/salao-principal.jpg');
  const tex = photo ? texture(gl, photo, true) : null;
  const scale = matchMedia('(max-width: 899px)').matches ? .5 : .62;
  const size = () => { const r = bg.getBoundingClientRect(); canvas.width = Math.max(2, Math.round(r.width * scale)); canvas.height = Math.max(2, Math.round(r.height * scale)); };
  size(); addEventListener('resize', size);
  hero.classList.add('gl-bg');
  return t => {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(prog);
    gl.uniform2f(prog.u('uRes'), canvas.width, canvas.height); gl.uniform1f(prog.u('uTime'), t);
    gl.uniform2f(prog.u('uMouse'), state.x, state.y);
    gl.uniform1f(prog.u('uHasPhoto'), tex ? 1 : 0); if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u('uPhoto'), 0); gl.uniform1f(prog.u('uPhotoAsp'), photo.naturalWidth / photo.naturalHeight); }
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

/* ============================================================
   2) Brasão físico com a logo oficial
   ============================================================ */
const geo = () => ({ p: [], n: [], u: [], i: [] });
function append(g, h, m = M.ident()) {
  const base = g.p.length / 3;
  for (let k = 0; k < h.p.length; k += 3) {
    const [x, y, z] = [h.p[k], h.p[k + 1], h.p[k + 2]], [nx, ny, nz] = [h.n[k], h.n[k + 1], h.n[k + 2]];
    g.p.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    g.n.push(m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz);
  }
  g.u.push(...h.u); h.i.forEach(i => g.i.push(i + base)); return g;
}
function lathe(prof, seg = 96) { // perfil [raio, z] de baixo para cima → normais para fora
  const g = geo(), P = prof.length;
  for (let k = 0; k < P; k++) {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(P - 1, k + 1)]; let nr = b[1] - a[1], nz = -(b[0] - a[0]); const l = Math.hypot(nr, nz) || 1; nr /= l; nz /= l;
    for (let s = 0; s <= seg; s++) { const t = s / seg * Math.PI * 2, c = Math.cos(t), si = Math.sin(t); g.p.push(prof[k][0] * c, prof[k][0] * si, prof[k][1]); g.n.push(nr * c, nr * si, nz); g.u.push(s / seg, k / (P - 1)); }
  }
  for (let k = 0; k < P - 1; k++) for (let s = 0; s < seg; s++) { const a = k * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1; g.i.push(a, b, c, b, d, c); }
  return g;
}
function disc(r, seg = 96) {
  const g = geo(); g.p.push(0, 0, 0); g.n.push(0, 0, 1); g.u.push(.5, .5);
  for (let s = 0; s <= seg; s++) { const t = s / seg * Math.PI * 2, c = Math.cos(t), si = Math.sin(t); g.p.push(r * c, r * si, 0); g.n.push(0, 0, 1); g.u.push(.5 + c * .5, .5 + si * .5); }
  for (let s = 1; s <= seg; s++) g.i.push(0, s, s + 1); return g;
}
// polígono convexo extrudado com chanfro (frente estreita, laterais inclinadas)
function bevelExtrude(pts, depth, bevel) {
  const g = geo(), z = depth / 2, cx = 0, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const inner = pts.map(p => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] - dx / l * bevel, p[1] - dy / l * bevel]; });
  const cap = (ring, zz, nz) => { const base = g.p.length / 3; g.p.push(cx, cy, zz); g.n.push(0, 0, nz); g.u.push(cx, cy); ring.forEach(p => { g.p.push(p[0], p[1], zz); g.n.push(0, 0, nz); g.u.push(p[0], p[1]); }); for (let k = 1; k <= ring.length; k++) { const a = base + k, b = base + (k % ring.length) + 1; nz > 0 ? g.i.push(base, a, b) : g.i.push(base, b, a); } };
  cap(inner, z, 1); cap(pts, -z, -1);
  const side = (A, B, za, zb, tilt) => { for (let k = 0; k < A.length; k++) { const a = A[k], b = A[(k + 1) % A.length], c = B[(k + 1) % B.length], d = B[k]; const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; const n = V.norm([ey / l, -ex / l, tilt]); const base = g.p.length / 3; g.p.push(a[0], a[1], za, b[0], b[1], za, c[0], c[1], zb, d[0], d[1], zb); for (let q = 0; q < 4; q++) { g.n.push(...n); g.u.push(0, 0); } g.i.push(base, base + 2, base + 1, base, base + 3, base + 2); } };
  side(inner, pts, z, z - bevel, 1.1); // chanfro
  side(pts, pts, z - bevel, -z, 0);    // lateral
  return g;
}
const shieldPts = (k, n = 30) => {
  const side = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; side.push([.9 * k * Math.pow(Math.cos(a), 1.15), (-.12 - 1.08 * Math.pow(Math.sin(a), 1.05)) * k]); }
  const top = 1.02 * k, cr = .16 * k, ring = side.slice().reverse().slice(0, -1);
  for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; ring.push([.9 * k - cr + Math.cos(a) * cr, top - cr + Math.sin(a) * cr]); }
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 + i / 8 * Math.PI / 2; ring.push([-(.9 * k - cr) + Math.cos(a) * cr, top - cr + Math.sin(a) * cr]); }
  ring.push(...side.map(q => [-q[0], q[1]]).slice(0, -1)); return ring;
};

const OBJ_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aUv; uniform mat4 uModel, uVP; out vec3 vP, vN; out vec2 vUv;
void main(){ vec4 w=uModel*vec4(aPos,1.); vP=w.xyz; vN=mat3(uModel)*aNor; vUv=aUv; gl_Position=uVP*w; }`;
const OBJ_FS = `#version 300 es
precision highp float; in vec3 vP, vN; in vec2 vUv; out vec4 o;
uniform vec3 uBase, uEye, uL; uniform float uMetal, uRough, uTime; uniform int uMode;
uniform sampler2D uLogo, uRoom; uniform float uHasRoom;
${NOISE}
vec3 env(vec3 R){ // reflexo: o próprio salão (foto) + softboxes quentes
  vec2 q=vec2(atan(R.x,-R.z)/6.2832+.5, clamp(R.y*.45+.5,0.,1.));
  vec3 room=uHasRoom>.5?textureLod(uRoom,q,2.5).rgb*1.1:vec3(.08);
  vec3 c=room*.9+vec3(.02,.02,.025);
  c+=vec3(1.,.92,.8)*smoothstep(.82,.97,dot(R,normalize(uL+vec3(0.,.25,0.))))*2.2;
  c+=vec3(1.,.95,.88)*smoothstep(.5,.9,R.y)*.55;
  c+=vec3(.85,.16,.1)*smoothstep(.55,.95,dot(R,normalize(vec3(-1.,-.1,.2))))*.6;
  return c;
}
void main(){
  vec3 N=normalize(vN), V=normalize(uEye-vP), base=uBase; float metal=uMetal, rough=uRough;
  if(uMode==2){ // logo oficial em esmalte, com relevo pela luminância
    vec2 e=vec2(1./512.); float l0=dot(texture(uLogo,vUv+vec2(e.x,0)).rgb,vec3(.33)), l1=dot(texture(uLogo,vUv-vec2(e.x,0)).rgb,vec3(.33));
    float l2=dot(texture(uLogo,vUv+vec2(0,e.y)).rgb,vec3(.33)), l3=dot(texture(uLogo,vUv-vec2(0,e.y)).rgb,vec3(.33));
    N=normalize(N+vec3(l1-l0,l3-l2,0.)*1.1); base=texture(uLogo,vUv).rgb; metal=0.; rough=.18;
  }
  if(uMode==4){ // couro
    vec2 q=vUv*20.; float n=noise(q)*.6+noise(q*2.7)*.4; N=normalize(N+vec3(noise(q+3.1)-n,noise(q+7.7)-n,0.)*.22);
    base=vec3(.085,.045,.027)*(.8+.35*n)*(1.+.25*smoothstep(1.2,-.6,vUv.y-vUv.x*.4)); metal=0.; rough=.62;
  }
  if(uMode==1){ float br=noise(vec2(vUv.x*3.,vUv.y*90.)); base*=.9+.18*br; rough+=.06*br; } // metal escovado/envelhecido
  vec3 L=normalize(uL), H=normalize(L+V); float NL=max(dot(N,L),0.), NH=max(dot(N,H),0.);
  vec3 F0=mix(vec3(.04),base,metal), F=F0+(1.-F0)*pow(1.-max(dot(N,V),0.),5.);
  float shin=mix(260.,12.,rough);
  vec3 col=base*(1.-metal)*(vec3(1.,.9,.78)*1.25*NL+vec3(.12,.11,.12));
  col+=vec3(1.,.9,.75)*pow(NH,shin)*F*(shin+8.)/24.;
  col+=env(reflect(-V,N))*F*(1.-rough*.7)*mix(.35,1.,metal);
  col+=vec3(.7,.12,.08)*.18*pow(max(dot(N,normalize(vec3(-1.,0.,.3))),0.),2.)*metal; // rebatimento vermelho da esquerda
  col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14); col=pow(clamp(col,0.,1.),vec3(1./2.2));
  o=vec4(col,1.);
}`;

async function startCrest(state) {
  const slot = hero.querySelector('[data-art="crest"] .h2a-float'); if (!slot) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'h2a-gl-crest';
  const gl = context(canvas, true); if (!gl) return null;
  let prog; try { prog = program(gl, OBJ_VS, OBJ_FS); } catch (e) { console.warn('hero-gl brasão:', e.message); return null; }
  const mesh = g => {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    [[g.p, 3], [g.n, 3], [g.u, 2]].forEach(([d, s], i) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.STATIC_DRAW); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, s, gl.FLOAT, false, 0, 0); });
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(g.i), gl.STATIC_DRAW);
    return { vao, n: g.i.length };
  };
  const [logo, room] = await Promise.all([loadImg('assets/logo-marca.png'), loadImg('assets/fotos/salao-principal.jpg')]);
  if (!logo) return null;
  const logoTex = texture(gl, logo, true), roomTex = room ? texture(gl, room, true) : null;

  // peças
  const studs = geo(); [[0, .84], [0, -.92], [-.66, .78], [.66, .78]].forEach(([x, y]) => append(studs, lathe([[0, 0], [.07, 0], [.075, .02], [.05, .055], [0, .07]], 24), M.trans(x, y, .15)));
  const parts = [
    { m: mesh(bevelExtrude(shieldPts(1.0), .22, .05)), mat: { base: [.5, .37, .19], metal: 1, rough: .34, mode: 1 } },            // aro de bronze
    { m: mesh(bevelExtrude(shieldPts(.9), .27, .035)), mat: { base: [.7, .53, .28], metal: 1, rough: .26, mode: 1 } },            // filete dourado
    { m: mesh(bevelExtrude(shieldPts(.86), .285, .03)), mat: { base: [.2, .1, .06], metal: 0, rough: .6, mode: 4 } },             // couro
    { m: mesh(lathe([[.58, .14], [.66, .14], [.7, .17], [.69, .21], [.64, .235], [.6, .22], [.58, .19]], 128)), mat: { base: [.82, .64, .34], metal: 1, rough: .2 }, y: .02 }, // aro do medalhão
    { m: mesh(disc(.59, 128)), mat: { mode: 2 }, z: .2, y: .02 },                                                                   // logo oficial
    { m: mesh(studs), mat: { base: [.85, .68, .38], metal: 1, rough: .22 } }
  ];

  slot.prepend(canvas);
  const size = () => { const r = canvas.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.max(2, Math.round(r.width * d)); canvas.height = Math.max(2, Math.round(r.height * d)); };
  size(); addEventListener('resize', size);
  hero.classList.add('gl-crest');

  return t => {
    const W = canvas.width, H = canvas.height; if (W < 4) return;
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    const eye = [0, 0, 7.6], VP = M.mul(M.persp(22 * Math.PI / 180, W / H, 1, 30), M.look(eye, [0, -.05, 0], [0, 1, 0]));
    const yaw = state.x * .42 + Math.sin(t * .45) * .07, pitch = state.y * .28 + Math.sin(t * .37) * .035;
    const R = M.mul(M.trans(0, 0, 0), M.mul(M.ry(yaw), M.mul(M.rx(pitch), M.rz(Math.sin(t * .3) * .015))));
    gl.useProgram(prog);
    gl.uniformMatrix4fv(prog.u('uVP'), false, VP); gl.uniform3fv(prog.u('uEye'), eye); gl.uniform1f(prog.u('uTime'), t);
    gl.uniform3fv(prog.u('uL'), V.norm([-.45 + state.x * .9, .55 - state.y * .7, .75])); // a luz segue o cursor
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, logoTex); gl.uniform1i(prog.u('uLogo'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, roomTex || logoTex); gl.uniform1i(prog.u('uRoom'), 1); gl.uniform1f(prog.u('uHasRoom'), roomTex ? 1 : 0);
    for (const p of parts) {
      const model = M.mul(R, M.trans(0, p.y || 0, p.z || 0));
      gl.uniformMatrix4fv(prog.u('uModel'), false, model);
      gl.uniform3fv(prog.u('uBase'), p.mat.base || [1, 1, 1]); gl.uniform1f(prog.u('uMetal'), p.mat.metal ?? 0); gl.uniform1f(prog.u('uRough'), p.mat.rough ?? .5); gl.uniform1i(prog.u('uMode'), p.mat.mode || 0);
      gl.bindVertexArray(p.m.vao); gl.drawElements(gl.TRIANGLES, p.m.n, gl.UNSIGNED_INT, 0);
    }
  };
}

/* ============================================================
   Laço único
   ============================================================ */
(async () => {
  if (!hero) return;
  const state = { x: 0, y: 0 };
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = hero.getBoundingClientRect();
    mouse.tx = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1));
    mouse.ty = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1));
    mouse.last = performance.now();
  }, { passive: true });
  let draws = [];
  try { draws = (await Promise.all([startBackground(state), startCrest(state)])).filter(Boolean); }
  catch (e) { console.warn('hero-gl:', e); return; }
  if (!draws.length) return;
  const t0 = performance.now(); let raf = 0, visible = true, last = t0;
  const frame = now => {
    raf = 0; const dt = Math.min(.05, (now - last) / 1000); last = now;
    const k = 1 - Math.pow(.002, dt); mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
    state.x = mouse.x; state.y = mouse.y;
    const t = (now - t0) / 1000; draws.forEach(d => d(t));
    if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const go = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) go(); }, { threshold: 0 }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
  addEventListener('resize', () => requestAnimationFrame(t => draws.forEach(d => d((t - t0) / 1000))));
  go();
  window.__heroGL = { ok: true, layers: draws.length };
})();
