import type { Db } from '../db/tipos.ts';
import type { Sessao } from '../auth/sessao.ts';
import { ErroHttp } from '../validacao.ts';

export type Contexto = {
  db: Db;
  query: URLSearchParams;
  body: Record<string, unknown>;
  sessao: Sessao | null;
  ip: string;
  agora?: string;                 // só em testes: fixa o "agora" das regras de antecedência
  definirCookie: (valor: string) => void;
  token: string | undefined;
};
export type Rota = (c: Contexto) => Promise<unknown>;

export const exigirLogin = (c: Contexto): Sessao => {
  if (!c.sessao) throw new ErroHttp('Sua sessão expirou. Entre novamente.', 401);
  return c.sessao;
};
export const exigirDono = (c: Contexto): Sessao => {
  const s = exigirLogin(c);
  if (s.papel !== 'owner') throw new ErroHttp('Acesso exclusivo do proprietário.', 403);
  return s;
};
