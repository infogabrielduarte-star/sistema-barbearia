// SOMENTE PRÉVIA. Simula a /api em memória para mostrar as telas. Começa vazia (12/11) e NADA é salvo de verdade:
// recarregar a página apaga o que foi lançado. O sistema real é o servidor em src/ com o banco. Nunca copiar para public/.
(() => {
  const SERVICES = {
    corte_maquina: { name: 'Corte máquina', price: 3000, duration: 30 },
    corte_tesoura: { name: 'Corte com tesoura', price: 4000, duration: 40 },
    barba: { name: 'Barba', price: 2000, duration: 10 },
    cavanhaque: { name: 'Cavanhaque', price: 1000, duration: 5 },
    pe_cabelo: { name: 'Pé de cabelo', price: 1000, duration: 10 },
    sobrancelha: { name: 'Sobrancelha', price: 500, duration: 5 },
    pigmentacao_cabelo: { name: 'Pigmentação cabelo', price: 1500, duration: 10 },
    pigmentacao_barba: { name: 'Pigmentação barba & cavanhaque', price: 1000, duration: 5 },
    platinado: { name: 'Platinado', price: 6000, duration: 120 },
    luzes: { name: 'Luzes', price: 5000, duration: 120 }
  };
  const BARBERS = ['Rafael', 'Lucas', 'Bruno'];
  const OPEN = 9 * 60, CLOSE = 19 * 60, LUNCH = [12 * 60, 13 * 60], STEP = 10, ADVANCE = 20;
  const PAYMENTS = ['Pix', 'Pix', 'Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito'];

  // ---------- utilidades ----------
  let seed = 2026;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  // randomUUID só existe em https/localhost; pelo IP da rede (http://192.168…) usa um gerador simples
  const uid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  const nowSP = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const overlaps = (a, b, c, d) => a < d && c < b;
  const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const durationOf = keys => keys.reduce((n, k) => n + (SERVICES[k]?.duration || 0), 0);
  const priceOf = keys => keys.reduce((n, k) => n + (SERVICES[k]?.price || 0), 0);
  const stamp = () => new Date().toISOString();

  // ---------- dados (12/11: começa ZERADO, sem atendimentos, clientes, vendas ou recados de teste) ----------
  const db = { sales: [], appointments: [], clients: [], products: [], notes: [], expenses: [], accounts: [], serviceSettings: [], debts: [], idem: new Set() };
  void pick; void PAYMENTS;
  // Acessos: o dono já existe (entra com qualquer senha, só na prévia). Os barbeiros começam sem acesso:
  // o dono cria em Gestão → Equipe e acessos. Ficam salvos neste navegador para sobreviver ao recarregar.
  // ATENÇÃO: o "hash" abaixo é só para a prévia não guardar a senha em texto puro — no servidor real usar argon2.
  const ACC_KEY = 'demo-accounts-v1'; // v2: acessos zerados em 10/11
  const demoHash = (salt, pw) => { let h = 0x811c9dc5; for (const ch of salt + ':' + pw) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const RATE_KEY = 'demo-rates-v1'; // histórico: nunca se apaga, só se acrescenta
  // % da barbearia (valores de exemplo)
  const HOUSE_PCT = { 'Rafael': 30, 'Bruno': 40, 'Lucas': 50 };
  db.rateHistory = BARBERS.map(barber => ({ id: uid(), barber, percent: HOUSE_PCT[barber] ?? 0, effective_from: '2000-01-01', created_by: 'Valor de exemplo', created_at: '2026-11-12T00:00:00Z' }));
  try { const saved = JSON.parse(localStorage.getItem(RATE_KEY) || '[]'); if (Array.isArray(saved)) db.rateHistory.push(...saved); } catch { }
  const saveRates = () => { try { localStorage.setItem(RATE_KEY, JSON.stringify(db.rateHistory.filter(r => r.created_by !== 'Valor de exemplo'))); } catch { } };
  const saveAccounts = () => { try { localStorage.setItem(ACC_KEY, JSON.stringify(db.accounts)); } catch { } };
  const OWNER_DEFAULT = { id: 'owner-principal', barber: 'Rafael', username: 'dono', active: 1, salt: 'demo-owner', hash: 'f98fc872' };
  db.accounts = [];
  const RENAMED = {};
  try { db.accounts.push(...JSON.parse(localStorage.getItem(ACC_KEY) || '[]').map(a => ({ ...a, barber: RENAMED[a.barber] || a.barber }))); } catch { }
  if (!db.accounts.some(a => a.barber === 'Rafael')) db.accounts.unshift({ ...OWNER_DEFAULT });
  db.serviceSettings = Object.entries(SERVICES).map(([id, s]) => ({ id, ...s, active: 1 }));

  // ---------- sessão ----------
  let session = null; // { role: 'owner'|'barber', barber }
  try { session = JSON.parse(sessionStorage.getItem('preview-session') || 'null'); } catch { }
  const saveSession = () => { try { sessionStorage.setItem('preview-session', JSON.stringify(session)); } catch { } };
  if (session && RENAMED[session.barber]) { session.barber = RENAMED[session.barber]; saveSession(); }
  // sessão de barbeiro só vale se o acesso dele existir e estiver ativo
  if (session?.role === 'barber' && !db.accounts.some(x => x.barber === session.barber && x.active)) { session = null; saveSession(); }

  // ---------- regras ----------
  const busy = (barber, day, s, e, ignoreId) => overlaps(s, e, LUNCH[0], LUNCH[1]) || db.appointments.some(a => a.id !== ignoreId && a.barber === barber && a.day === day && ['booked', 'blocked', 'completed'].includes(a.status) && overlaps(s, e, toMin(a.time), toMin(a.time) + a.duration));
  function publicTimes(day, barber, duration) {
    const wd = weekday(day), n = nowSP();
    if (wd === 0 || wd === 1 || day < n.day) return [];
    const out = [];
    for (let s = OPEN; s + duration <= CLOSE; s += STEP) {
      const e = s + duration;
      if (day === n.day && s < n.min + ADVANCE) continue;
      if (overlaps(s, e, LUNCH[0], LUNCH[1])) continue;
      if (busy(barber, day, s, e)) continue;
      out.push(hhmm(s));
    }
    return out;
  }
  const visible = list => session?.role === 'owner' ? list : list.filter(a => a.barber === session?.barber);
  const find = id => { const a = db.appointments.find(x => x.id === id); if (!a) throw err('Registro não encontrado.', 404); return a; };
  const own = a => { if (session.role !== 'owner' && a.barber !== session.barber) throw err('Sem permissão para este registro.', 403); };
  const err = (message, status = 400) => Object.assign(new Error(message), { status });
  const pctOk = v => { const n = Number(v ?? 0); if (!Number.isFinite(n) || n < 0 || n > 100) throw err('A comissão deve estar entre 0 e 100%.'); return Math.round(n * 100) / 100; };
  const needOwner = () => { if (session?.role !== 'owner') throw err('Acesso exclusivo do proprietário.', 403); };
  const needLogin = () => { if (!session) throw err('Sua sessão expirou. Entre novamente.', 401); };

  function adminData(month) {
    const paidIn = (m, list) => list.filter(a => a.status === 'completed' && a.paid_day?.startsWith(m)).reduce((n, a) => n + a.amount, 0);
    const [y, mo] = month.split('-').map(Number);
    const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
    const n = nowSP();
    let weekEnd = month === n.day.slice(0, 7) ? n.day : addDays(new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10), -1);
    let weekStart = weekEnd; while (weekday(weekStart) !== 1 && weekStart.slice(0, 7) === month) weekStart = addDays(weekStart, -1);
    if (weekStart.slice(0, 7) !== month) weekStart = month + '-01';
    const weekRevenue = db.appointments.filter(a => a.status === 'completed' && a.paid_day && a.paid_day >= weekStart && a.paid_day <= weekEnd).reduce((s, a) => s + a.amount, 0);
    return {
      appointments: db.appointments.filter(a => a.day.startsWith(month) || a.paid_day?.startsWith(month)),
      todayAppointments: db.appointments.filter(a => a.day === n.day),
      pendingAppointments: db.appointments.filter(a => a.status === 'completed' && !a.paid_day),
      sales: db.sales.filter(s => s.day.startsWith(month) || s.day === n.day), products: db.products, expenses: db.expenses.filter(e => e.day.startsWith(month)), notes: db.notes,
      rateHistory: db.rateHistory, accounts: db.accounts.map(({ salt, hash, ...a }) => a), serviceSettings: db.serviceSettings,
      weekRevenue, weekStart, weekEnd, weekTitle: month === n.day.slice(0, 7) ? 'Arrecadado nesta semana' : 'Última semana do mês',
      previousRevenue: paidIn(prev, db.appointments), previousLabel: 'Comparado a ' + prev.split('-').reverse().join('/')
    };
  }

  // ---------- rotas ----------
  const routes = {
    'GET catalog': () => ({ services: Object.fromEntries(db.serviceSettings.filter(s => s.active).map(s => [s.id, { name: s.name, price: s.price, duration: s.duration }])), barbers: [{ name: 'Rafael', whatsapp: '21900000001' }, { name: 'Lucas', whatsapp: '21900000003' }, { name: 'Bruno', whatsapp: '21900000002' }] }),
    'GET availability': q => ({ times: publicTimes(q.get('day'), q.get('barber'), Number(q.get('duration'))) }),
    'POST book': b => {
      const duration = durationOf(b.services), amount = priceOf(b.services);
      if (!publicTimes(b.day, b.barber, duration).includes(b.time)) throw err('Esse horário acabou de ser reservado. Escolha outro.', 409);
      const a = { id: uid(), barber: b.barber, day: b.day, time: b.time, duration, name: b.name, phone: b.phone, services: JSON.stringify(b.services), scheduled_amount: amount, amount, discount: 0, payment: '', paid_day: null, status: 'booked', origin: 'scheduled', notes: '', created_at: stamp(), version: 1 };
      db.appointments.push(a); return { id: a.id, duration, amount };
    },
    'POST staff/login': b => {
      const u = String(b.username || '').trim().toLowerCase();
      const acc = db.accounts.find(a => a.username === u);
      if (!acc || !b.password || acc.hash !== demoHash(acc.salt, b.password)) {
        const hint = ['bruno', 'lucas'].includes(u) && !acc ? ' Este acesso não existe neste aparelho. Na prévia, cada aparelho guarda os próprios logins: entre como dono aqui e crie o acesso em Equipe e acessos.' : '';
        throw err('Usuário ou senha incorretos.' + hint, 401);
      }
      if (!acc.active) throw err('Acesso bloqueado pelo proprietário. Fale com o Rafael.', 403);
      session = { role: acc.barber === 'Rafael' ? 'owner' : 'barber', barber: acc.barber }; saveSession();
      return { ok: true, role: session.role, barber: session.barber };
    },
    'POST staff/logout': () => { session = null; saveSession(); return { ok: true }; },
    'POST owner-login': () => { throw err('Use usuário e senha.', 400); },
    'GET owner-session': () => ({ authenticated: !!session, authorized: session?.role === 'owner', canEnroll: false, email: session ? 'dono@exemplo.com' : '', source: 'password' }),
    'GET team/session': () => session ? { authenticated: true, role: session.role, barber: session.barber } : { authenticated: false },
    'GET admin': q => { needOwner(); return adminData(q.get('month')); },
    'GET team/data': q => {
      needLogin(); const m = q.get('month');
      return { barber: session.barber, appointments: db.appointments.filter(a => a.barber === session.barber && (a.day.startsWith(m) || a.paid_day?.startsWith(m))), notes: db.notes.filter(n => n.barber === session.barber),
        // barbeiro não recebe custo nem % de comissão dos produtos
        products: db.products.map(({ cost, commission, ...p }) => p),
        sales: db.sales.filter(x => x.barber === session.barber && x.day.startsWith(m)).map(x => ({ ...x, items: x.items.map(({ cost, commission, ...i }) => i) })) };
    },
    'POST team/attendance': b => {
      needLogin(); if (b.requestKey && db.idem.has(b.requestKey)) return { ok: true }; db.idem.add(b.requestKey);
      if (!b.services?.length) throw err('Selecione pelo menos um serviço.');
      const barber = session.role === 'owner' ? (b.barber || session.barber) : session.barber;
      const a = { id: uid(), barber, day: b.day, time: b.time, duration: durationOf(b.services), name: b.name || 'Cliente avulso', phone: '', services: JSON.stringify(b.services), scheduled_amount: priceOf(b.services), amount: b.amount, discount: b.discount || 0, payment: b.payment, paid_day: b.payment === 'Pendente' ? null : b.day, status: 'completed', origin: b.origin || 'walkin', notes: b.notes || '', created_at: stamp(), version: 1 };
      db.appointments.push(a); return { ok: true, id: a.id };
    },
    'POST status': b => { needLogin(); const a = find(b.id); own(a); a.status = b.status; a.version++; return { ok: true }; },
    'POST team/note': b => {
      needLogin();
      db.notes.unshift({ id: uid(), barber: session.barber, kind: b.kind, productId: b.productId, quantity: b.quantity, title: b.title || (db.products.find(p => p.id === b.productId)?.name + ' — reposição'), description: b.description, priority: b.priority || 'attention', status: 'open', resolution: '', created_at: stamp(), version: 1 });
      return { ok: true };
    },
    'POST manage/note': b => { needOwner(); const n = db.notes.find(x => x.id === b.id); Object.assign(n, { status: b.status, resolution: b.resolution }); n.version++; return { ok: true }; },
    'POST manage/edit-attendance': b => { needOwner(); const a = find(b.id); Object.assign(a, { name: b.name, barber: b.barber, amount: b.amount, discount: b.discount, payment: b.payment, paid_day: b.payment === 'Pendente' ? null : (a.paid_day || nowSP().day) }); a.version++; return { ok: true }; },
    'GET manage/history': q => { needOwner(); const a = find(q.get('id')); return { entries: [{ event: 'Criado', actor: a.barber, created_at: a.created_at, detail: 'Registro criado (prévia).' }] }; },
    'POST manage/account': b => {
      needOwner();
      const username = String(b.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw err('Usuário deve ter de 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.');
      if (String(b.password || '').length < 12) throw err('A senha precisa ter pelo menos 12 caracteres.');
      if (db.accounts.some(a => a.username === username && a.barber !== b.barber)) throw err('Esse usuário já está em uso por outro profissional.');
      let acc = db.accounts.find(a => a.barber === b.barber);
      if (!acc) { acc = { id: uid(), barber: b.barber, active: 1 }; db.accounts.push(acc); }
      acc.salt = uid(); acc.hash = demoHash(acc.salt, b.password); acc.username = username; acc.active = 1;
      if (session && session.barber === b.barber && session.role !== 'owner') { session = null; saveSession(); }
      saveAccounts(); return { ok: true };
    },
    'POST manage/rate': b => {
      needOwner(); const pct = Number(b.percent);
      if (!BARBERS.includes(b.barber)) throw err('Profissional não encontrado.', 404);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw err('Informe um percentual entre 0 e 100.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveFrom || ''))) throw err('Informe a data em que a nova porcentagem passa a valer.');
      db.rateHistory.push({ id: uid(), barber: b.barber, percent: Math.round(pct * 100) / 100, effective_from: b.effectiveFrom, created_by: session.barber, created_at: stamp() });
      saveRates(); return { ok: true };
    },
    'POST manage/account-state': b => { needOwner(); const acc = db.accounts.find(a => a.id === b.id); acc.active = Number(b.active); if (!acc.active && session?.barber === acc.barber && session.role !== 'owner') { session = null; saveSession(); } saveAccounts(); return { ok: true }; },
    'POST manage/service': b => { needOwner(); const s = db.serviceSettings.find(x => x.id === b.id); Object.assign(s, { name: b.name, price: b.price, duration: b.duration, active: b.active }); SERVICES[b.id] = { name: b.name, price: b.price, duration: b.duration }; return { ok: true }; },
    'POST product': b => { needOwner(); db.products.push({ id: uid(), name: b.name, quantity: b.quantity, minimum: b.minimum, category: b.category || 'material', group: b.category === 'sale' ? (b.group === 'general' ? 'general' : 'fridge') : undefined, commission: b.group === 'general' ? pctOk(b.commission) : 0, price: b.price ?? null, cost: b.cost ?? null }); return { ok: true }; },
    'POST product/edit': b => { needOwner(); const p = db.products.find(x => x.id === b.id); const group = b.group === 'general' ? 'general' : 'fridge'; Object.assign(p, { name: b.name, price: b.price, cost: b.cost, minimum: b.minimum, group, commission: group === 'general' ? pctOk(b.commission) : 0 }); return { ok: true }; },
    'POST sale': b => {
      needLogin(); if (b.requestKey && db.idem.has(b.requestKey)) return { ok: true }; db.idem.add(b.requestKey);
      if (!Array.isArray(b.items) || !b.items.length || b.items.some(i => !Number.isInteger(i.quantity) || i.quantity < 1)) throw err('Informe a quantidade de pelo menos um item.');
      const items = b.items.map(i => { const p = db.products.find(x => x.id === i.productId && x.category === 'sale'); if (!p) throw err('Item não encontrado.'); if (i.quantity > p.quantity) throw err(`Só há ${p.quantity} de ${p.name} em estoque.`); return { p, q: i.quantity }; });
      items.forEach(({ p, q }) => { p.quantity -= q; });
      const n = nowSP();
      const sale = { id: uid(), day: n.day, time: hhmm(n.min), items: items.map(({ p, q }) => ({ productId: p.id, name: p.name, quantity: q, price: p.price, cost: p.cost, group: p.group || 'fridge', commission: p.commission || 0 })), payment: b.payment, barber: session.role === 'owner' ? (b.barber || session.barber) : session.barber, status: 'done', cancel_reason: '', created_at: stamp() };
      sale.total = sale.items.reduce((s, x) => s + x.price * x.quantity, 0);
      db.sales.push(sale); return { ok: true, id: sale.id };
    },
    'POST sale/cancel': b => {
      needOwner(); const s = db.sales.find(x => x.id === b.id); if (!s || s.status === 'cancelled') throw err('Venda não encontrada ou já cancelada.');
      s.items.forEach(i => { const p = db.products.find(x => x.id === i.productId); if (p) p.quantity += i.quantity; });
      Object.assign(s, { status: 'cancelled', cancel_reason: b.reason }); return { ok: true };
    },
    'POST movement': b => { needOwner(); const p = db.products.find(x => x.id === b.id); if (p.quantity + b.delta < 0) throw err('Saída maior que o saldo disponível.'); p.quantity += b.delta; return { ok: true }; },
    'POST expense': b => { needOwner(); db.expenses.push({ id: uid(), description: b.description, amount: b.amount, day: b.day }); return { ok: true }; },
    'GET calendar/day': q => {
      needLogin(); const day = q.get('day'); const bs = session.role === 'owner' ? BARBERS : [session.barber];
      const lunch = [0, 1].includes(weekday(day)) ? [] : bs.map(barber => ({ id: 'almoco:' + barber + ':' + day, barber, day, time: hhmm(LUNCH[0]), duration: LUNCH[1] - LUNCH[0], name: 'Almoço', phone: '', services: '[]', scheduled_amount: 0, amount: 0, discount: 0, payment: '', paid_day: null, status: 'blocked', origin: 'scheduled', notes: 'Almoço', version: 1 }));
      const debtOf = phone => db.debts.filter(d => d.phone && d.phone === phone && !d.paid).reduce((n, d) => n + d.amount, 0);
      return { barbers: bs, appointments: [...visible(db.appointments.filter(a => a.day === day && a.status !== 'cancelled' && a.kind !== 'no_show_fee')).map(a => ({ ...a, debt: debtOf(a.phone) })), ...lunch] };
    },
    'POST calendar/no-show': b => {
      needLogin(); const a = find(b.id); own(a); if (a.status !== 'booked') throw err('Só dá para marcar falta em um agendamento confirmado.');
      const n = nowSP(); if (a.day > n.day || (a.day === n.day && n.min < toMin(a.time) + 15)) throw err('A falta só pode ser marcada depois de 15 minutos de tolerância (a partir das ' + hhmm(toMin(a.time) + 15) + ').');
      a.status = 'no_show'; a.version++; const amount = Math.round(a.scheduled_amount * 0.5);
      if (a.phone) db.debts.push({ id: uid(), phone: a.phone, name: a.name, barber: a.barber, amount, paid: false, from: a.day });
      return { ok: true, debt: a.phone ? amount : 0 };
    },
    'GET calendar/clients': () => { needLogin(); return { clients: db.clients }; },
    'POST calendar/book': b => {
      needLogin(); if (b.requestKey && db.idem.has(b.requestKey)) return { ok: true }; db.idem.add(b.requestKey);
      const barber = session.role === 'owner' ? b.barber : session.barber;
      const duration = b.blocked ? Number(b.duration) : durationOf(b.services || []);
      if (!duration) throw err('Selecione pelo menos um serviço.');
      const s = toMin(b.time);
      if (busy(barber, b.day, s, s + duration)) throw err('Esse horário já está ocupado para ' + barber + '.', 409);
      let client = b.customerId ? db.clients.find(c => c.id === b.customerId) : null;
      if (!b.blocked && !client && b.phone) { client = { id: uid(), name: b.name, phone: b.phone, email: '', birthday: '', notes: '', version: 1 }; db.clients.push(client); }
      const a = { id: uid(), barber, day: b.day, time: b.time, duration, name: b.blocked ? 'Horário indisponível' : (client?.name || b.name), phone: client?.phone || b.phone || '', services: JSON.stringify(b.services || []), scheduled_amount: priceOf(b.services || []), amount: priceOf(b.services || []), discount: 0, payment: '', paid_day: null, status: b.blocked ? 'blocked' : 'booked', origin: 'scheduled', notes: b.notes || '', created_at: stamp(), version: 1 };
      db.appointments.push(a); return { ok: true, id: a.id };
    },
    'POST calendar/close': b => {
      needLogin(); const a = find(b.id); own(a); if (a.status === 'completed') return { ok: true };
      const gross = (b.items || []).reduce((n, i) => n + i.amount, 0);
      Object.assign(a, { service_items: JSON.stringify((b.items || []).map(i => ({ id: i.id, name: (SERVICES[i.id] || {}).name || i.id, chargedPrice: i.amount }))), amount: gross - (b.discount || 0), discount: b.discount || 0, payment: b.payment, paid_day: b.payment === 'Pendente' ? null : nowSP().day, status: 'completed', notes: b.notes || a.notes }); a.version++;
      if (b.chargeDebt && b.payment !== 'Pendente') for (const d of db.debts.filter(x => x.phone && x.phone === a.phone && !x.paid)) {
        d.paid = true; const day = nowSP().day;
        db.appointments.push({ id: uid(), barber: d.barber, day, time: hhmm(nowSP().min), duration: 0, name: d.name + ' — pendência de falta', phone: d.phone, services: '[]', scheduled_amount: d.amount, amount: d.amount, discount: 0, payment: b.payment, paid_day: day, status: 'completed', origin: 'walkin', kind: 'no_show_fee', notes: 'Pendência da falta de ' + d.from.split('-').reverse().join('/'), created_at: stamp(), version: 1 });
      }
      return { ok: true };
    },
    'POST calendar/cancel': b => { needLogin(); if (String(b.id).startsWith('almoco:')) throw err('O horário de almoço (12h às 13h) é fixo e não pode ser liberado.'); const a = find(b.id); own(a); a.status = 'cancelled'; a.version++; return { ok: true }; },
    'POST calendar/reschedule': b => {
      needLogin(); const a = find(b.id); own(a); const barber = session.role === 'owner' ? b.barber : session.barber; const s = toMin(b.time);
      if (busy(barber, b.day, s, s + a.duration, a.id)) throw err('Esse horário já está ocupado. O agendamento original foi mantido.', 409);
      Object.assign(a, { day: b.day, time: b.time, barber }); a.version++; return { ok: true };
    },
    'POST calendar/client': b => {
      needLogin(); let c = b.id ? db.clients.find(x => x.id === b.id) : null;
      if (!c) { c = { id: uid(), version: 0 }; db.clients.push(c); }
      Object.assign(c, { name: b.name, phone: b.phone, email: b.email || '', birthday: b.birthday || '', notes: b.notes || '' }); c.version++; return { ok: true, id: c.id };
    },
    'POST calendar/archive-client': b => { needLogin(); db.clients = db.clients.filter(c => c.id !== b.id); return { ok: true }; }
  };

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (i === -1) return realFetch(input, init);
    const route = url.pathname.slice(i + 5), method = (init.method || 'GET').toUpperCase();
    await new Promise(r => setTimeout(r, 200));
    const handler = routes[method + ' ' + route];
    if (!handler) return json({ error: 'Prévia: rota ' + route + ' ainda não simulada.' }, 404);
    try { return json(handler(method === 'GET' ? url.searchParams : JSON.parse(init.body || '{}')) ?? { ok: true }); }
    catch (e) { return json({ error: e.message || 'Erro na prévia.' }, e.status || 500); }
  };

  // Na prévia não existe login pelo ChatGPT: evita navegar para essas rotas.
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href*="with-chatgpt"]');
    if (a) { e.preventDefault(); session = null; saveSession(); location.hash = '#login'; }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.innerHTML = 'DEMONSTRAÇÃO · dados fictícios em memória (recarregar apaga) · Área dos barbeiros → usuário <b>dono</b>, senha <b>123</b>';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#111;color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-align:center;padding:6px 12px;opacity:.94;pointer-events:none';
    document.body.appendChild(bar);
  });
})();
