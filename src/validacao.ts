// Validação de entrada (sem dependências). Cada função devolve o valor limpo ou lança ErroEntrada (HTTP 400).
export class ErroHttp extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const falha = (msg: string): never => { throw new ErroHttp(msg, 400); };

export const dia = (v: unknown): string => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) falha('Data inválida.');
  return s;
};
export const hora = (v: unknown): string => { const s = String(v ?? ''); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) falha('Horário inválido.'); return s; };
export const inteiro = (v: unknown, min: number, max: number, nome: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) falha(`${nome} inválido.`);
  return n;
};
export const texto = (v: unknown, min: number, max: number, nome: string): string => {
  const s = String(v ?? '').trim();
  if (s.length < min || s.length > max) falha(`Informe ${nome}.`);
  return s;
};
export const telefone = (v: unknown): string => {
  const s = String(v ?? '').replace(/\D/g, '');
  if (!/^\d{10,11}$/.test(s)) falha('Informe um telefone com DDD e 10 ou 11 dígitos.');
  return s;
};
export const servicos = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 10) falha('Selecione pelo menos um serviço.');
  const lista = (v as unknown[]).map(String);
  if (!lista.every(s => /^[a-z][a-z0-9_]{1,40}$/.test(s))) falha('Serviço inválido.');
  return [...new Set(lista)];
};
export const chave = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(s)) falha('Chave de requisição inválida.');
  return s;
};
