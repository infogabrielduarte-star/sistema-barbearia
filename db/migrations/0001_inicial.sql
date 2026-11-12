-- =====================================================================
-- Barbearia Modelo — esquema inicial (PostgreSQL 15+ / Supabase)
-- Regras que NÃO podem depender do front-end ficam aqui:
--   • sem dois agendamentos no mesmo horário para o mesmo barbeiro (constraint de exclusão)
--   • horários livres e criação de agendamento calculados no banco, numa transação com trava
-- Dinheiro em centavos (integer). Datas em timestamptz; regras no fuso America/Sao_Paulo.
-- =====================================================================
begin;

create extension if not exists btree_gist;   -- igualdade (=) dentro de índice GiST, para a exclusão por barbeiro
create extension if not exists pgcrypto;     -- gen_random_uuid / digest

-- ---------- cadastro ----------
create table barbeiros (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique check (length(trim(nome)) between 2 and 60),
  whatsapp        text check (whatsapp ~ '^\d{10,13}$'),
  almoco_inicio   time not null default '12:00',
  almoco_fim      time not null default '13:00',
  ativo           boolean not null default true,
  ordem           smallint not null default 0,
  criado_em       timestamptz not null default now(),
  check (almoco_fim > almoco_inicio)
);

create table servicos (
  id               text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),   -- slug usado pelo site (ex.: corte_maquina)
  nome             text not null check (length(trim(nome)) between 2 and 80),
  preco_centavos   integer not null check (preco_centavos between 0 and 1000000),
  duracao_minutos  integer not null check (duracao_minutos between 5 and 480 and duracao_minutos % 5 = 0),
  ativo            boolean not null default true,
  ordem            smallint not null default 0,
  atualizado_em    timestamptz not null default now()
);

-- funcionamento da barbearia por dia da semana (0 = domingo … 6 = sábado). Dia sem linha = fechado.
create table horarios_funcionamento (
  dia_semana  smallint primary key check (dia_semana between 0 and 6),
  abre        time not null,
  fecha       time not null,
  check (fecha > abre)
);

-- configurações gerais (uma linha)
create table configuracoes (
  id                        boolean primary key default true check (id),
  fuso                      text    not null default 'America/Sao_Paulo',
  passo_site_minutos        integer not null default 10 check (passo_site_minutos in (5,10,15,20,30)),
  antecedencia_minutos      integer not null default 20 check (antecedencia_minutos between 0 and 1440),
  janela_dias               integer not null default 60 check (janela_dias between 1 and 365),
  cancelar_ate_minutos      integer not null default 60
);

-- cliente identificado pelo telefone (LGPD: só nome, telefone e observações)
create table clientes (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (length(trim(nome)) between 2 and 80),
  telefone     text not null unique check (telefone ~ '^\d{10,11}$'),
  observacoes  text not null default '' check (length(observacoes) <= 1000),
  arquivado    boolean not null default false,
  criado_em    timestamptz not null default now()
);

-- ---------- agenda ----------
create type status_agendamento as enum ('confirmado', 'concluido', 'cancelado', 'faltou');
create type origem_agendamento as enum ('site', 'agenda', 'encaixe', 'avulso');

create table agendamentos (
  id                       uuid primary key default gen_random_uuid(),
  barbeiro_id              uuid not null references barbeiros(id),
  cliente_id               uuid references clientes(id),
  cliente_nome             text not null check (length(trim(cliente_nome)) between 2 and 80),   -- cópia no momento da reserva
  cliente_telefone         text not null check (cliente_telefone ~ '^\d{10,11}$'),
  data_hora_inicio         timestamptz not null,
  data_hora_fim            timestamptz not null,
  periodo                  tstzrange generated always as (tstzrange(data_hora_inicio, data_hora_fim, '[)')) stored,
  status                   status_agendamento not null default 'confirmado',
  origem                   origem_agendamento not null default 'site',
  valor_agendado_centavos  integer not null check (valor_agendado_centavos >= 0),
  desconto_centavos        integer not null default 0,
  valor_final_centavos     integer,                         -- preenchido no fechamento
  forma_pagamento          text,
  pago_em                  timestamptz,
  observacoes              text not null default '' check (length(observacoes) <= 1000),
  token_cliente            uuid not null unique default gen_random_uuid(),   -- link de cancelar/remarcar (sem login)
  chave_idempotencia       text unique check (chave_idempotencia is null or length(chave_idempotencia) between 16 and 80),
  cancelado_motivo         text,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),
  check (data_hora_fim > data_hora_inicio),
  check (data_hora_fim - data_hora_inicio <= interval '8 hours'),
  -- ANTI-OVERBOOKING: o mesmo barbeiro não pode ter dois horários ativos que se sobreponham.
  -- Vale para qualquer caminho de escrita (site, painel, script, SQL manual) e é atômico mesmo com acessos simultâneos.
  constraint agendamentos_sem_sobreposicao
    exclude using gist (barbeiro_id with =, periodo with &&)
    where (status in ('confirmado', 'concluido'))
);
create index agendamentos_barbeiro_inicio on agendamentos (barbeiro_id, data_hora_inicio);
create index agendamentos_cliente on agendamentos (cliente_id);

-- serviços de cada agendamento (um atendimento pode ter corte + barba). Preço e duração congelados na reserva.
create table agendamento_servicos (
  agendamento_id   uuid not null references agendamentos(id) on delete cascade,
  servico_id       text not null references servicos(id),
  preco_centavos   integer not null check (preco_centavos >= 0),
  duracao_minutos  integer not null check (duracao_minutos > 0),
  primary key (agendamento_id, servico_id)
);

-- bloqueios: almoço estendido, folga, compromisso. barbeiro_id nulo = vale para todos.
create table bloqueios (
  id                uuid primary key default gen_random_uuid(),
  barbeiro_id       uuid references barbeiros(id),
  data_hora_inicio  timestamptz not null,
  data_hora_fim     timestamptz not null,
  periodo           tstzrange generated always as (tstzrange(data_hora_inicio, data_hora_fim, '[)')) stored,
  motivo            text not null default '' check (length(motivo) <= 200),
  criado_por        uuid,
  criado_em         timestamptz not null default now(),
  check (data_hora_fim > data_hora_inicio)
);
create index bloqueios_periodo on bloqueios using gist (barbeiro_id, periodo);

-- ---------- acesso (dono e barbeiros) ----------
create type papel_usuario as enum ('owner', 'barber');
create table usuarios (
  id           uuid primary key default gen_random_uuid(),
  barbeiro_id  uuid unique references barbeiros(id),
  usuario      text not null unique check (usuario ~ '^[a-z0-9._-]{3,40}$'),
  email        text unique,
  senha_hash   text not null,                 -- formato "scrypt$N$r$p$sal$hash" (ver src/auth/senha.ts)
  papel        papel_usuario not null default 'barber',
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);
create table sessoes (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  token_hash    text not null unique,           -- sha256 do token do cookie; o token em si nunca é guardado
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  revogada_em   timestamptz
);
create index sessoes_usuario on sessoes (usuario_id);

-- bloquear um acesso encerra as sessões ativas dele
create function encerra_sessoes_ao_bloquear() returns trigger language plpgsql as $$
begin
  if new.ativo = false and old.ativo = true then
    update sessoes set revogada_em = now() where usuario_id = new.id and revogada_em is null;
  end if;
  return new;
end $$;
create trigger usuarios_bloqueio after update of ativo on usuarios for each row execute function encerra_sessoes_ao_bloquear();

-- ---------- auditoria (registros financeiros nunca são apagados) ----------
create table auditoria (
  id          bigserial primary key,
  tabela      text not null,
  registro_id text not null,
  acao        text not null,
  autor       uuid,
  motivo      text,
  antes       jsonb,
  depois      jsonb,
  em          timestamptz not null default now()
);

-- =====================================================================
-- REGRAS DE AGENDA
-- =====================================================================

-- Converte dia + hora local da barbearia em instante (timestamptz)
create function instante_local(p_dia date, p_hora time) returns timestamptz
language sql stable as $$
  select (p_dia + p_hora) at time zone (select fuso from configuracoes)
$$;

-- Horário colide com algo? (agendamento ativo ou bloqueio do barbeiro/geral) — usado pelas duas funções abaixo
create function horario_ocupado(p_barbeiro uuid, p_inicio timestamptz, p_fim timestamptz) returns boolean
language sql stable as $$
  select exists (
           select 1 from agendamentos a
            where a.barbeiro_id = p_barbeiro and a.status in ('confirmado','concluido')
              and a.periodo && tstzrange(p_inicio, p_fim, '[)'))
      or exists (
           select 1 from bloqueios b
            where (b.barbeiro_id = p_barbeiro or b.barbeiro_id is null)
              and b.periodo && tstzrange(p_inicio, p_fim, '[)'))
$$;

-- Horários livres para o SITE PÚBLICO: dentro do funcionamento, terminando até o fechamento,
-- fora do almoço do barbeiro, com antecedência mínima e sem colisão.
create function horarios_disponiveis(p_barbeiro uuid, p_dia date, p_duracao integer, p_agora timestamptz default now())
returns table (hora text)
language sql stable as $$
  with cfg as (select * from configuracoes),
       func as (select (extract(epoch from h.abre) / 60)::int as abre, (extract(epoch from h.fecha) / 60)::int as fecha
                  from horarios_funcionamento h where h.dia_semana = extract(dow from p_dia)),
       barb as (select (extract(epoch from almoco_inicio) / 60)::int as alm_ini, (extract(epoch from almoco_fim) / 60)::int as alm_fim
                  from barbeiros where id = p_barbeiro and ativo),
       -- grade em minutos desde 00:00 (evita a "volta" de time + interval na meia-noite)
       grade as (select n as ini from func, cfg, generate_series(func.abre, func.fecha - p_duracao, cfg.passo_site_minutos) n)
  select to_char(make_time(g.ini / 60, g.ini % 60, 0), 'HH24:MI')
    from grade g, barb, cfg
   where p_duracao between 5 and 480
     and p_dia >= (p_agora at time zone cfg.fuso)::date
     and p_dia <= (p_agora at time zone cfg.fuso)::date + cfg.janela_dias
     and instante_local(p_dia, make_time(g.ini / 60, g.ini % 60, 0)) >= p_agora + make_interval(mins => cfg.antecedencia_minutos)
     -- almoço: o atendimento não pode entrar na faixa do almoço
     and not (g.ini < barb.alm_fim and g.ini + p_duracao > barb.alm_ini)
     and not horario_ocupado(p_barbeiro,
                             instante_local(p_dia, make_time(g.ini / 60, g.ini % 60, 0)),
                             instante_local(p_dia, make_time(g.ini / 60, g.ini % 60, 0)) + make_interval(mins => p_duracao))
   order by g.ini
$$;

-- Erros com mensagem em português; o SQLSTATE permite ao servidor responder com o código HTTP certo.
--   P0001 = regra de negócio (400) · P0409 = horário ocupado (409)

-- Cria um agendamento vindo do SITE, de forma atômica:
--  1) valida dados e serviços; 2) trava o dia do barbeiro; 3) confere se o horário ainda está livre
--  4) grava cliente, agendamento e serviços. A constraint de exclusão é a última garantia.
--  Idempotente: a mesma chave devolve o mesmo agendamento (duplo toque / reenvio).
create function criar_agendamento_site(
  p_barbeiro_nome text, p_dia date, p_hora time, p_servicos text[],
  p_nome text, p_telefone text, p_chave text default null, p_agora timestamptz default now())
returns table (id uuid, duracao integer, valor integer, token uuid, inicio text, barbeiro text, whatsapp text)
language plpgsql as $$
declare
  v_barbeiro barbeiros%rowtype;
  v_duracao integer; v_valor integer; v_qtd integer;
  v_inicio timestamptz; v_cliente uuid; v_id uuid;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  if p_chave is not null then
    return query select a.id, (extract(epoch from a.data_hora_fim - a.data_hora_inicio) / 60)::int, a.valor_agendado_centavos,
                        a.token_cliente, to_char(a.data_hora_inicio at time zone (select fuso from configuracoes), 'YYYY-MM-DD HH24:MI'), b.nome, b.whatsapp
                   from agendamentos a join barbeiros b on b.id = a.barbeiro_id where a.chave_idempotencia = p_chave;
    if found then return; end if;
  end if;

  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Informe seu nome.' using errcode = 'P0001'; end if;
  if v_tel !~ '^\d{10,11}$' then raise exception 'Informe um telefone com DDD e 10 ou 11 dígitos.' using errcode = 'P0001'; end if;
  if coalesce(cardinality(p_servicos), 0) = 0 then raise exception 'Selecione pelo menos um serviço.' using errcode = 'P0001'; end if;

  select * into v_barbeiro from barbeiros where nome = p_barbeiro_nome and ativo;
  if not found then raise exception 'Profissional não encontrado.' using errcode = 'P0001'; end if;

  select count(*), sum(s.duracao_minutos), sum(s.preco_centavos)
    into v_qtd, v_duracao, v_valor
    from servicos s where s.id = any (p_servicos) and s.ativo;
  if v_qtd <> cardinality(array(select distinct unnest(p_servicos))) then
    raise exception 'Algum serviço escolhido não está disponível.' using errcode = 'P0001';
  end if;

  -- trava por barbeiro + dia: dois clientes disputando o mesmo horário são atendidos um de cada vez
  perform pg_advisory_xact_lock(hashtextextended(v_barbeiro.id::text || p_dia::text, 0));

  if not exists (select 1 from horarios_disponiveis(v_barbeiro.id, p_dia, v_duracao, p_agora) h where h.hora = to_char(p_hora, 'HH24:MI')) then
    raise exception 'Esse horário acabou de ser reservado. Escolha outro.' using errcode = 'P0409';
  end if;

  v_inicio := instante_local(p_dia, p_hora);

  insert into clientes (nome, telefone) values (trim(p_nome), v_tel)
  on conflict (telefone) do update set nome = excluded.nome
  returning clientes.id into v_cliente;

  begin
    insert into agendamentos (barbeiro_id, cliente_id, cliente_nome, cliente_telefone, data_hora_inicio, data_hora_fim,
                              origem, valor_agendado_centavos, chave_idempotencia)
    values (v_barbeiro.id, v_cliente, trim(p_nome), v_tel, v_inicio, v_inicio + make_interval(mins => v_duracao),
            'site', v_valor, p_chave)
    returning agendamentos.id into v_id;
  exception when exclusion_violation then
    raise exception 'Esse horário acabou de ser reservado. Escolha outro.' using errcode = 'P0409';
  end;

  insert into agendamento_servicos (agendamento_id, servico_id, preco_centavos, duracao_minutos)
  select v_id, s.id, s.preco_centavos, s.duracao_minutos from servicos s where s.id = any (p_servicos);

  return query select a.id, v_duracao, v_valor, a.token_cliente,
                      to_char(a.data_hora_inicio at time zone (select fuso from configuracoes), 'YYYY-MM-DD HH24:MI'),
                      v_barbeiro.nome, v_barbeiro.whatsapp
                 from agendamentos a where a.id = v_id;
end $$;

-- Agenda do painel: agendamentos de um intervalo de dias (dia, semana), no formato que o painel usa.
-- p_barbeiro nulo = todos (dono). O servidor decide quem pode ver o quê.
create function agenda_periodo(p_inicio date, p_fim date, p_barbeiro uuid default null)
returns table (id uuid, barbeiro text, dia text, hora text, duracao integer, nome text, telefone text,
               servicos text, valor integer, status text, origem text, observacoes text)
language sql stable as $$
  select a.id, b.nome,
         to_char(a.data_hora_inicio at time zone c.fuso, 'YYYY-MM-DD'),
         to_char(a.data_hora_inicio at time zone c.fuso, 'HH24:MI'),
         (extract(epoch from a.data_hora_fim - a.data_hora_inicio) / 60)::int,
         a.cliente_nome, a.cliente_telefone,
         coalesce((select json_agg(s.servico_id order by s.servico_id)::text from agendamento_servicos s where s.agendamento_id = a.id), '[]'),
         coalesce(a.valor_final_centavos, a.valor_agendado_centavos),
         a.status::text, a.origem::text, a.observacoes
    from agendamentos a
    join barbeiros b on b.id = a.barbeiro_id
    cross join configuracoes c
   where a.data_hora_inicio >= instante_local(p_inicio, '00:00')
     and a.data_hora_inicio <  instante_local(p_fim + 1, '00:00')
     and a.status <> 'cancelado'
     and (p_barbeiro is null or a.barbeiro_id = p_barbeiro)
   order by a.data_hora_inicio, b.ordem
$$;

commit;
