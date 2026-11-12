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
