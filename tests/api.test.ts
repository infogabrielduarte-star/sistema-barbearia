// Testes de ponta a ponta da API contra um PostgreSQL real (banco temporário recriado a cada execução).
// Requer: psql no PATH e TEST_DATABASE_URL apontando para um servidor onde se possa criar bancos.
//   ex.: TEST_DATABASE_URL="host=/caminho/do/socket user=postgres" npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const BASE = process.env.TEST_DATABASE_URL;
const NOME = 'barbearia_teste_api';
const AGORA = '2026-11-11T20:00:00-03:00';      // quarta à noite
const TERCA = '2026-11-17';                       // próxima terça (aberto)
let srv: Server, url = '', conexao = '';

const psql = (sql: string, db = conexao) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { encoding: 'utf8' }).trim();
async function chamar(caminho: string, corpo?: unknown, opts: { cookie?: string; agora?: string; tipo?: string } = {}) {
  const r = await fetch(url + '/api/' + caminho, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { 'x-test-now': opts.agora ?? AGORA, ...(corpo === undefined ? {} : { 'content-type': opts.tipo ?? 'application/json' }), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  return { status: r.status, dados: await r.json() as Record<string, any>, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const reserva = (extra: Record<string, unknown> = {}) => ({ name: 'Cliente Teste', phone: '21999990000', barber: 'Bruno', day: TERCA, time: '10:00', services: ['corte_tesoura'], ...extra });

before(async () => {
  if (!BASE) return;
  const admin = `${BASE} dbname=postgres`;
  psql(`drop database if exists ${NOME}`, admin); psql(`create database ${NOME}`, admin);
  conexao = `${BASE} dbname=${NOME}`;
  const env = { ...process.env, DATABASE_URL: conexao, DB_DRIVER: 'psql' };
  execFileSync('node', ['src/scripts/migrar.ts', '--seed'], { env, stdio: 'ignore' });
  execFileSync('node', ['src/scripts/usuario.ts', '--barbeiro', 'Rafael', '--usuario', 'dono', '--papel', 'owner', '--senha', 'senha-do-dono-123'], { env, stdio: 'ignore' });
  execFileSync('node', ['src/scripts/usuario.ts', '--barbeiro', 'Bruno', '--usuario', 'bruno', '--papel', 'barber', '--senha', 'senha-do-bruno-123'], { env, stdio: 'ignore' });
  process.env.NODE_ENV = 'test';
  const { criarServidor } = await import('../src/servidor.ts');
  const { bancoPsql } = await import('../src/db/psql.ts');
  srv = criarServidor(bancoPsql(conexao));
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(() => srv?.close());
const pular = !BASE && 'defina TEST_DATABASE_URL para rodar os testes com banco';

test('catálogo vem do banco (centavos, durações e WhatsApp)', { skip: pular }, async () => {
  const { dados } = await chamar('catalog');
  assert.equal(Object.keys(dados.services).length, 10);
  assert.deepEqual(dados.services.corte_tesoura, { name: 'Corte com tesoura', price: 4000, duration: 40 });
  assert.deepEqual(dados.barbers.map((b: any) => b.name), ['Rafael', 'Lucas', 'Bruno']);
});

test('horários livres: funcionamento, almoço, fechamento e dias fechados', { skip: pular }, async () => {
  const { dados } = await chamar(`availability?day=${TERCA}&barber=Bruno&duration=40`);
  assert.equal(dados.times[0], '09:00');
  assert.equal(dados.times.at(-1), '18:20');
  assert.ok(dados.times.includes('11:20') && !dados.times.includes('11:30') && !dados.times.includes('12:30'));
  assert.deepEqual((await chamar(`availability?day=2026-11-16&barber=Bruno&duration=30`)).dados.times, []); // segunda
  assert.deepEqual((await chamar(`availability?day=2026-11-15&barber=Bruno&duration=30`)).dados.times, []); // domingo
  assert.deepEqual((await chamar(`availability?day=2026-11-10&barber=Bruno&duration=30`)).dados.times, []); // passado
});

test('antecedência mínima de 20 minutos no mesmo dia', { skip: pular }, async () => {
  const { dados } = await chamar(`availability?day=${TERCA}&barber=Bruno&duration=30`, undefined, { agora: `${TERCA}T10:05:00-03:00` });
  assert.equal(dados.times[0], '10:30');
});

test('agendar ocupa o horário e libera os vizinhos que só encostam', { skip: pular }, async () => {
  const r = await chamar('book', reserva());
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.duration, 40); assert.equal(r.dados.amount, 4000); assert.equal(r.dados.whatsapp, '21900000002');
  const { dados } = await chamar(`availability?day=${TERCA}&barber=Bruno&duration=40`);
  assert.ok(dados.times.includes('09:20'), '09:20–10:00 encosta e pode');
  assert.ok(!dados.times.includes('09:30') && !dados.times.includes('10:00') && !dados.times.includes('10:30'));
  assert.ok(dados.times.includes('10:40'));
});

test('sem overbooking: mesmo horário, horário sobreposto e outro barbeiro', { skip: pular }, async () => {
  assert.equal((await chamar('book', reserva({ phone: '21988887777' }))).status, 409);
  const parcial = await chamar('book', reserva({ phone: '21988887777', time: '10:20' }));
  assert.equal(parcial.status, 409); assert.match(parcial.dados.error, /acabou de ser reservado/);
  assert.equal((await chamar('book', reserva({ phone: '21988887777', barber: 'Lucas' }))).status, 200);
});

test('disputa simultânea: 6 clientes ao mesmo tempo, só 1 consegue', { skip: pular }, async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => chamar('book', reserva({ phone: `2197777000${i}`, time: '15:00' }))));
  assert.equal(rs.filter(r => r.status === 200).length, 1);
  assert.equal(rs.filter(r => r.status === 409).length, 5);
  assert.equal(psql(`select count(*) from agendamentos a join barbeiros b on b.id=a.barbeiro_id where b.nome='Bruno' and a.data_hora_inicio='${TERCA} 15:00-03'`), '1');
});

test('o banco recusa sobreposição mesmo escrevendo direto por SQL', { skip: pular }, async () => {
  assert.throws(() => psql(`insert into agendamentos (barbeiro_id, cliente_nome, cliente_telefone, data_hora_inicio, data_hora_fim, valor_agendado_centavos)
    select id, 'Direto', '21900000000', '${TERCA} 10:10-03', '${TERCA} 10:30-03', 0 from barbeiros where nome='Bruno'`), /agendamentos_sem_sobreposicao/);
});

test('bloqueio de horário, almoço e fim do expediente', { skip: pular }, async () => {
  psql(`insert into bloqueios (barbeiro_id, data_hora_inicio, data_hora_fim, motivo) select id, '${TERCA} 16:00-03', '${TERCA} 17:00-03', 'Compromisso' from barbeiros where nome='Bruno'`);
  const { dados } = await chamar(`availability?day=${TERCA}&barber=Bruno&duration=40`);
  assert.ok(!dados.times.includes('15:30') && !dados.times.includes('16:30') && dados.times.includes('17:00'));
  assert.equal((await chamar('book', reserva({ phone: '21966665555', time: '16:10' }))).status, 409);
  assert.equal((await chamar('book', reserva({ phone: '21966665555', time: '11:40' }))).status, 409); // entra no almoço
  assert.equal((await chamar('book', reserva({ phone: '21966665555', time: '18:30' }))).status, 409); // passaria das 19h
});

test('validação de entrada com mensagens em português', { skip: pular }, async () => {
  assert.match((await chamar('book', reserva({ phone: '123' }))).dados.error, /telefone/);
  assert.match((await chamar('book', reserva({ services: [] }))).dados.error, /serviço/);
  assert.equal((await chamar('book', reserva({ services: ['inexistente'], time: '09:00' }))).status, 400);
  assert.equal((await chamar('book', reserva({ day: '2026-13-40' }))).status, 400);
  assert.equal((await chamar('book', reserva(), { tipo: 'text/plain' })).status, 415);
});

test('duplo toque: a mesma chave devolve o mesmo agendamento', { skip: pular }, async () => {
  const chave = 'chave-teste-1234567890';
  const a = await chamar('book', reserva({ phone: '21955554444', time: '09:00', requestKey: chave }));
  const b = await chamar('book', reserva({ phone: '21955554444', time: '09:00', requestKey: chave }));
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(a.dados.id, b.dados.id);
});

test('painel: login, permissões (dono vê todos, barbeiro só a própria) e sair', { skip: pular }, async () => {
  assert.equal((await chamar(`calendar/day?day=${TERCA}`)).status, 401);
  assert.equal((await chamar('staff/login', { username: 'bruno', password: 'errada-errada' })).status, 401);
  const brunoLogin = await chamar('staff/login', { username: 'bruno', password: 'senha-do-bruno-123' });
  assert.equal(brunoLogin.status, 200); assert.equal(brunoLogin.dados.role, 'barber');
  const agBruno = await chamar(`calendar/day?day=${TERCA}`, undefined, { cookie: brunoLogin.cookie });
  assert.deepEqual(agBruno.dados.barbers, ['Bruno']);
  assert.ok(agBruno.dados.appointments.length >= 3 && agBruno.dados.appointments.every((a: any) => a.barber === 'Bruno'));
  assert.ok(agBruno.dados.appointments.some((a: any) => a.status === 'blocked'));
  const dono = await chamar('staff/login', { username: 'dono', password: 'senha-do-dono-123' });
  const agD = await chamar(`calendar/day?day=${TERCA}`, undefined, { cookie: dono.cookie });
  assert.equal(agD.dados.barbers.length, 3);
  assert.ok(agD.dados.appointments.some((a: any) => a.barber === 'Lucas'));
  const semana = await chamar(`calendar/week?start=2026-11-16`, undefined, { cookie: dono.cookie });
  assert.equal(semana.dados.end, '2026-11-22'); assert.ok(semana.dados.appointments.length >= 4);
  assert.equal((await chamar('owner-session', undefined, { cookie: brunoLogin.cookie })).dados.authorized, false);
  assert.equal((await chamar('owner-session', undefined, { cookie: dono.cookie })).dados.authorized, true);
  await chamar('staff/logout', {}, { cookie: brunoLogin.cookie });
  assert.equal((await chamar(`calendar/day?day=${TERCA}`, undefined, { cookie: brunoLogin.cookie })).status, 401);
});

test('bloquear o acesso encerra as sessões abertas', { skip: pular }, async () => {
  const s = await chamar('staff/login', { username: 'bruno', password: 'senha-do-bruno-123' });
  assert.equal((await chamar(`calendar/day?day=${TERCA}`, undefined, { cookie: s.cookie })).status, 200);
  psql(`update usuarios set ativo = false where usuario = 'bruno'`);
  assert.equal((await chamar(`calendar/day?day=${TERCA}`, undefined, { cookie: s.cookie })).status, 401);
  assert.equal((await chamar('staff/login', { username: 'bruno', password: 'senha-do-bruno-123' })).status, 403);
});
