// Interface mínima de acesso ao banco: as rotas só conhecem isto (facilita testar e trocar o driver).
export type Linha = Record<string, unknown>;
export interface Db {
  query<T extends Linha = Linha>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  close(): Promise<void>;
}
/** Erro vindo do PostgreSQL, com SQLSTATE (ex.: P0001 regra de negócio, P0409 horário ocupado). */
export class ErroBanco extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}
