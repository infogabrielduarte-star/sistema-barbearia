// Servidor HTTP da Barbearia Modelo: entrega o site (public/) e a API (/api/*). Sem framework: só node:http.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Db } from './db/tipos.ts';
import { ErroBanco } from './db/tipos.ts';
import { ErroHttp } from './validacao.ts';
import { lerCookie, lerSessao, COOKIE } from './auth/sessao.ts';
import type { Rota } from './rotas/contexto.ts';
import * as publico from './rotas/publico.ts';
import * as equipe from './rotas/equipe.ts';
import * as painel from './rotas/painel.ts';

const ROTAS: Record<string, Rota> = {
  'GET catalog': publico.catalogo,
  'GET status': publico.status,
  'GET availability': publico.horarios,
  'POST book': publico.agendar,
  'POST staff/login': equipe.entrar,
  'POST staff/logout': equipe.sair,
  'GET team/session': equipe.sessaoEquipe,
  'GET owner-session': equipe.sessaoDono,
  'GET calendar/day': painel.agendaDia,
  'GET calendar/week': painel.agendaSemana,
  'GET setup/status': equipe.statusPrimeiroAcesso,
  'POST setup/owner': equipe.primeiroAcesso,
  'POST calendar/book': painel.marcar,
  'POST calendar/reschedule': painel.remarcar,
  'POST calendar/cancel': painel.cancelar,
  'POST calendar/close': painel.fechar,
  'POST calendar/no-show': painel.faltou,
  'GET calendar/clients': painel.clientes,
  'POST calendar/client': painel.salvarCliente,
  'POST calendar/archive-client': painel.arquivarCliente,
  'GET team/data': painel.dadosEquipe,
  'POST team/attendance': painel.avulso,
  'POST status': painel.estornar,
  'GET admin': painel.admin,
  'POST manage/edit-attendance': painel.editarAtendimento,
  'GET manage/history': painel.historico,
  'POST manage/rate': painel.novaPercentagem,
  'POST manage/service': painel.salvarServico,
  'POST manage/account': painel.salvarAcesso,
  'POST manage/account-state': painel.estadoAcesso,
  // produtos, estoque, despesas e recados: ativados numa próxima etapa
  'POST product': painel.emBreve, 'POST product/edit': painel.emBreve, 'POST movement': painel.emBreve, 'POST expense': painel.emBreve,
  'POST sale': painel.emBreve, 'POST sale/cancel': painel.emBreve, 'POST team/note': painel.emBreve, 'POST manage/note': painel.emBreve
};

const PUBLICO = resolve(import.meta.dirname, '..', 'public');
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.mp4': 'video/mp4'
};
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function json(res: ServerResponse, status: number, dados: unknown, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEGURANCA, ...extra });
  res.end(JSON.stringify(dados));
}
async function corpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  let tam = 0; const partes: Buffer[] = [];
  for await (const p of req) { tam += (p as Buffer).length; if (tam > 64 * 1024) throw new ErroHttp('Requisição grande demais.', 413); partes.push(p as Buffer); }
  if (!tam) return {};
  try { const d: unknown = JSON.parse(Buffer.concat(partes).toString('utf8')); return d && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : {}; }
  catch { throw new ErroHttp('Corpo da requisição inválido.', 400); }
}
/** Traduz erros para {error} em português com o status certo, sem vazar detalhes internos. */
function traduzir(e: unknown): { status: number; error: string } {
  if (e instanceof ErroHttp) return { status: e.status, error: e.message };
  if (e instanceof ErroBanco) {
    if (e.code === 'P0409') return { status: 409, error: e.message };
    if (e.code === 'P0001') return { status: 400, error: e.message };
    if (e.code === 'P0404') return { status: 404, error: e.message };
    if (e.code === '23P01') return { status: 409, error: 'Esse horário acabou de ser reservado. Escolha outro.' };
    if (e.code === '23505') return { status: 409, error: 'Registro duplicado.' };
    if (e.code === '22P02' || e.code === '22007' || e.code === '22008') return { status: 400, error: 'Dados inválidos.' };
  }
  console.error('[erro]', e);
  return { status: 500, error: 'Não foi possível concluir agora. Tente novamente.' };
}

async function arquivo(res: ServerResponse, caminho: string): Promise<void> {
  const alvo = normalize(join(PUBLICO, decodeURIComponent(caminho === '/' ? '/index.html' : caminho)));
  if (!alvo.startsWith(PUBLICO)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(alvo);
    if (!s.isFile()) throw new Error('não é arquivo');
    const tipo = TIPOS[extname(alvo).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': tipo.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600', ...SEGURANCA });
    res.end(await readFile(alvo));
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado'); }
}

export function criarServidor(db: Db): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      await arquivo(res, url.pathname); return;
    }
    const nome = `${req.method} ${url.pathname.slice(5).replace(/\/$/, '')}`;
    const rota = ROTAS[nome];
    if (!rota) { json(res, 404, { error: 'Rota não encontrada.' }); return; }
    try {
      if (req.method === 'POST') {
        // CSRF: só aceita JSON (formulários de outros sites não conseguem enviar) e, se houver Origin, do próprio host
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new ErroHttp('Formato não suportado.', 415);
        const origem = req.headers.origin;
        if (origem && new URL(origem).host !== req.headers.host) throw new ErroHttp('Origem não permitida.', 403);
      }
      const token = lerCookie(req.headers.cookie, COOKIE);
      const cookies: string[] = [];
      const resultado = await rota({
        db, query: url.searchParams, body: req.method === 'POST' ? await corpo(req) : {},
        sessao: await lerSessao(db, token), token,
        ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim(),
        agora: process.env.NODE_ENV === 'test' ? (req.headers['x-test-now'] as string | undefined) : undefined,
        definirCookie: c => cookies.push(c)
      });
      json(res, 200, resultado, cookies.length ? { 'Set-Cookie': cookies } : {});
    } catch (e) {
      const { status, error } = traduzir(e);
      json(res, status, { error });
    }
  });
}

// execução direta: node src/servidor.ts
if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const { abrirBanco } = await import('./db/index.ts');
  const db = await abrirBanco();
  const porta = Number(process.env.PORT ?? 3000);
  criarServidor(db).listen(porta, () => console.log(`Barbearia Modelo no ar: http://localhost:${porta}`));
}
