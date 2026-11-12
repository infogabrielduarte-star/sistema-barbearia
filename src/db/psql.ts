// Adaptador SÓ PARA DESENVOLVIMENTO/TESTES: executa cada consulta pelo `psql` (sem instalar pacotes).
// Parâmetros viram variáveis do psql (:'p1'), que o próprio psql escapa como literal SQL — nada é concatenado.
import { execFile } from 'node:child_process';
import type { Db, Linha } from './tipos.ts';
import { ErroBanco } from './tipos.ts';

export function bancoPsql(conexao: string): Db {
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  if (conexao) args.push('-d', conexao);
  return {
    query<T extends Linha>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const vars: string[] = [];
      const texto = sql.replace(/\$(\d+)/g, (_m, n: string) => {
        const v = params[Number(n) - 1];
        if (v === null || v === undefined) return 'NULL';
        vars.push('-v', `p${n}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
        return `:'p${n}'`;
      });
      const script = `\\set VERBOSITY verbose\nwith t as (${texto}) select coalesce(json_agg(t), '[]'::json) from t;\n`;
      return new Promise((resolve, reject) => {
        const p = execFile('psql', [...args, ...vars], { maxBuffer: 32 * 1024 * 1024 }, (erro, saida, stderr) => {
          if (erro) {
            const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr);
            reject(new ErroBanco(m ? m[2] : stderr.trim() || erro.message, m ? m[1] : ''));
            return;
          }
          try { resolve(JSON.parse(saida.trim() || '[]') as T[]); } catch (e) { reject(e); }
        });
        p.stdin?.end(script);
      });
    },
    close: async () => {}
  };
}
