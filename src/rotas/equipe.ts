// Rotas da equipe: login/sessão e agenda do painel. O barbeiro da sessão define o que pode ser visto.
import type { Rota } from './contexto.ts';
import { ErroHttp } from '../validacao.ts';
import { conferirSenha, gerarHash } from '../auth/senha.ts';
import { timingSafeEqual, createHash } from 'node:crypto';
import { criarSessao, encerrarSessao, cookieSessao, COOKIE } from '../auth/sessao.ts';

// limite simples de tentativas de login por IP (memória do processo)
const tentativas = new Map<string, { n: number; ate: number }>();
function limitar(ip: string): void {
  const agora = Date.now(), t = tentativas.get(ip);
  if (t && t.ate > agora && t.n >= 8) throw new ErroHttp('Muitas tentativas. Aguarde um minuto e tente de novo.', 429);
  tentativas.set(ip, t && t.ate > agora ? { n: t.n + 1, ate: t.ate } : { n: 1, ate: agora + 60_000 });
}
const seguro = () => process.env.NODE_ENV === 'production';

/** POST /api/staff/login {username, password} → {ok, role, barber} + cookie httpOnly */
export const entrar: Rota = async c => {
  limitar(c.ip);
  const usuario = String(c.body.username ?? '').trim().toLowerCase();
  const senha = String(c.body.password ?? '');
  const [u] = usuario && senha.length <= 200 ? await c.db.query<{ id: string; senha_hash: string; papel: 'owner' | 'barber'; ativo: boolean; barbeiro: string }>(
    `select u.id, u.senha_hash, u.papel::text as papel, u.ativo, b.nome as barbeiro
       from usuarios u join barbeiros b on b.id = u.barbeiro_id where u.usuario = $1 or lower(u.email) = $1`, [usuario]) : [];
  // confere a senha mesmo sem usuário (tempo parecido nos dois casos)
  const ok = await conferirSenha(senha, u?.senha_hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
  if (!u || !ok) throw new ErroHttp('Usuário ou senha incorretos.', 401);
  if (!u.ativo) throw new ErroHttp('Acesso bloqueado pelo proprietário. Fale com o Rafael.', 403);
  const { token, maxAge } = await criarSessao(c.db, u.id);
  c.definirCookie(cookieSessao(token, maxAge, seguro()));
  tentativas.delete(c.ip);
  return { ok: true, role: u.papel, barber: u.barbeiro };
};

export const sair: Rota = async c => {
  await encerrarSessao(c.db, c.token);
  c.definirCookie(`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro() ? '; Secure' : ''}`);
  return { ok: true };
};
export const sessaoEquipe: Rota = async ({ sessao }) =>
  sessao ? { authenticated: true, role: sessao.papel, barber: sessao.barbeiro } : { authenticated: false };
export const sessaoDono: Rota = async ({ sessao }) =>
  ({ authenticated: !!sessao, authorized: sessao?.papel === 'owner', canEnroll: false, email: '', source: 'password' });
// A agenda do painel e as demais rotas da equipe ficam em ./painel.ts

// ---------- primeiro acesso do proprietário (só na instalação) ----------
// Funciona apenas se a variável CODIGO_PRIMEIRO_ACESSO (≥ 12 caracteres) estiver definida na hospedagem
// e AINDA NÃO existir nenhum proprietário. Depois que o Rafael cria o acesso, a rota se desliga sozinha.
const codigoConfere = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** GET /api/setup/status → {available} */
export const statusPrimeiroAcesso: Rota = async c => {
  const codigo = process.env.CODIGO_PRIMEIRO_ACESSO ?? '';
  if (codigo.length < 12) return { available: false };
  const [ja] = await c.db.query(`select 1 as x from usuarios where papel = 'owner' limit 1`);
  return { available: !ja };
};
/** POST /api/setup/owner {code, username, password, confirm} → cria o login do proprietário (Rafael). */
export const primeiroAcesso: Rota = async c => {
  const codigo = process.env.CODIGO_PRIMEIRO_ACESSO ?? '';
  if (codigo.length < 12) throw new ErroHttp('Primeiro acesso não habilitado nesta instalação.', 404);
  limitar(c.ip);
  const [ja] = await c.db.query(`select 1 as x from usuarios where papel = 'owner' limit 1`);
  if (ja) throw new ErroHttp('O acesso do proprietário já foi criado. Entre pela Área dos barbeiros.', 409);
  if (!codigoConfere(String(c.body.code ?? ''), codigo)) throw new ErroHttp('Código de primeiro acesso incorreto.', 403);
  const usuario = String(c.body.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new ErroHttp('Usuário deve ter de 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.');
  const senha = String(c.body.password ?? '');
  if (senha.length < 12 || senha.length > 200) throw new ErroHttp('A senha precisa ter pelo menos 12 caracteres.');
  if (senha !== String(c.body.confirm ?? '')) throw new ErroHttp('As duas senhas não são iguais.');
  const r = await c.db.query(
    `insert into usuarios (barbeiro_id, usuario, senha_hash, papel)
     select id, $1, $2, 'owner' from barbeiros where nome = 'Rafael'
       and not exists (select 1 from usuarios where papel = 'owner')
     returning id`, [usuario, await gerarHash(senha)]);
  if (!r.length) throw new ErroHttp('O acesso do proprietário já foi criado. Entre pela Área dos barbeiros.', 409);
  tentativas.delete(c.ip);
  return { ok: true };
};
