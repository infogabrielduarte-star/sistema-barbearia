// Rotas do painel (dono e barbeiros): agenda, fechamento, falta, clientes, atendimentos avulsos, dados do mês e acessos.
// Regra de ouro: quem é o barbeiro vem da SESSÃO. Só o dono escolhe outro profissional; o barbeiro só mexe no que é dele.
// As regras de agenda (almoço, sobreposição, tolerância de 15 min, pendência de 50%) ficam nas funções SQL (db/migrations/0002_painel.sql).
import type { Rota, Contexto } from './contexto.ts';
import { exigirLogin, exigirDono } from './contexto.ts';
import type { Sessao } from '../auth/sessao.ts';
import * as v from '../validacao.ts';
import { ErroHttp } from '../validacao.ts';
import { gerarHash } from '../auth/senha.ts';

type Linha = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (x: unknown, nome = 'Registro'): string => { const s = String(x ?? ''); if (!UUID.test(s)) throw new ErroHttp(`${nome} não encontrado.`, 404); return s; };
const versao = (x: unknown): number | null => (x === undefined || x === null || x === '' ? null : v.inteiro(x, 0, 1_000_000, 'Versão'));
const mes = (x: unknown): string => { const s = String(x ?? ''); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ErroHttp('Mês inválido.'); return s; };
const centavos = (x: unknown, nome: string): number => v.inteiro(x ?? 0, 0, 1_000_000, nome);
const agora = (c: Contexto) => c.agora ?? null;   // nulo = now() no banco
const PAGAMENTOS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Cartão', 'Débito', 'Crédito', 'Pendente'];
const pagamento = (x: unknown): string => { const s = String(x ?? ''); if (!PAGAMENTOS.includes(s)) throw new ErroHttp('Escolha a forma de pagamento.'); return s; };

/** Profissional sobre o qual a ação acontece: o dono escolhe (pelo nome); o barbeiro é sempre ele mesmo. */
async function alvo(c: Contexto, s: Sessao, nome: unknown): Promise<{ id: string; nome: string }> {
  if (s.papel !== 'owner' || !nome) return { id: s.barbeiroId, nome: s.barbeiro };
  const [b] = await c.db.query<{ id: string; nome: string }>(`select id, nome from barbeiros where nome = $1 and ativo`, [String(nome)]);
  if (!b) throw new ErroHttp('Profissional não encontrado.', 404);
  return b;
}
/** Agendamento existente e de quem é. Barbeiro só pode mexer nos próprios. */
async function proprio(c: Contexto, s: Sessao, ag: string) {
  const [a] = await c.db.query<{ barbeiro_id: string; status: string; versao: number }>(`select barbeiro_id, status::text, versao from agendamentos where id = $1`, [ag]);
  if (!a) throw new ErroHttp('Agendamento não encontrado.', 404);
  if (s.papel !== 'owner' && a.barbeiro_id !== s.barbeiroId) throw new ErroHttp('Sem permissão para este registro.', 403);
  return a;
}
const hojeSP = async (c: Contexto) => (await c.db.query<{ d: string }>(`select to_char(coalesce($1::timestamptz, now()) at time zone fuso, 'YYYY-MM-DD') as d from configuracoes`, [agora(c)]))[0].d;

// ---------- agenda (dia / semana) ----------
const CAMPOS = `id, barber, day, time, duration, name, phone, customer_id, services, service_items, scheduled_amount, amount, discount,
                payment, paid_day, status, origin, notes, created_at, version, kind, debt`;

async function agenda(c: Contexto, inicio: string, fim: string) {
  const s = exigirLogin(c);
  const dono = s.papel === 'owner';
  const filtro = dono ? null : s.barbeiroId;
  const barbeiros = await c.db.query<{ id: string; nome: string; ini: string; fim: string; dur: number }>(
    `select id, nome, to_char(almoco_inicio, 'HH24:MI') as ini, to_char(almoco_fim, 'HH24:MI') as fim,
            (extract(epoch from almoco_fim - almoco_inicio) / 60)::int as dur
       from barbeiros where ativo and ($1::uuid is null or id = $1::uuid) order by ordem, nome`, [filtro]);
  const linhas = await c.db.query<Linha>(
    `select ${CAMPOS} from atendimentos_front
      where kind = 'service' and status <> 'cancelled' and day between $1 and $2 and ($3::uuid is null or barbeiro_id = $3::uuid)
      order by day, time`, [inicio, fim, filtro]);
  const bloqueios = await c.db.query<{ id: string; barbeiro: string | null; dia: string; hora: string; duracao: number; motivo: string }>(
    `select b.id, br.nome as barbeiro, to_char(b.data_hora_inicio at time zone cfg.fuso, 'YYYY-MM-DD') as dia,
            to_char(b.data_hora_inicio at time zone cfg.fuso, 'HH24:MI') as hora,
            (extract(epoch from b.data_hora_fim - b.data_hora_inicio) / 60)::int as duracao, b.motivo
       from bloqueios b left join barbeiros br on br.id = b.barbeiro_id cross join configuracoes cfg
      where b.data_hora_inicio < instante_local($2::date + 1, '00:00') and b.data_hora_fim > instante_local($1::date, '00:00')
        and ($3::uuid is null or b.barbeiro_id = $3::uuid or b.barbeiro_id is null)`, [inicio, fim, filtro]);
  // almoço fixo (12h–13h) aparece travado na agenda dos dias de funcionamento
  const abertos = await c.db.query<{ d: string }>(
    `select to_char(d, 'YYYY-MM-DD') as d from generate_series($1::date, $2::date, interval '1 day') d
      where exists (select 1 from horarios_funcionamento h where h.dia_semana = extract(dow from d))`, [inicio, fim]);
  const bloqueado = (x: { id: string; barber: string; day: string; time: string; duration: number; name: string }) => ({
    ...x, phone: '', services: '[]', service_items: '', scheduled_amount: 0, amount: 0, discount: 0, payment: '', paid_day: null,
    status: 'blocked', origin: 'scheduled', notes: x.name, version: 1, kind: 'block', debt: 0
  });
  const nomes = barbeiros.map(b => b.nome);
  const appointments = [
    ...linhas,
    ...bloqueios.flatMap(b => (b.barbeiro ? [b.barbeiro] : nomes).map(nome =>
      bloqueado({ id: b.id, barber: nome, day: b.dia, time: b.hora, duration: b.duracao, name: b.motivo || 'Horário indisponível' }))),
    ...abertos.flatMap(({ d }) => barbeiros.map(b =>
      bloqueado({ id: `almoco:${b.id}:${d}`, barber: b.nome, day: d, time: b.ini, duration: b.dur, name: 'Almoço' })))
  ].sort((x, y) => (String(x.day) + String(x.time)).localeCompare(String(y.day) + String(y.time)));
  return { barbers: nomes, appointments };
}
/** GET /api/calendar/day?day= → {barbers, appointments} (dono: todos; barbeiro: só a própria) */
export const agendaDia: Rota = async c => { const d = v.dia(c.query.get('day')); return agenda(c, d, d); };
/** GET /api/calendar/week?start= → 7 dias */
export const agendaSemana: Rota = async c => {
  const ini = v.dia(c.query.get('start'));
  const fim = new Date(Date.parse(ini + 'T12:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
  return { start: ini, end: fim, ...(await agenda(c, ini, fim)) };
};

// ---------- ações na agenda ----------
/** POST /api/calendar/book {requestKey, customerId?, name, phone?, barber?, services, day, time, notes?, blocked?, duration?} */
export const marcar: Rota = async c => {
  const s = exigirLogin(c), b = c.body;
  const barb = await alvo(c, s, b.barber);
  const bloqueio = b.blocked === true;
  const [r] = await c.db.query<{ id: string }>(
    `select painel_agendar($1, $2, $3::date, $4::time, $5::text[], $6, $7, $8::uuid, $9, $10, $11, $12) as id`,
    [s.usuarioId, barb.id, v.dia(b.day), v.hora(b.time), bloqueio ? null : `{${v.servicos(b.services).join(',')}}`,
     String(b.name ?? '').slice(0, 80), String(b.phone ?? '').replace(/\D/g, '').slice(0, 13),
     b.customerId ? id(b.customerId, 'Cliente') : null, String(b.notes ?? '').slice(0, 1000), v.chave(b.requestKey), bloqueio,
     bloqueio ? v.inteiro(b.duration, 5, 720, 'Duração') : null]);
  return { ok: true, id: r.id };
};

/** POST /api/calendar/reschedule {id, version, day, time, barber?} */
export const remarcar: Rota = async c => {
  const s = exigirLogin(c), b = c.body, ag = id(b.id, 'Agendamento');
  await proprio(c, s, ag);
  const barb = await alvo(c, s, b.barber);
  await c.db.query(`select painel_remarcar($1, $2, $3, $4::date, $5::time, $6) as ok`, [ag, versao(b.version), barb.id, v.dia(b.day), v.hora(b.time), s.usuarioId]);
  return { ok: true };
};

/** POST /api/calendar/cancel {id, version} — cancela agendamento (fica registrado) ou libera um bloqueio. Almoço é fixo. */
export const cancelar: Rota = async c => {
  const s = exigirLogin(c), b = c.body;
  if (String(b.id ?? '').startsWith('almoco:')) throw new ErroHttp('O horário de almoço (12h às 13h) é fixo e não pode ser liberado.');
  const ag = id(b.id, 'Agendamento');
  const [bloq] = await c.db.query<{ barbeiro_id: string | null }>(`select barbeiro_id from bloqueios where id = $1`, [ag]);
  if (bloq) {
    if (s.papel !== 'owner' && bloq.barbeiro_id !== s.barbeiroId) throw new ErroHttp('Sem permissão para este registro.', 403);
    await c.db.query(`delete from bloqueios where id = $1 returning id`, [ag]);
    await c.db.query(`insert into auditoria (tabela, registro_id, acao, autor) values ('bloqueios', $1, 'liberar', $2) returning id`, [ag, s.usuarioId]);
    return { ok: true };
  }
  const a = await proprio(c, s, ag);
  if (a.status !== 'confirmado') throw new ErroHttp(a.status === 'concluido' ? 'Atendimento já concluído: só o proprietário pode estornar.' : 'Este agendamento não está mais ativo.');
  const vers = versao(b.version);
  const r = await c.db.query(
    `update agendamentos set status = 'cancelado', cancelado_motivo = 'Cancelado pela equipe', versao = versao + 1, atualizado_em = now()
      where id = $1 and status = 'confirmado' and ($2::int is null or versao = $2::int) returning id`, [ag, vers]);
  if (!r.length) throw new ErroHttp('Este agendamento foi alterado por outra pessoa. Atualize a agenda.', 409);
  await c.db.query(`insert into auditoria (tabela, registro_id, acao, autor, motivo) values ('agendamentos', $1, 'cancelar', $2, 'Cancelado pela equipe') returning id`, [ag, s.usuarioId]);
  return { ok: true };
};

/** POST /api/calendar/close {id, version, items:[{id, amount}], discount, payment, notes, chargeDebt?} */
export const fechar: Rota = async c => {
  const s = exigirLogin(c), b = c.body, ag = id(b.id, 'Agendamento');
  await proprio(c, s, ag);
  const itens = Array.isArray(b.items) ? (b.items as Linha[]).slice(0, 20).map(i => ({ id: String(i.id ?? ''), amount: centavos(i.amount, 'Valor cobrado') })) : [];
  await c.db.query(`select painel_fechar($1, $2, $3::jsonb, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now())) as ok`,
    [ag, versao(b.version), JSON.stringify(itens), centavos(b.discount, 'Desconto'), pagamento(b.payment), String(b.notes ?? '').slice(0, 1000),
     b.chargeDebt === true, s.usuarioId, agora(c)]);
  return { ok: true };
};

/** POST /api/calendar/no-show {id, version} → {ok, debt} — só após 15 min; gera pendência de 50% e libera o horário. */
export const faltou: Rota = async c => {
  const s = exigirLogin(c), b = c.body, ag = id(b.id, 'Agendamento');
  await proprio(c, s, ag);
  const [r] = await c.db.query<{ valor: number }>(`select painel_faltou($1, $2, $3, coalesce($4::timestamptz, now())) as valor`, [ag, versao(b.version), s.usuarioId, agora(c)]);
  return { ok: true, debt: r.valor };
};

/** POST /api/status {id, status:'cancelled'} — estorno de atendimento (dono). Nunca apaga: fica cancelado com autor. */
export const estornar: Rota = async c => {
  const s = exigirDono(c), b = c.body, ag = id(b.id, 'Atendimento');
  if (b.status !== 'cancelled') throw new ErroHttp('Ação inválida.');
  const r = await c.db.query(`update agendamentos set status = 'cancelado', cancelado_motivo = coalesce(cancelado_motivo, 'Estornado pelo proprietário'),
                                     versao = versao + 1, atualizado_em = now() where id = $1 and status <> 'cancelado' returning id`, [ag]);
  if (!r.length) throw new ErroHttp('Atendimento não encontrado ou já cancelado.', 404);
  await c.db.query(`insert into auditoria (tabela, registro_id, acao, autor, motivo) values ('agendamentos', $1, 'estornar', $2, 'Estornado pelo proprietário') returning id`, [ag, s.usuarioId]);
  return { ok: true };
};

// ---------- clientes ----------
export const clientes: Rota = async c => {
  exigirLogin(c);
  const lista = await c.db.query(
    `select cl.id, cl.nome as name, cl.telefone as phone, cl.email, cl.aniversario as birthday, cl.observacoes as notes, cl.versao as version,
            coalesce((select sum(p.valor_centavos) from pendencias p where p.cliente_id = cl.id and p.status = 'aberta'), 0)::int as debt
       from clientes cl where not cl.arquivado order by cl.nome`);
  return { clients: lista };
};
/** POST /api/calendar/client {id?, version?, name, phone, email?, birthday?, notes?} */
export const salvarCliente: Rota = async c => {
  exigirLogin(c);
  const b = c.body;
  const dados = [v.texto(b.name, 2, 80, 'o nome do cliente'), v.telefone(b.phone), String(b.email ?? '').trim().slice(0, 120),
                 String(b.birthday ?? '').slice(0, 10), String(b.notes ?? '').slice(0, 1000)];
  if (b.id) {
    const r = await c.db.query<{ id: string }>(
      `update clientes set nome = $2, telefone = $3, email = $4, aniversario = $5, observacoes = $6, versao = versao + 1
        where id = $1 and not arquivado and ($7::int is null or versao = $7::int) returning id`, [id(b.id, 'Cliente'), ...dados, versao(b.version)]);
    if (!r.length) throw new ErroHttp('Este cadastro foi alterado por outra pessoa. Atualize a lista.', 409);
    return { ok: true, id: r[0].id };
  }
  const [r] = await c.db.query<{ id: string }>(
    `insert into clientes (nome, telefone, email, aniversario, observacoes) values ($1, $2, $3, $4, $5)
     on conflict (telefone) do update set nome = excluded.nome, email = excluded.email, aniversario = excluded.aniversario,
       observacoes = excluded.observacoes, arquivado = false, versao = clientes.versao + 1
     returning id`, dados);
  return { ok: true, id: r.id };
};
export const arquivarCliente: Rota = async c => {
  exigirLogin(c);
  await c.db.query(`update clientes set arquivado = true, versao = versao + 1 where id = $1 returning id`, [id(c.body.id, 'Cliente')]);
  return { ok: true };
};

// ---------- área do barbeiro ----------
/** GET /api/team/data?month=AAAA-MM → atendimentos do próprio barbeiro no mês (produtos e vendas ainda não ativados). */
export const dadosEquipe: Rota = async c => {
  const s = exigirLogin(c), m = mes(c.query.get('month'));
  const appointments = await c.db.query(
    `select ${CAMPOS} from atendimentos_front where barbeiro_id = $1 and (left(day, 7) = $2 or left(paid_day, 7) = $2) order by day, time`, [s.barbeiroId, m]);
  return { barber: s.barbeiro, appointments, notes: [], products: [], sales: [] };
};
/** POST /api/team/attendance {requestKey, services, amount, discount, payment, name?, day, time, barber?, origin?, notes?} */
export const avulso: Rota = async c => {
  const s = exigirLogin(c), b = c.body;
  const barb = await alvo(c, s, b.barber);
  const [r] = await c.db.query<{ id: string }>(
    `select painel_avulso($1, $2, $3::date, $4::time, $5::text[], $6, $7, $8, $9, $10, $11, $12, coalesce($13::timestamptz, now())) as id`,
    [s.usuarioId, barb.id, v.dia(b.day), v.hora(b.time), `{${v.servicos(b.services).join(',')}}`, String(b.name ?? '').slice(0, 80),
     centavos(b.amount, 'Valor'), centavos(b.discount, 'Desconto'), pagamento(b.payment), b.origin === 'fitin' ? 'fitin' : 'walkin',
     String(b.notes ?? '').slice(0, 1000), v.chave(b.requestKey), agora(c)]);
  return { ok: true, id: r.id };
};

// ---------- painel do dono ----------
/** GET /api/admin?month=AAAA-MM — tudo que a gestão usa para calcular arrecadação e divisão no front. */
export const admin: Rota = async c => {
  exigirDono(c);
  const m = mes(c.query.get('month')), hoje = await hojeSP(c);
  const appointments = await c.db.query(`select ${CAMPOS} from atendimentos_front where left(day, 7) = $1 or left(paid_day, 7) = $1 order by day, time`, [m]);
  const todayAppointments = await c.db.query(`select ${CAMPOS} from atendimentos_front where kind = 'service' and day = $1 order by time`, [hoje]);
  const pendingAppointments = await c.db.query(`select ${CAMPOS} from atendimentos_front where status = 'completed' and paid_day is null order by day, time`);
  const accounts = await c.db.query(`select u.id, b.nome as barber, u.usuario as username, u.papel::text as role, case when u.ativo then 1 else 0 end as active
                                       from usuarios u join barbeiros b on b.id = u.barbeiro_id order by b.ordem`);
  const rateHistory = await c.db.query(`select p.id, b.nome as barber, p.pct_bp / 100.0 as percent, to_char(p.vigente_desde, 'YYYY-MM-DD') as effective_from,
                                               p.criado_por as created_by, p.criado_em as created_at
                                          from percentuais_barbearia p join barbeiros b on b.id = p.barbeiro_id order by p.vigente_desde, p.criado_em`);
  const serviceSettings = await c.db.query(`select id, nome as name, preco_centavos as price, duracao_minutos as duration, case when ativo then 1 else 0 end as active
                                              from servicos order by ordem, nome`);
  // semana corrente (ou última do mês) e mês anterior, só com valores recebidos
  const fimSemana = hoje.slice(0, 7) === m ? hoje : new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
  let iniSemana = fimSemana;
  while (new Date(iniSemana + 'T12:00:00Z').getUTCDay() !== 1 && iniSemana.slice(0, 7) === m) iniSemana = new Date(Date.parse(iniSemana + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  if (iniSemana.slice(0, 7) !== m) iniSemana = m + '-01';
  const ant = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  const [somas] = await c.db.query<{ semana: number; anterior: number }>(
    `select coalesce(sum(amount) filter (where paid_day between $1 and $2), 0)::int as semana,
            coalesce(sum(amount) filter (where left(paid_day, 7) = $3), 0)::int as anterior
       from atendimentos_front where status = 'completed' and paid_day is not null`, [iniSemana, fimSemana, ant]);
  return {
    appointments, todayAppointments, pendingAppointments, sales: [], products: [], expenses: [], notes: [],
    rateHistory: rateHistory.map(r => ({ ...r, percent: Number(r.percent) })), accounts, serviceSettings,
    weekRevenue: somas.semana, weekStart: iniSemana, weekEnd: fimSemana,
    weekTitle: hoje.slice(0, 7) === m ? 'Arrecadado nesta semana' : 'Última semana do mês',
    previousRevenue: somas.anterior, previousLabel: 'Comparado a ' + ant.split('-').reverse().join('/')
  };
};

/** POST /api/manage/edit-attendance {id, version, name, barber, amount, discount, payment, reason} — correção pelo dono, com auditoria. */
export const editarAtendimento: Rota = async c => {
  const s = exigirDono(c), b = c.body, ag = id(b.id, 'Atendimento');
  const motivo = v.texto(b.reason, 3, 300, 'o motivo da correção');
  const barb = await alvo(c, s, b.barber);
  const pg = pagamento(b.payment);
  const [antes] = await c.db.query(`select cliente_nome, barbeiro_id, valor_final_centavos, desconto_centavos, forma_pagamento, pago_em, versao from agendamentos where id = $1`, [ag]);
  if (!antes) throw new ErroHttp('Atendimento não encontrado.', 404);
  const r = await c.db.query(
    `update agendamentos set cliente_nome = $2, barbeiro_id = $3, valor_final_centavos = $4, desconto_centavos = $5, forma_pagamento = $6,
            pago_em = case when $6 = 'Pendente' then null else coalesce(pago_em, coalesce($8::timestamptz, now())) end, versao = versao + 1, atualizado_em = now()
      where id = $1 and ($7::int is null or versao = $7::int) returning id`,
    [ag, v.texto(b.name, 2, 80, 'o nome do cliente'), barb.id, centavos(b.amount, 'Valor'), centavos(b.discount, 'Desconto'), pg, versao(b.version), agora(c)]);
  if (!r.length) throw new ErroHttp('Este atendimento foi alterado por outra pessoa. Atualize a tela.', 409);
  await c.db.query(`insert into auditoria (tabela, registro_id, acao, autor, motivo, antes, depois)
                    select 'agendamentos', $1, 'corrigir', $2, $3, $4::jsonb, to_jsonb(a) - 'periodo' from agendamentos a where a.id = $1::uuid returning id`,
    [ag, s.usuarioId, motivo, JSON.stringify(antes)]);
  return { ok: true };
};
/** GET /api/manage/history?id= → {entries:[{event, actor, created_at, detail}]} */
export const historico: Rota = async c => {
  exigirDono(c);
  const ag = id(c.query.get('id'), 'Atendimento');
  const ACOES: Record<string, string> = { concluir: 'Concluído', cancelar: 'Cancelado', estornar: 'Estornado', remarcar: 'Remarcado', faltou: 'Faltou', corrigir: 'Corrigido' };
  const linhas = await c.db.query<{ acao: string; actor: string; created_at: string; motivo: string | null }>(
    `select a.acao, coalesce(b.nome, 'Sistema') as actor, a.em as created_at, a.motivo
       from auditoria a left join usuarios u on u.id = a.autor left join barbeiros b on b.id = u.barbeiro_id
      where a.registro_id = $1 order by a.em`, [ag]);
  const [criado] = await c.db.query<{ created_at: string; origem: string }>(`select criado_em as created_at, origem::text as origem from agendamentos where id = $1`, [ag]);
  return { entries: [
    ...(criado ? [{ event: 'Criado', actor: criado.origem === 'site' ? 'Cliente (site)' : 'Equipe', created_at: criado.created_at, detail: 'Registro criado.' }] : []),
    ...linhas.map(l => ({ event: ACOES[l.acao] ?? l.acao, actor: l.actor, created_at: l.created_at, detail: l.motivo ?? '' }))
  ] };
};

/** POST /api/manage/rate {barber, percent, effectiveFrom} — nova % da barbearia (só se acrescenta ao histórico). */
export const novaPercentagem: Rota = async c => {
  const s = exigirDono(c), b = c.body;
  const pct = Number(b.percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ErroHttp('Informe um percentual entre 0 e 100.');
  const barb = await alvo(c, s, b.barber);
  await c.db.query(`insert into percentuais_barbearia (barbeiro_id, pct_bp, vigente_desde, criado_por) values ($1, $2, $3::date, $4) returning id`,
    [barb.id, Math.round(pct * 100), v.dia(b.effectiveFrom), s.barbeiro]);
  return { ok: true };
};
/** POST /api/manage/service {id, name, price, duration, active} */
export const salvarServico: Rota = async c => {
  exigirDono(c);
  const b = c.body;
  const r = await c.db.query(`update servicos set nome = $2, preco_centavos = $3, duracao_minutos = $4, ativo = $5, atualizado_em = now() where id = $1 returning id`,
    [String(b.id ?? ''), v.texto(b.name, 2, 80, 'o nome do serviço'), centavos(b.price, 'Preço'), v.inteiro(b.duration, 5, 480, 'Duração'), !!Number(b.active ?? 1)]);
  if (!r.length) throw new ErroHttp('Serviço não encontrado.', 404);
  return { ok: true };
};

// ---------- acessos ----------
/** POST /api/manage/account {barber, username, password} — cria ou redefine o login de um profissional. Redefinir encerra as sessões dele. */
export const salvarAcesso: Rota = async c => {
  const s = exigirDono(c), b = c.body;
  const usuario = String(b.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new ErroHttp('Usuário deve ter de 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.');
  const senha = String(b.password ?? '');
  if (senha.length < 12 || senha.length > 200) throw new ErroHttp('A senha precisa ter pelo menos 12 caracteres.');
  const barb = await alvo(c, s, b.barber);
  const [uso] = await c.db.query(`select 1 from usuarios where usuario = $1 and barbeiro_id <> $2`, [usuario, barb.id]);
  if (uso) throw new ErroHttp('Esse usuário já está em uso por outro profissional.', 409);
  const hash = await gerarHash(senha);
  const [u] = await c.db.query<{ id: string }>(
    `insert into usuarios (barbeiro_id, usuario, senha_hash, papel) values ($1, $2, $3, case when $1::uuid = $4::uuid then 'owner'::papel_usuario else 'barber'::papel_usuario end)
     on conflict (barbeiro_id) do update set usuario = excluded.usuario, senha_hash = excluded.senha_hash, ativo = true
     returning id`, [barb.id, usuario, hash, s.barbeiroId]);
  // encerra as sessões abertas desse login (menos a de quem está redefinindo agora)
  await c.db.query(`update sessoes set revogada_em = now() where usuario_id = $1 and revogada_em is null and usuario_id <> $2 returning id`, [u.id, s.usuarioId]);
  await c.db.query(`insert into auditoria (tabela, registro_id, acao, autor) values ('usuarios', $1, 'definir_acesso', $2) returning id`, [u.id, s.usuarioId]);
  return { ok: true };
};
/** POST /api/manage/account-state {id, active} — bloquear encerra as sessões (trigger). O dono não bloqueia o próprio acesso. */
export const estadoAcesso: Rota = async c => {
  const s = exigirDono(c), b = c.body, u = id(b.id, 'Acesso');
  if (u === s.usuarioId) throw new ErroHttp('Você não pode bloquear o próprio acesso.');
  const r = await c.db.query(`update usuarios set ativo = $2 where id = $1 and papel = 'barber' returning id`, [u, !!Number(b.active)]);
  if (!r.length) throw new ErroHttp('Acesso não encontrado.', 404);
  await c.db.query(`insert into auditoria (tabela, registro_id, acao, autor) values ('usuarios', $1, $2, $3) returning id`, [u, Number(b.active) ? 'desbloquear' : 'bloquear', s.usuarioId]);
  return { ok: true };
};

/** Recursos que ainda não foram ativados no sistema real (produtos/estoque/despesas/recados): resposta clara em vez de erro genérico. */
export const emBreve: Rota = async c => { exigirLogin(c); throw new ErroHttp('Esta parte (produtos, estoque, despesas e recados) ainda será ativada.', 501); };
