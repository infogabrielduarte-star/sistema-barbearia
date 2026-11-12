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
