// Cria ou redefine o acesso de alguém da equipe. A senha é pedida no terminal (não fica no histórico).
// Uso: npm run usuario -- --barbeiro "Rafael" --usuario dono --papel owner
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { abrirBanco } from '../db/index.ts';
import { gerarHash } from '../auth/senha.ts';

const { values } = parseArgs({ options: { barbeiro: { type: 'string' }, usuario: { type: 'string' }, papel: { type: 'string', default: 'barber' }, senha: { type: 'string' } } });
if (!values.barbeiro || !values.usuario || !['owner', 'barber'].includes(values.papel ?? '')) {
  console.error('Uso: npm run usuario -- --barbeiro "Nome" --usuario login --papel owner|barber'); process.exit(1);
}
const senha = values.senha ?? await createInterface({ input: process.stdin, output: process.stdout }).question('Senha (mínimo 12 caracteres): ');
const db = await abrirBanco();
const hash = await gerarHash(senha);
const [r] = await db.query<{ id: string }>(
  `insert into usuarios (barbeiro_id, usuario, senha_hash, papel)
   select id, $2, $3, $4::papel_usuario from barbeiros where nome = $1
   on conflict (barbeiro_id) do update set usuario = excluded.usuario, senha_hash = excluded.senha_hash, papel = excluded.papel, ativo = true
   returning id`, [values.barbeiro, values.usuario.toLowerCase(), hash, values.papel]);
if (!r) { console.error('Profissional não encontrado:', values.barbeiro); process.exit(1); }
// redefinir a senha encerra as sessões abertas
await db.query(`update sessoes set revogada_em = now() where usuario_id = $1 and revogada_em is null returning id`, [r.id]);
console.log(`Acesso pronto: ${values.usuario} (${values.papel}).`);
await db.close();
process.exit(0);
