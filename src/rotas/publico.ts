// Rotas públicas (sem login): catálogo, horários livres e agendamento.
import type { Rota } from './contexto.ts';
import * as v from '../validacao.ts';
import { ErroHttp } from '../validacao.ts';

/** GET /api/catalog → { services: { id: {name, price, duration} }, barbers: [{name, whatsapp}] } */
export const catalogo: Rota = async ({ db }) => {
  const servicos = await db.query<{ id: string; nome: string; preco: number; duracao: number }>(
    `select id, nome, preco_centavos as preco, duracao_minutos as duracao from servicos where ativo order by ordem, nome`);
  const barbeiros = await db.query<{ nome: string; whatsapp: string | null }>(
    `select nome, whatsapp from barbeiros where ativo order by ordem, nome`);
  return {
    services: Object.fromEntries(servicos.map(s => [s.id, { name: s.nome, price: s.preco, duration: s.duracao }])),
    barbers: barbeiros.map(b => ({ name: b.nome, whatsapp: b.whatsapp }))
  };
};

/** GET /api/availability?day=AAAA-MM-DD&barber=Nome&duration=40 → { times: ["09:00", …] } */
export const horarios: Rota = async ({ db, query, agora }) => {
  const d = v.dia(query.get('day'));
  const duracao = v.inteiro(query.get('duration'), 5, 480, 'Duração');
  const barbeiro = v.texto(query.get('barber'), 2, 60, 'o profissional');
  const [b] = await db.query<{ id: string }>(`select id from barbeiros where nome = $1 and ativo`, [barbeiro]);
  if (!b) throw new ErroHttp('Profissional não encontrado.', 404);
  const linhas = await db.query<{ hora: string }>(
    `select hora from horarios_disponiveis($1::uuid, $2::date, $3::int, coalesce($4::timestamptz, now()))`, [b.id, d, duracao, agora ?? null]);
  return { times: linhas.map(l => l.hora) };
};

/** POST /api/book {name, phone, barber, day, time, services[], requestKey?} → {id, duration, amount, token, barber, whatsapp, start} */
export const agendar: Rota = async ({ db, body, agora }) => {
  const nome = v.texto(body.name, 2, 80, 'seu nome');
  const tel = v.telefone(body.phone);
  const barbeiro = v.texto(body.barber, 2, 60, 'o profissional');
  const d = v.dia(body.day);
  const h = v.hora(body.time);
  const servicos = v.servicos(body.services);
  const chave = v.chave(body.requestKey);
  const [r] = await db.query<{ id: string; duracao: number; valor: number; token: string; inicio: string; barbeiro: string; whatsapp: string | null }>(
    `select * from criar_agendamento_site($1, $2::date, $3::time, $4::text[], $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [barbeiro, d, h, `{${servicos.join(',')}}`, nome, tel, chave, agora ?? null]);
  return { id: r.id, duration: r.duracao, amount: r.valor, token: r.token, barber: r.barbeiro, whatsapp: r.whatsapp, start: r.inicio };
};

export const status: Rota = async () => ({ ok: true });
