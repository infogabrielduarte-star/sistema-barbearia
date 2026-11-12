// Aplica as migrações em ordem e registra quais já rodaram. Uso: npm run db:migrate  (ou com --seed)
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const raiz = resolve(import.meta.dirname, '..', '..', 'db');
const url = process.env.DATABASE_URL ?? '';
const psql = (args: string[], entrada?: string) =>
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(url ? ['-d', url] : []), ...args], { input: entrada, encoding: 'utf8' });

psql(['-c', 'create table if not exists _migracoes (nome text primary key, aplicada_em timestamptz not null default now())']);
const feitas = new Set(psql(['-At', '-c', 'select nome from _migracoes']).split('\n').filter(Boolean));
for (const nome of (await readdir(join(raiz, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) {
  if (feitas.has(nome)) continue;
  psql(['-f', join(raiz, 'migrations', nome)]);
  psql(['-v', `nome=${nome}`], `insert into _migracoes (nome) values (:'nome');`);
  console.log('migração aplicada:', nome);
}
if (process.argv.includes('--seed')) { psql(['-f', join(raiz, 'seed.sql')]); console.log('dados iniciais aplicados'); }
void readFile;
