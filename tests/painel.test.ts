// Painel da equipe contra PostgreSQL real: agenda, almoço, sobreposição, fechamento, falta + pendência, dados do mês e acessos.
//   TEST_DATABASE_URL="host=/caminho/do/socket user=postgres" npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const BASE = process.env.TEST_DATABASE_URL;
const NOME = 'barbearia_teste_painel';
const TERCA = '2026-11-17';
const ANTES = '2026-11-16T20:00:00-03:00';            // véspera
const NA_TERCA = (h: string) => `${TERCA}T${h}:00-03:00`;
let srv: Server, url = '', conexao = '';
const pular = !BASE && 'defina TEST_DATABASE_URL para rodar os testes com banco';
const psql = (sql: string, db = conexao) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { encoding: 'utf8' }).trim();

async function chamar(caminho: string, corpo?: unknown, opts: { cookie?: string; agora?: string } = {}) {
  const r = await fetch(url + '/api/' + caminho, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { 'x-test-now': opts.agora ?? ANTES, ...(corpo === undefined ? {} : { 'content-type': 'application/json' }), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  return { status: r.status, dados: await r.json() as Record<string, any>, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const entrar = async (username: string, password: string) => { const r = await chamar('staff/login', { username, password }); assert.equal(r.status, 200, JSON.stringify(r.dados)); return r.cookie!; };
let dono = '', bruno = '';
const dia = async (cookie: string, d = TERCA) => (await chamar(`calendar/day?day=${d}`, undefined, { cookie })).dados;

before(async () => {
  if (!BASE) return;
  const admin = `${BASE} dbname=postgres`;
  psql(`drop database if exists ${NOME}`, admin); psql(`create database ${NOME}`, admin);
  conexao = `${BASE} dbname=${NOME}`;
  const env = { ...process.env, DATABASE_URL: conexao, DB_DRIVER: 'psql' };
  execFileSync('node', ['src/scripts/migrar.ts', '--seed'], { env, stdio: 'ignore' });
  execFileSync('node', ['src/scripts/usuario.ts', '--barbeiro', 'Rafael', '--usuario', 'dono', '--papel', 'owner', '--senha', 'senha-do-dono-123'], { env, stdio: 'ignore' });
  process.env.NODE_ENV = 'test';
  const { criarServidor } = await import('../src/servidor.ts');
  const { bancoPsql } = await import('../src/db/psql.ts');
  srv = criarServidor(bancoPsql(conexao));
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  dono = await entrar('dono', 'senha-do-dono-123');
});
after(() => srv?.close());

test('acessos: o dono cria os logins dos barbeiros; regras de usuário e senha', { skip: pular }, async () => {
  assert.equal((await chamar('manage/account', { barber: 'Bruno', username: 'bruno', password: 'curta' }, { cookie: dono })).status, 400);
  assert.equal((await chamar('manage/account', { barber: 'Bruno', username: 'Jo Nathan!', password: 'senha-do-bruno-123' }, { cookie: dono })).status, 400);
  assert.equal((await chamar('manage/account', { barber: 'Bruno', username: 'bruno', password: 'senha-do-bruno-123' }, { cookie: dono })).status, 200);
  assert.equal((await chamar('manage/account', { barber: 'Lucas', username: 'bruno', password: 'senha-do-lucas-123' }, { cookie: dono })).status, 409);
  assert.equal((await chamar('manage/account', { barber: 'Lucas', username: 'lucas', password: 'senha-do-lucas-123' }, { cookie: dono })).status, 200);
  bruno = await entrar('bruno', 'senha-do-bruno-123');
  const lucasCookie = await entrar('lucas', 'senha-do-lucas-123');
  // barbeiro não acessa a gestão
  assert.equal((await chamar('admin?month=2026-11', undefined, { cookie: bruno })).status, 403);
  assert.equal((await chamar('manage/account', { barber: 'Bruno', username: 'x123', password: 'senha-qualquer-123' }, { cookie: bruno })).status, 403);
  const adm = (await chamar('admin?month=2026-11', undefined, { cookie: dono })).dados;
  assert.deepEqual(adm.accounts.map((a: any) => [a.barber, a.username, a.active]), [['Rafael', 'dono', 1], ['Lucas', 'lucas', 1], ['Bruno', 'bruno', 1]]);
  assert.deepEqual(Object.fromEntries(adm.rateHistory.map((r: any) => [r.barber, r.percent])), { Rafael: 30, Bruno: 40, 'Lucas': 50 });
  // bloquear encerra a sessão aberta; desbloquear devolve o acesso
  const idLucas = adm.accounts.find((a: any) => a.barber === 'Lucas').id;
  assert.equal((await chamar('manage/account-state', { id: idLucas, active: 0 }, { cookie: dono })).status, 200);
  assert.equal((await chamar(`calendar/day?day=${TERCA}`, undefined, { cookie: lucasCookie })).status, 401);
  assert.equal((await chamar('staff/login', { username: 'lucas', password: 'senha-do-lucas-123' })).status, 403);
  await chamar('manage/account-state', { id: idLucas, active: 1 }, { cookie: dono });
  await entrar('lucas', 'senha-do-lucas-123');
  // o dono não bloqueia a si mesmo
  const idDono = adm.accounts.find((a: any) => a.barber === 'Rafael').id;
  assert.equal((await chamar('manage/account-state', { id: idDono, active: 0 }, { cookie: dono })).status, 400);
});

test('almoço 12h–13h travado para todos e aparece na agenda', { skip: pular }, async () => {
  const ag = await dia(dono);
  const almocos = ag.appointments.filter((a: any) => a.name === 'Almoço');
  assert.deepEqual(almocos.map((a: any) => [a.barber, a.time, a.duration, a.status]).sort(),
    [['Bruno', '12:00', 60, 'blocked'], ['Lucas', '12:00', 60, 'blocked'], ['Rafael', '12:00', 60, 'blocked']]);
  // painel: nem agendamento, nem encaixe que entre no almoço
  const r = await chamar('calendar/book', { name: 'Fulano', phone: '21988887777', services: ['corte_maquina'], day: TERCA, time: '11:45' }, { cookie: bruno });
  assert.equal(r.status, 409); assert.match(r.dados.error, /almoço/);
  assert.equal((await chamar('team/attendance', { services: ['barba'], amount: 2000, discount: 0, payment: 'Pix', day: TERCA, time: '12:30' }, { cookie: bruno })).status, 409);
  assert.equal((await chamar('calendar/cancel', { id: almocos[0].id }, { cookie: dono })).status, 400);
  // site público também não oferece horário no almoço
  const livres = (await chamar(`availability?day=${TERCA}&barber=Bruno&duration=30`)).dados.times as string[];
  assert.ok(!livres.some(h => h >= '11:31' && h < '13:00'));
  // segunda (fechado): sem almoço desenhado
  assert.equal((await dia(dono, '2026-11-16')).appointments.filter((a: any) => a.name === 'Almoço').length, 0);
});

test('agenda: sem sobreposição; barbeiro só marca para si; remarcar e cancelar', { skip: pular }, async () => {
  const r1 = await chamar('calendar/book', { requestKey: 'painel-teste-chave-0001', name: 'Carlos Lima', phone: '(21) 97777-1111', services: ['corte_tesoura'], day: TERCA, time: '10:00', barber: 'Rafael' }, { cookie: bruno });
  assert.equal(r1.status, 200);
  // repetido (duplo toque) devolve o mesmo
  assert.equal((await chamar('calendar/book', { requestKey: 'painel-teste-chave-0001', name: 'Carlos Lima', phone: '21977771111', services: ['corte_tesoura'], day: TERCA, time: '10:00' }, { cookie: bruno })).dados.id, r1.dados.id);
  const ag = await dia(bruno);
  const carlos = ag.appointments.find((a: any) => a.id === r1.dados.id);
  assert.equal(carlos.barber, 'Bruno');                           // ignorou o "Rafael" do corpo
  assert.deepEqual([carlos.time, carlos.duration, carlos.amount, carlos.status], ['10:00', 40, 4000, 'booked']);
  // mesmo horário / sobreposto → 409, inclusive vindo do site
  assert.equal((await chamar('calendar/book', { name: 'Outro', services: ['barba'], day: TERCA, time: '10:30' }, { cookie: bruno })).status, 409);
  assert.equal((await chamar('book', { name: 'Site', phone: '21966665555', barber: 'Bruno', day: TERCA, time: '10:20', services: ['barba'] })).status, 409);
  // outro barbeiro no mesmo horário pode
  assert.equal((await chamar('calendar/book', { name: 'Paralelo', services: ['barba'], day: TERCA, time: '10:00', barber: 'Lucas' }, { cookie: dono })).status, 200);
  // bloqueio do barbeiro
  const bl = await chamar('calendar/book', { blocked: true, duration: 30, day: TERCA, time: '16:00', notes: 'Médico' }, { cookie: bruno });
  assert.equal(bl.status, 200);
  assert.equal((await chamar('calendar/book', { name: 'Xavier', services: ['barba'], day: TERCA, time: '16:10' }, { cookie: bruno })).status, 409);
  // remarcar: não pode ir para o almoço nem para cima do bloqueio; pode para um horário livre
  assert.equal((await chamar('calendar/reschedule', { id: carlos.id, version: carlos.version, day: TERCA, time: '11:40' }, { cookie: bruno })).status, 409);
  assert.equal((await chamar('calendar/reschedule', { id: carlos.id, version: carlos.version, day: TERCA, time: '15:50' }, { cookie: bruno })).status, 409);
  assert.equal((await chamar('calendar/reschedule', { id: carlos.id, version: carlos.version, day: TERCA, time: '14:00' }, { cookie: bruno })).status, 200);
  assert.equal((await chamar('calendar/reschedule', { id: carlos.id, version: carlos.version, day: TERCA, time: '14:30' }, { cookie: bruno })).status, 409); // versão velha
  // Lucas não mexe no agendamento do Bruno
  const lucasCookie = await entrar('lucas', 'senha-do-lucas-123');
  assert.equal((await chamar('calendar/cancel', { id: carlos.id }, { cookie: lucasCookie })).status, 403);
  assert.ok(!(await dia(lucasCookie)).appointments.some((a: any) => a.barber === 'Bruno'));
  // liberar o bloqueio
  assert.equal((await chamar('calendar/cancel', { id: bl.dados.id }, { cookie: bruno })).status, 200);
  assert.equal((await chamar('calendar/book', { name: 'Depois do médico', services: ['barba'], day: TERCA, time: '16:10' }, { cookie: bruno })).status, 200);
});

test('fechamento, falta após 15 min, pendência de 50% cobrada no próximo atendimento (100% do profissional)', { skip: pular }, async () => {
  const marca = (time: string, phone: string, name: string, services = ['corte_maquina', 'barba']) =>
    chamar('calendar/book', { name, phone, services, day: TERCA, time }, { cookie: bruno });
  const a = (await marca('09:00', '21955554444', 'Pedro Faltoso')).dados.id;
  // antes da tolerância não marca falta
  const cedo = await chamar('calendar/no-show', { id: a }, { cookie: bruno, agora: NA_TERCA('09:10') });
  assert.equal(cedo.status, 400); assert.match(cedo.dados.error, /15 minutos/);
  const falta = await chamar('calendar/no-show', { id: a }, { cookie: bruno, agora: NA_TERCA('09:16') });
  assert.equal(falta.status, 200); assert.equal(falta.dados.debt, 2500);           // 50% de R$ 50
  // horário liberado: dá para marcar outro cliente às 09:00
  assert.equal((await marca('09:00', '21944443333', 'Encaixe Rápido', ['barba'])).status, 200);
  // o mesmo cliente volta outro dia; a pendência aparece e é cobrada junto
  const quinta = '2026-11-19';
  const b = (await chamar('calendar/book', { name: 'Pedro Faltoso', phone: '21955554444', services: ['corte_maquina'], day: quinta, time: '15:00' }, { cookie: dono, agora: NA_TERCA('18:00') })).dados.id;
  const doDia = (await dia(dono, quinta)).appointments.find((x: any) => x.id === b);
  assert.equal(doDia.debt, 2500);
  const fecha = await chamar('calendar/close', { id: b, version: doDia.version, items: [{ id: 'corte_maquina', amount: 3000 }], discount: 300, payment: 'Pix', notes: '', chargeDebt: true },
    { cookie: dono, agora: `${quinta}T15:40:00-03:00` });
  assert.equal(fecha.status, 200, JSON.stringify(fecha.dados));
  // duplo toque no fechamento não lança duas vezes
  assert.equal((await chamar('calendar/close', { id: b, items: [{ id: 'corte_maquina', amount: 3000 }], discount: 0, payment: 'Pix' }, { cookie: dono })).status, 200);
  const adm = (await chamar('admin?month=2026-11', undefined, { cookie: dono, agora: `${quinta}T16:00:00-03:00` })).dados;
  const fechado = adm.appointments.find((x: any) => x.id === b);
  assert.deepEqual([fechado.status, fechado.amount, fechado.discount, fechado.scheduled_amount, fechado.payment, fechado.paid_day, fechado.kind],
    ['completed', 2700, 300, 3000, 'Pix', quinta, 'service']);
  const taxa = adm.appointments.filter((x: any) => x.kind === 'no_show_fee');
  assert.equal(taxa.length, 1);
  assert.deepEqual([taxa[0].barber, taxa[0].amount, taxa[0].paid_day], ['Bruno', 2500, quinta]);    // vai para quem perdeu o horário
  assert.equal((await dia(dono, quinta)).appointments.find((x: any) => x.id === b).debt, 0);
  // a falta aparece como "no_show" e o histórico registra quem fez
  assert.equal(adm.appointments.find((x: any) => x.id === a).status, 'no_show');
  const hist = (await chamar(`manage/history?id=${a}`, undefined, { cookie: dono })).dados.entries.map((e: any) => [e.event, e.actor]);
  assert.deepEqual(hist, [['Criado', 'Equipe'], ['Faltou', 'Bruno']]);
});

test('área do barbeiro: avulso registrado e dados só do próprio mês', { skip: pular }, async () => {
  const r = await chamar('team/attendance', { requestKey: 'avulso-teste-chave-0001', services: ['corte_maquina'], amount: 2700, discount: 300, payment: 'Dinheiro', name: '', day: TERCA, time: '17:00', barber: 'Rafael' },
    { cookie: bruno, agora: NA_TERCA('17:30') });
  assert.equal(r.status, 200);
  assert.equal((await chamar('team/attendance', { requestKey: 'avulso-teste-chave-0001', services: ['corte_maquina'], amount: 2700, discount: 300, payment: 'Dinheiro', day: TERCA, time: '17:00' }, { cookie: bruno })).dados.id, r.dados.id);
  const meu = (await chamar('team/data?month=2026-11', undefined, { cookie: bruno })).dados;
  assert.equal(meu.barber, 'Bruno');
  assert.ok(meu.appointments.every((x: any) => x.barber === 'Bruno'));
  const av = meu.appointments.find((x: any) => x.id === r.dados.id);
  assert.deepEqual([av.name, av.origin, av.status, av.amount, av.scheduled_amount, av.paid_day], ['Cliente avulso', 'walkin', 'completed', 2700, 3000, TERCA]);
  assert.deepEqual([meu.products, meu.sales], [[], []]);
  // estorno só pelo dono, e o registro continua existindo como cancelado
  assert.equal((await chamar('status', { id: r.dados.id, status: 'cancelled' }, { cookie: bruno })).status, 403);
  assert.equal((await chamar('status', { id: r.dados.id, status: 'cancelled' }, { cookie: dono })).status, 200);
  assert.equal(psql(`select status from agendamentos where id = '${r.dados.id}'`), 'cancelado');
});

test('dono: nova % com vigência e correção de atendimento com motivo', { skip: pular }, async () => {
  assert.equal((await chamar('manage/rate', { barber: 'Bruno', percent: 120, effectiveFrom: '2026-12-01' }, { cookie: dono })).status, 400);
  assert.equal((await chamar('manage/rate', { barber: 'Bruno', percent: 25, effectiveFrom: '2026-12-01' }, { cookie: dono })).status, 200);
  const h = (await chamar('admin?month=2026-11', undefined, { cookie: dono })).dados.rateHistory.filter((r: any) => r.barber === 'Bruno');
  assert.deepEqual(h.map((r: any) => [r.percent, r.effective_from]), [[40, '2000-01-01'], [25, '2026-12-01']]);
  const adm = (await chamar('admin?month=2026-11', undefined, { cookie: dono })).dados;
  const alvo = adm.appointments.find((x: any) => x.status === 'completed' && x.kind === 'service');
  assert.equal((await chamar('manage/edit-attendance', { id: alvo.id, version: alvo.version, name: alvo.name, barber: alvo.barber, amount: 2000, discount: 0, payment: 'Pix', reason: '' }, { cookie: dono })).status, 400);
  assert.equal((await chamar('manage/edit-attendance', { id: alvo.id, version: alvo.version, name: alvo.name, barber: alvo.barber, amount: 2000, discount: 0, payment: 'Pix', reason: 'Valor lançado errado' }, { cookie: dono })).status, 200);
  const ev = (await chamar(`manage/history?id=${alvo.id}`, undefined, { cookie: dono })).dados.entries.at(-1);
  assert.deepEqual([ev.event, ev.detail], ['Corrigido', 'Valor lançado errado']);
  // ainda não ativado: resposta clara
  const p = await chamar('sale', { items: [] }, { cookie: dono });
  assert.equal(p.status, 501);
});
