import type { Db } from './tipos.ts';
import { ErroBanco } from './tipos.ts';

/**
 * Produção: driver `pg` (npm i pg) com DATABASE_URL — funciona com PostgreSQL próprio, Neon ou Supabase.
 * Desenvolvimento sem dependências: DB_DRIVER=psql usa o cliente `psql` instalado na máquina (ver ./psql.ts).
 */
export async function abrirBanco(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  if (env.DB_DRIVER === 'psql') {
    const { bancoPsql } = await import('./psql.ts');
    return bancoPsql(env.DATABASE_URL ?? '');
  }
  if (!env.DATABASE_URL) throw new Error('Defina DATABASE_URL (veja .env.example).');
  type PgPool = { query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> };
  type PgModule = { default: { Pool: new (cfg: { connectionString: string; max?: number; ssl?: { rejectUnauthorized: boolean } }) => PgPool } };
  const nome = 'pg';
  const pg = (await import(nome)) as PgModule;
  const pool = new pg.default.Pool({ connectionString: env.DATABASE_URL, max: 10, ssl: env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: false } });
  return {
    async query(sql, params = []) {
      try { return (await pool.query(sql, params)).rows as never; }
      catch (e) { const err = e as { message: string; code?: string }; throw new ErroBanco(err.message, err.code ?? ''); }
    },
    close: () => pool.end()
  };
}
