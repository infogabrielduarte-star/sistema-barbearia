// Gera db/instalar-supabase.sql: um único arquivo para colar no "SQL Editor" do Supabase
// (todas as migrações + dados iniciais + proteção da API REST + registro das migrações aplicadas).
// Uso: node src/scripts/pacote-sql.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..', '..', 'db');
const migracoes = readdirSync(join(raiz, 'migrations')).filter(f => f.endsWith('.sql')).sort();
const partes = [
  '-- Barbearia Modelo — instalação completa do banco no Supabase (gerado por src/scripts/pacote-sql.ts; não edite à mão).',
  '-- Cole TUDO no Supabase → SQL Editor → Run, uma única vez, num banco vazio. Não contém dados de teste.',
  'create table if not exists _migracoes (nome text primary key, aplicada_em timestamptz not null default now());',
  ...migracoes.flatMap(m => [`\n-- ===== ${m} =====`, readFileSync(join(raiz, 'migrations', m), 'utf8'), `insert into _migracoes (nome) values ('${m}') on conflict do nothing;`]),
  '\n-- ===== seed.sql (serviços, profissionais, horários, % da barbearia) =====', readFileSync(join(raiz, 'seed.sql'), 'utf8'),
  '\n-- ===== supabase.sql (fecha a API REST pública do Supabase) =====', readFileSync(join(raiz, 'supabase.sql'), 'utf8')
];
writeFileSync(join(raiz, 'instalar-supabase.sql'), partes.join('\n'));
console.log('db/instalar-supabase.sql gerado com', migracoes.length, 'migrações');
