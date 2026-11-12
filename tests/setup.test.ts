// Primeiro acesso do proprietário: só com o código da hospedagem e só enquanto não existir proprietário.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const BASE = process.env.TEST_DATABASE_URL;
const NOME = 'barbearia_teste_setup';
let srv: Server, url = '';
const pular = !BASE && 'defina TEST_DATABASE_URL para rodar os testes com banco';
const chamar = async (caminho: string, corpo?: unknown) => {
  const r = await fetch(url + '/api/' + caminho, corpo === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  return { status: r.status, dados: await r.json() as Record<string, any> };
};

before(async () => {
  if (!BASE) return;
  const admin = `${BASE} dbname=postgres`;
  const psql = (sql: string) => execFileSync('psql', ['-X', '-q', '-d', admin, '-c', sql]);
  psql(`drop database if exists ${NOME}`); psql(`create database ${NOME}`);
  const conexao = `${BASE} dbname=${NOME}`;
  execFileSync('node', ['src/scripts/migrar.ts', '--seed'], { env: { ...process.env, DATABASE_URL: conexao }, stdio: 'ignore' });
  process.env.NODE_ENV = 'test';
  process.env.CODIGO_PRIMEIRO_ACESSO = 'codigo-secreto-da-hostinger';
  const { criarServidor } = await import('../src/servidor.ts');
  const { bancoPsql } = await import('../src/db/psql.ts');
  srv = criarServidor(bancoPsql(conexao));
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(() => { srv?.close(); delete process.env.CODIGO_PRIMEIRO_ACESSO; });

test('primeiro acesso cria o proprietário uma única vez', { skip: pular }, async () => {
  assert.deepEqual((await chamar('setup/status')).dados, { available: true });
  const base = { username: 'dono', password: 'senha-forte-do-dono', confirm: 'senha-forte-do-dono' };
  assert.equal((await chamar('setup/owner', { ...base, code: 'errado' })).status, 403);
  assert.equal((await chamar('setup/owner', { ...base, code: 'codigo-secreto-da-hostinger', password: 'curta', confirm: 'curta' })).status, 400);
  assert.equal((await chamar('setup/owner', { ...base, code: 'codigo-secreto-da-hostinger', confirm: 'outra-senha-qualquer' })).status, 400);
  assert.equal((await chamar('setup/owner', { ...base, code: 'codigo-secreto-da-hostinger' })).status, 200);
  // desliga sozinho
  assert.deepEqual((await chamar('setup/status')).dados, { available: false });
  assert.equal((await chamar('setup/owner', { ...base, code: 'codigo-secreto-da-hostinger', username: 'outro' })).status, 409);
  // o login funciona e é de proprietário
  const login = await chamar('staff/login', { username: 'dono', password: 'senha-forte-do-dono' });
  assert.equal(login.status, 200); assert.equal(login.dados.role, 'owner'); assert.equal(login.dados.barber, 'Rafael');
});
