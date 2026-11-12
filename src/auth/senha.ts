// Senhas com scrypt (node:crypto, sem dependências). Formato guardado: scrypt$N$r$p$sal$hash (base64url).
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 2 ** 15, R = 8, P = 1, TAM = 64;
function scrypt(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, erro) => scryptCb(senha.normalize('NFKC'), sal, TAM, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, chave) => (e ? erro(e) : ok(chave))));
}
export async function gerarHash(senha: string): Promise<string> {
  if (senha.length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres.');
  const sal = randomBytes(16);
  const h = await scrypt(senha, sal, N, R, P);
  return ['scrypt', N, R, P, sal.toString('base64url'), h.toString('base64url')].join('$');
}
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, n, r, p, sal, hash] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const h = await scrypt(senha, Buffer.from(sal, 'base64url'), Number(n), Number(r), Number(p));
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}
