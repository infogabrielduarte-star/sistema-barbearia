-- Barbearia Modelo — instalação completa do banco no Supabase (gerado por src/scripts/pacote-sql.ts; não edite à mão).
-- Cole TUDO no Supabase → SQL Editor → Run, uma única vez, num banco vazio. Não contém dados de teste.
create table if not exists _migracoes (nome text primary key, aplicada_em timestamptz not null default now());

-- ===== 0001_inicial.sql =====
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

insert into _migracoes (nome) values ('0001_inicial.sql') on conflict do nothing;

-- ===== 0002_painel.sql =====
-- =====================================================================
-- Barbearia Modelo — painel da equipe (12/11)
--   • agenda do painel: marcar, encaixe, bloqueio, remarcar, cancelar, fechar, "Faltou"
--   • almoço 12h–13h travado para TODOS os caminhos (site e painel)
--   • pendência de falta (50%), paga junto no fechamento seguinte e 100% do profissional
--   • % da barbearia por profissional com histórico (só se acrescenta)
-- Tudo que mexe na agenda roda numa função com trava por barbeiro+dia; a exclusão em tstzrange segue como última garantia.
-- =====================================================================
begin;

-- ---------- ajustes em tabelas ----------
alter table agendamentos alter column cliente_telefone drop not null;        -- avulso/encaixe pode não ter telefone
alter table agendamentos add column versao integer not null default 1;
alter table agendamentos add column itens_cobrados jsonb;                   -- [{id,name,chargedPrice}] no fechamento
alter table agendamentos add column criado_por uuid references usuarios(id);

alter table clientes add column email text not null default '' check (length(email) <= 120);
alter table clientes add column aniversario text not null default '' check (length(aniversario) <= 10);
alter table clientes add column versao integer not null default 1;

-- % da barbearia por profissional, em pontos-base (2000 = 20%). Só se acrescenta: a vigente é a de maior vigente_desde.
create table percentuais_barbearia (
  id             uuid primary key default gen_random_uuid(),
  barbeiro_id    uuid not null references barbeiros(id),
  pct_bp         integer not null check (pct_bp between 0 and 10000),
  vigente_desde  date not null,
  criado_por     text not null default '',
  criado_em      timestamptz not null default now()
);
create index percentuais_barbeiro on percentuais_barbearia (barbeiro_id, vigente_desde);
create rule percentuais_sem_update as on update to percentuais_barbearia do instead nothing;
create rule percentuais_sem_delete as on delete to percentuais_barbearia do instead nothing;

-- pendência do cliente que faltou: 50% do valor agendado. Paga = entra 100% para o profissional que perdeu o horário.
create table pendencias (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references clientes(id),
  agendamento_id   uuid not null unique references agendamentos(id),     -- a falta que gerou
  barbeiro_id      uuid not null references barbeiros(id),
  valor_centavos   integer not null check (valor_centavos >= 0),
  status           text not null default 'aberta' check (status in ('aberta', 'paga', 'perdoada')),
  pago_em          timestamptz,
  forma_pagamento  text,
  pago_no          uuid references agendamentos(id),                     -- fechamento em que foi cobrada
  motivo           text,
  resolvido_por    uuid references usuarios(id),
  criado_em        timestamptz not null default now()
);
create index pendencias_cliente on pendencias (cliente_id) where status = 'aberta';

-- ---------- atendimentos no formato que o front usa ----------
-- kind 'service' = atendimento normal; 'no_show_fee' = pendência de falta paga (entra 100% para o profissional).
create view atendimentos_front as
  select a.id, a.barbeiro_id, b.nome as barber,
         to_char(a.data_hora_inicio at time zone c.fuso, 'YYYY-MM-DD') as day,
         to_char(a.data_hora_inicio at time zone c.fuso, 'HH24:MI') as time,
         (extract(epoch from a.data_hora_fim - a.data_hora_inicio) / 60)::int as duration,
         a.cliente_nome as name, coalesce(a.cliente_telefone, '') as phone, a.cliente_id as customer_id,
         coalesce((select json_agg(s.servico_id order by s.servico_id) from agendamento_servicos s where s.agendamento_id = a.id), '[]'::json)::text as services,
         coalesce(a.itens_cobrados::text, '') as service_items,
         a.valor_agendado_centavos as scheduled_amount,
         coalesce(a.valor_final_centavos, a.valor_agendado_centavos) as amount,
         a.desconto_centavos as discount,
         coalesce(a.forma_pagamento, '') as payment,
         to_char(a.pago_em at time zone c.fuso, 'YYYY-MM-DD') as paid_day,
         case a.status when 'confirmado' then 'booked' when 'concluido' then 'completed' when 'cancelado' then 'cancelled' else 'no_show' end as status,
         case a.origem when 'encaixe' then 'fitin' when 'avulso' then 'walkin' else 'scheduled' end as origin,
         a.observacoes as notes, a.criado_em as created_at, a.versao as version, 'service'::text as kind,
         coalesce((select sum(p.valor_centavos) from pendencias p where p.cliente_id = a.cliente_id and p.status = 'aberta'), 0)::int as debt,
         a.data_hora_inicio as inicio
    from agendamentos a join barbeiros b on b.id = a.barbeiro_id cross join configuracoes c
  union all
  select p.id, p.barbeiro_id, b.nome,
         to_char(p.pago_em at time zone c.fuso, 'YYYY-MM-DD'), to_char(p.pago_em at time zone c.fuso, 'HH24:MI'), 0,
         cl.nome || ' — pendência de falta', cl.telefone, p.cliente_id, '[]', '', p.valor_centavos, p.valor_centavos, 0,
         coalesce(p.forma_pagamento, ''), to_char(p.pago_em at time zone c.fuso, 'YYYY-MM-DD'), 'completed', 'walkin',
         'Pendência da falta de ' || to_char(f.data_hora_inicio at time zone c.fuso, 'DD/MM'), p.criado_em, 1, 'no_show_fee', 0, p.pago_em
    from pendencias p join barbeiros b on b.id = p.barbeiro_id join clientes cl on cl.id = p.cliente_id
    join agendamentos f on f.id = p.agendamento_id cross join configuracoes c
   where p.status = 'paga';

-- ---------- regras ----------
-- almoço do barbeiro (padrão 12h–13h para todos) colide com o intervalo? Vale em qualquer dia.
create function colide_almoco(p_barbeiro uuid, p_inicio timestamptz, p_fim timestamptz) returns boolean
language sql stable as $$
  select exists (
    select 1 from barbeiros b, configuracoes c,
           generate_series((p_inicio at time zone c.fuso)::date, (p_fim at time zone c.fuso)::date, interval '1 day') d
     where b.id = p_barbeiro
       and tstzrange(instante_local(d::date, b.almoco_inicio), instante_local(d::date, b.almoco_fim), '[)') && tstzrange(p_inicio, p_fim, '[)'))
$$;

create function trava_agenda(p_barbeiro uuid, p_dia date) returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended(p_barbeiro::text || p_dia::text, 0))
$$;

-- Marca pelo painel (dono ou barbeiro): agendamento, encaixe ou bloqueio. Pode ser fora do expediente (encaixe), nunca no almoço.
create function painel_agendar(
  p_usuario uuid, p_barbeiro uuid, p_dia date, p_hora time, p_servicos text[], p_nome text, p_telefone text,
  p_cliente uuid, p_obs text, p_chave text, p_bloqueio boolean, p_duracao integer)
returns uuid language plpgsql as $$
declare
  v_inicio timestamptz := instante_local(p_dia, p_hora);
  v_dur integer; v_valor integer; v_qtd integer; v_id uuid; v_cli uuid := p_cliente; v_nome text := trim(coalesce(p_nome, ''));
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if p_chave is not null then
    select id into v_id from agendamentos where chave_idempotencia = p_chave;
    if found then return v_id; end if;
  end if;
  if p_bloqueio then
    v_dur := p_duracao;
    if v_dur is null or v_dur < 5 or v_dur > 720 or v_dur % 5 <> 0 then raise exception 'Informe a duração do bloqueio em minutos (múltiplo de 5).' using errcode = 'P0001'; end if;
  else
    if coalesce(cardinality(p_servicos), 0) = 0 then raise exception 'Selecione pelo menos um serviço.' using errcode = 'P0001'; end if;
    select count(*), sum(duracao_minutos), sum(preco_centavos) into v_qtd, v_dur, v_valor from servicos where id = any (p_servicos) and ativo;
    if v_qtd <> cardinality(array(select distinct unnest(p_servicos))) then raise exception 'Algum serviço escolhido não está disponível.' using errcode = 'P0001'; end if;
    if v_cli is not null then
      select nome, telefone into v_nome, v_tel from clientes where id = v_cli and not arquivado;
      if not found then raise exception 'Cliente não encontrado.' using errcode = 'P0001'; end if;
    end if;
    if length(v_nome) < 2 then raise exception 'Informe o nome do cliente.' using errcode = 'P0001'; end if;
    if v_tel is not null and v_tel !~ '^\d{10,11}$' then raise exception 'Informe um telefone com DDD e 10 ou 11 dígitos.' using errcode = 'P0001'; end if;
  end if;

  perform trava_agenda(p_barbeiro, p_dia);
  if colide_almoco(p_barbeiro, v_inicio, v_inicio + make_interval(mins => v_dur)) then
    raise exception 'O horário de almoço (12h às 13h) fica bloqueado. Escolha outro horário.' using errcode = 'P0409';
  end if;
  if horario_ocupado(p_barbeiro, v_inicio, v_inicio + make_interval(mins => v_dur)) then
    raise exception 'Esse horário já está ocupado. Escolha outro.' using errcode = 'P0409';
  end if;

  if p_bloqueio then
    insert into bloqueios (barbeiro_id, data_hora_inicio, data_hora_fim, motivo, criado_por)
    values (p_barbeiro, v_inicio, v_inicio + make_interval(mins => v_dur), left(coalesce(nullif(trim(p_obs), ''), 'Horário indisponível'), 200), p_usuario)
    returning id into v_id;
    return v_id;
  end if;

  if v_cli is null and v_tel is not null then
    insert into clientes (nome, telefone) values (v_nome, v_tel)
    on conflict (telefone) do update set nome = clientes.nome      -- mantém o nome já cadastrado
    returning id into v_cli;
  end if;
  insert into agendamentos (barbeiro_id, cliente_id, cliente_nome, cliente_telefone, data_hora_inicio, data_hora_fim, origem,
                            valor_agendado_centavos, observacoes, chave_idempotencia, criado_por)
  values (p_barbeiro, v_cli, v_nome, v_tel, v_inicio, v_inicio + make_interval(mins => v_dur), 'agenda', v_valor,
          left(coalesce(p_obs, ''), 1000), p_chave, p_usuario)
  returning id into v_id;
  insert into agendamento_servicos (agendamento_id, servico_id, preco_centavos, duracao_minutos)
  select v_id, id, preco_centavos, duracao_minutos from servicos where id = any (p_servicos);
  return v_id;
exception when exclusion_violation then
  raise exception 'Esse horário já está ocupado. Escolha outro.' using errcode = 'P0409';
end $$;

-- Remarca mantendo a duração. O horário antigo só é liberado se o novo couber.
create function painel_remarcar(p_id uuid, p_versao integer, p_barbeiro uuid, p_dia date, p_hora time, p_usuario uuid)
returns void language plpgsql as $$
declare a agendamentos%rowtype; v_inicio timestamptz := instante_local(p_dia, p_hora); v_dur interval;
begin
  select * into a from agendamentos where id = p_id for update;
  if not found then raise exception 'Agendamento não encontrado.' using errcode = 'P0404'; end if;
  if a.status <> 'confirmado' then raise exception 'Só dá para remarcar um agendamento confirmado.' using errcode = 'P0001'; end if;
  if p_versao is not null and p_versao <> a.versao then raise exception 'Este agendamento foi alterado por outra pessoa. Atualize a agenda.' using errcode = 'P0409'; end if;
  v_dur := a.data_hora_fim - a.data_hora_inicio;
  perform trava_agenda(p_barbeiro, p_dia);
  if colide_almoco(p_barbeiro, v_inicio, v_inicio + v_dur) then
    raise exception 'O horário de almoço (12h às 13h) fica bloqueado. O agendamento original foi mantido.' using errcode = 'P0409';
  end if;
  if exists (select 1 from agendamentos x where x.barbeiro_id = p_barbeiro and x.id <> p_id and x.status in ('confirmado','concluido')
                and x.periodo && tstzrange(v_inicio, v_inicio + v_dur, '[)'))
     or exists (select 1 from bloqueios b where (b.barbeiro_id = p_barbeiro or b.barbeiro_id is null) and b.periodo && tstzrange(v_inicio, v_inicio + v_dur, '[)')) then
    raise exception 'Esse horário já está ocupado. O agendamento original foi mantido.' using errcode = 'P0409';
  end if;
  update agendamentos set barbeiro_id = p_barbeiro, data_hora_inicio = v_inicio, data_hora_fim = v_inicio + v_dur,
         versao = versao + 1, atualizado_em = now() where id = p_id;
  insert into auditoria (tabela, registro_id, acao, autor, antes, depois)
  values ('agendamentos', p_id::text, 'remarcar', p_usuario,
          jsonb_build_object('inicio', a.data_hora_inicio, 'barbeiro', a.barbeiro_id),
          jsonb_build_object('inicio', v_inicio, 'barbeiro', p_barbeiro));
exception when exclusion_violation then
  raise exception 'Esse horário já está ocupado. O agendamento original foi mantido.' using errcode = 'P0409';
end $$;

-- Fecha o atendimento: valores cobrados por serviço, desconto, pagamento. Opcionalmente cobra junto a pendência de falta do cliente.
create function painel_fechar(p_id uuid, p_versao integer, p_itens jsonb, p_desconto integer, p_pagamento text, p_obs text,
                              p_cobrar_pendencia boolean, p_usuario uuid, p_agora timestamptz)
returns void language plpgsql as $$
declare a agendamentos%rowtype; v_bruto integer; v_itens jsonb;
begin
  select * into a from agendamentos where id = p_id for update;
  if not found then raise exception 'Agendamento não encontrado.' using errcode = 'P0404'; end if;
  if a.status = 'concluido' then return; end if;                       -- duplo toque: já fechado
  if a.status <> 'confirmado' then raise exception 'Este agendamento não pode ser concluído.' using errcode = 'P0001'; end if;
  if p_versao is not null and p_versao <> a.versao then raise exception 'Este agendamento foi alterado por outra pessoa. Atualize a agenda.' using errcode = 'P0409'; end if;
  if coalesce(p_pagamento, '') not in ('Dinheiro', 'Pix', 'Débito', 'Crédito', 'Cartão de débito', 'Cartão de crédito', 'Cartão', 'Pendente') then
    raise exception 'Escolha a forma de pagamento.' using errcode = 'P0001';
  end if;
  -- só os serviços do agendamento, com o valor cobrado de cada um
  select coalesce(sum((i->>'amount')::int), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', s.servico_id, 'name', sv.nome, 'chargedPrice', (i->>'amount')::int)), '[]'::jsonb)
    into v_bruto, v_itens
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
    join agendamento_servicos s on s.agendamento_id = p_id and s.servico_id = i->>'id'
    join servicos sv on sv.id = s.servico_id;
  if jsonb_array_length(v_itens) = 0 then raise exception 'Informe o valor cobrado de cada serviço.' using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements(p_itens) i where (i->>'amount')::int < 0 or (i->>'amount')::int > 1000000) then
    raise exception 'Valor cobrado inválido.' using errcode = 'P0001';
  end if;
  if p_desconto < 0 or p_desconto > v_bruto then raise exception 'O desconto não pode ser maior que o valor cobrado.' using errcode = 'P0001'; end if;

  update agendamentos set status = 'concluido', itens_cobrados = v_itens, valor_final_centavos = v_bruto - p_desconto,
         desconto_centavos = greatest(0, valor_agendado_centavos - (v_bruto - p_desconto)),
         forma_pagamento = p_pagamento, pago_em = case when p_pagamento = 'Pendente' then null else p_agora end,
         observacoes = coalesce(nullif(left(p_obs, 1000), ''), observacoes), versao = versao + 1, atualizado_em = now()
   where id = p_id;
  if p_cobrar_pendencia and a.cliente_id is not null and p_pagamento <> 'Pendente' then
    update pendencias set status = 'paga', pago_em = p_agora, forma_pagamento = p_pagamento, pago_no = p_id, resolvido_por = p_usuario
     where cliente_id = a.cliente_id and status = 'aberta';
  end if;
  insert into auditoria (tabela, registro_id, acao, autor, depois)
  values ('agendamentos', p_id::text, 'concluir', p_usuario, jsonb_build_object('final', v_bruto - p_desconto, 'pagamento', p_pagamento, 'itens', v_itens));
end $$;

-- "Faltou": só depois de 15 min de tolerância. Libera o horário e gera pendência de 50% do valor agendado.
create function painel_faltou(p_id uuid, p_versao integer, p_usuario uuid, p_agora timestamptz)
returns integer language plpgsql as $$
declare a agendamentos%rowtype; v_valor integer;
begin
  select * into a from agendamentos where id = p_id for update;
  if not found then raise exception 'Agendamento não encontrado.' using errcode = 'P0404'; end if;
  if a.status = 'faltou' then return 0; end if;
  if a.status <> 'confirmado' then raise exception 'Só dá para marcar falta em um agendamento confirmado.' using errcode = 'P0001'; end if;
  if p_versao is not null and p_versao <> a.versao then raise exception 'Este agendamento foi alterado por outra pessoa. Atualize a agenda.' using errcode = 'P0409'; end if;
  if p_agora < a.data_hora_inicio + interval '15 minutes' then
    raise exception 'A falta só pode ser marcada depois de 15 minutos de tolerância (a partir das %).',
      to_char((a.data_hora_inicio + interval '15 minutes') at time zone (select fuso from configuracoes), 'HH24:MI') using errcode = 'P0001';
  end if;
  update agendamentos set status = 'faltou', versao = versao + 1, atualizado_em = now() where id = p_id;
  v_valor := round(a.valor_agendado_centavos * 0.5);
  if a.cliente_id is not null and v_valor > 0 then
    insert into pendencias (cliente_id, agendamento_id, barbeiro_id, valor_centavos) values (a.cliente_id, p_id, a.barbeiro_id, v_valor);
  end if;
  insert into auditoria (tabela, registro_id, acao, autor, depois)
  values ('agendamentos', p_id::text, 'faltou', p_usuario, jsonb_build_object('pendencia', case when a.cliente_id is null then 0 else v_valor end));
  return case when a.cliente_id is null then 0 else v_valor end;
end $$;

-- Atendimento sem agendamento (avulso/encaixe já feito): registra concluído na hora. Não pode cair no almoço nem em cima de outro.
create function painel_avulso(p_usuario uuid, p_barbeiro uuid, p_dia date, p_hora time, p_servicos text[], p_nome text,
                              p_valor integer, p_desconto integer, p_pagamento text, p_origem text, p_obs text, p_chave text, p_agora timestamptz)
returns uuid language plpgsql as $$
declare v_dur integer; v_preco integer; v_qtd integer; v_id uuid; v_inicio timestamptz := instante_local(p_dia, p_hora);
begin
  if p_chave is not null then
    select id into v_id from agendamentos where chave_idempotencia = p_chave;
    if found then return v_id; end if;
  end if;
  if coalesce(cardinality(p_servicos), 0) = 0 then raise exception 'Selecione pelo menos um serviço.' using errcode = 'P0001'; end if;
  select count(*), sum(duracao_minutos), sum(preco_centavos) into v_qtd, v_dur, v_preco from servicos where id = any (p_servicos) and ativo;
  if v_qtd <> cardinality(array(select distinct unnest(p_servicos))) then raise exception 'Algum serviço escolhido não está disponível.' using errcode = 'P0001'; end if;
  if p_valor < 0 or p_valor > 1000000 or p_desconto < 0 then raise exception 'Valor inválido.' using errcode = 'P0001'; end if;
  if coalesce(p_pagamento, '') not in ('Dinheiro', 'Pix', 'Débito', 'Crédito', 'Cartão de débito', 'Cartão de crédito', 'Cartão', 'Pendente') then raise exception 'Escolha a forma de pagamento.' using errcode = 'P0001'; end if;
  perform trava_agenda(p_barbeiro, p_dia);
  if colide_almoco(p_barbeiro, v_inicio, v_inicio + make_interval(mins => v_dur)) then
    raise exception 'O horário de almoço (12h às 13h) fica bloqueado. Ajuste o horário do atendimento.' using errcode = 'P0409';
  end if;
  if horario_ocupado(p_barbeiro, v_inicio, v_inicio + make_interval(mins => v_dur)) then
    raise exception 'Já existe um atendimento nesse horário para este profissional. Ajuste o horário.' using errcode = 'P0409';
  end if;
  insert into agendamentos (barbeiro_id, cliente_nome, data_hora_inicio, data_hora_fim, status, origem, valor_agendado_centavos,
                            desconto_centavos, valor_final_centavos, forma_pagamento, pago_em, observacoes, chave_idempotencia, criado_por, itens_cobrados)
  values (p_barbeiro, coalesce(nullif(trim(p_nome), ''), 'Cliente avulso'), v_inicio, v_inicio + make_interval(mins => v_dur), 'concluido',
          case when p_origem = 'fitin' then 'encaixe' else 'avulso' end::origem_agendamento, v_preco, greatest(0, v_preco - p_valor), p_valor,
          p_pagamento, case when p_pagamento = 'Pendente' then null else p_agora end, left(coalesce(p_obs, ''), 1000), p_chave, p_usuario, null)
  returning id into v_id;
  insert into agendamento_servicos (agendamento_id, servico_id, preco_centavos, duracao_minutos)
  select v_id, id, preco_centavos, duracao_minutos from servicos where id = any (p_servicos);
  return v_id;
exception when exclusion_violation then
  raise exception 'Já existe um atendimento nesse horário para este profissional. Ajuste o horário.' using errcode = 'P0409';
end $$;

commit;

insert into _migracoes (nome) values ('0002_painel.sql') on conflict do nothing;

-- ===== seed.sql (serviços, profissionais, horários, % da barbearia) =====
-- Dados iniciais da Barbearia Modelo (idempotente). Senhas NÃO ficam aqui: o dono define no 1º acesso (npm run usuario).
begin;
insert into configuracoes (id) values (true) on conflict (id) do nothing;

insert into horarios_funcionamento (dia_semana, abre, fecha) values
  (2,'09:00','19:00'),(3,'09:00','19:00'),(4,'09:00','19:00'),(5,'09:00','19:00'),(6,'09:00','19:00')   -- terça a sábado
on conflict (dia_semana) do update set abre = excluded.abre, fecha = excluded.fecha;

insert into barbeiros (nome, whatsapp, ordem) values
  ('Rafael','21900000001',1),('Lucas','21900000003',2),('Bruno','21900000002',3)
on conflict (nome) do update set whatsapp = excluded.whatsapp, ordem = excluded.ordem;

insert into servicos (id, nome, preco_centavos, duracao_minutos, ordem) values
  ('corte_maquina','Corte máquina',3000,30,1),
  ('corte_tesoura','Corte com tesoura',4000,40,2),
  ('barba','Barba',2000,10,3),
  ('cavanhaque','Cavanhaque',1000,5,4),
  ('pe_cabelo','Pé de cabelo',1000,10,5),
  ('sobrancelha','Sobrancelha',500,5,6),
  ('pigmentacao_cabelo','Pigmentação cabelo',1500,10,7),
  ('pigmentacao_barba','Pigmentação barba & cavanhaque',1000,5,8),
  ('platinado','Platinado',6000,120,9),
  ('luzes','Luzes',5000,120,10)
on conflict (id) do update set nome = excluded.nome, preco_centavos = excluded.preco_centavos, duracao_minutos = excluded.duracao_minutos, ordem = excluded.ordem;

-- % da barbearia por profissional (valores de exemplo): Rafael 30%, Bruno 40%, Lucas 50% — só na 1ª vez
insert into percentuais_barbearia (barbeiro_id, pct_bp, vigente_desde, criado_por)
select b.id, v.bp, date '2000-01-01', 'Valor de exemplo'
  from (values ('Rafael', 3000), ('Bruno', 4000), ('Lucas', 5000)) v(nome, bp) join barbeiros b on b.nome = v.nome
 where not exists (select 1 from percentuais_barbearia p where p.barbeiro_id = b.id);
commit;


-- ===== supabase.sql (fecha a API REST pública do Supabase) =====
-- Só para quem hospedar o banco no Supabase.
-- O Supabase expõe as tabelas pela API REST pública (chave "anon" vai no navegador). Como este sistema
-- acessa o banco SOMENTE pelo servidor Node (DATABASE_URL), ligamos o RLS em tudo e não criamos política
-- para "anon"/"authenticated": a API REST do Supabase fica sem acesso a nenhuma linha. O servidor usa a
-- conexão do dono do banco (role postgres), que ignora RLS.
alter table barbeiros               enable row level security;
alter table servicos                enable row level security;
alter table horarios_funcionamento  enable row level security;
alter table configuracoes           enable row level security;
alter table clientes                enable row level security;
alter table agendamentos            enable row level security;
alter table agendamento_servicos    enable row level security;
alter table bloqueios               enable row level security;
alter table usuarios                enable row level security;
alter table sessoes                 enable row level security;
alter table auditoria               enable row level security;
revoke execute on function criar_agendamento_site(text, date, time, text[], text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function agenda_periodo(date, date, uuid) from public, anon, authenticated;

-- 0002 (painel, 12/11): novas tabelas e a view também ficam fora da API REST do Supabase.
-- IMPORTANTE: a view atendimentos_front roda com os direitos do dono do banco e ignoraria o RLS — por isso o revoke explícito.
alter table percentuais_barbearia   enable row level security;
alter table pendencias              enable row level security;
alter table _migracoes              enable row level security;
revoke all on atendimentos_front from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
