// Sessões revogáveis: o cookie leva um token aleatório; o banco guarda só o sha256 dele.
import { randomBytes, createHash } from 'node:crypto';
import type { Db } from '../db/tipos.ts';

export const COOKIE = 'sessao_barbearia';
const DURACAO_DIAS = 30;
export type Sessao = { usuarioId: string; papel: 'owner' | 'barber'; barbeiro: string; barbeiroId: string };

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function criarSessao(db: Db, usuarioId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`insert into sessoes (usuario_id, token_hash, expira_em) values ($1, $2, now() + make_interval(days => ${DURACAO_DIAS})) returning id`, [usuarioId, hash(token)]);
  return { token, maxAge: DURACAO_DIAS * 86400 };
}
export async function lerSessao(db: Db, token: string | undefined): Promise<Sessao | null> {
  if (!token || token.length > 100) return null;
  const [s] = await db.query<{ usuario_id: string; papel: 'owner' | 'barber'; barbeiro: string; barbeiro_id: string }>(
    `select u.id as usuario_id, u.papel::text as papel, b.nome as barbeiro, b.id as barbeiro_id
       from sessoes s join usuarios u on u.id = s.usuario_id join barbeiros b on b.id = u.barbeiro_id
      where s.token_hash = $1 and s.revogada_em is null and s.expira_em > now() and u.ativo`, [hash(token)]);
  return s ? { usuarioId: s.usuario_id, papel: s.papel, barbeiro: s.barbeiro, barbeiroId: s.barbeiro_id } : null;
}
export async function encerrarSessao(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query(`update sessoes set revogada_em = now() where token_hash = $1 and revogada_em is null returning id`, [hash(token)]);
}
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  for (const parte of (cabecalho ?? '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
export function cookieSessao(token: string, maxAge: number, seguro: boolean): string {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`;
}
