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
