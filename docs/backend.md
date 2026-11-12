# Back-end — Barbearia Modelo

Servidor Node 22 (TypeScript executado direto pelo Node, sem compilação) + PostgreSQL.
Entrega o site (`public/`) e a API (`/api/*`) no mesmo endereço. Única dependência de produção: `pg`.

## Arquitetura
```
public/                      site + painéis (já existentes) — chamam /api/*
src/servidor.ts              HTTP (node:http): estáticos, roteamento, cookies, CSRF, erros → {error}
src/rotas/publico.ts         catalog · availability · book
src/rotas/equipe.ts          staff/login · staff/logout · team/session · owner-session · calendar/day · calendar/week
src/validacao.ts             validação de entrada (mensagens em português)
src/domain/disponibilidade.ts regra pura de colisão/horários livres (espelho da função SQL; testada)
src/auth/senha.ts, sessao.ts scrypt + sessões revogáveis (cookie httpOnly, SameSite=Lax, Secure em produção)
src/db/index.ts              driver pg (produção) · src/db/psql.ts (dev/testes sem pacotes)
db/migrations/0001_inicial.sql  tabelas, constraint anti-overbooking, funções de agenda
db/seed.sql                  barbeiros, serviços, horário de funcionamento
db/supabase.sql              (opcional) fecha a API REST pública do Supabase
```

## Como o sistema impede agendamento duplo (3 camadas)
1. **Banco (definitivo):** `agendamentos_sem_sobreposicao` — `EXCLUDE USING gist (barbeiro_id WITH =, periodo WITH &&)` para status confirmado/concluído. Nenhum caminho (site, painel, SQL manual) consegue gravar dois horários sobrepostos para o mesmo barbeiro, mesmo com acessos simultâneos.
2. **Transação com trava:** `criar_agendamento_site` trava o barbeiro+dia (`pg_advisory_xact_lock`), confere de novo se o horário está livre (agendamentos, bloqueios, almoço, funcionamento, antecedência) e só então grava. Bloqueios ficam em outra tabela, por isso a checagem cruzada é feita aqui.
3. **Interface:** só mostra horários devolvidos por `horarios_disponiveis`; se outro cliente pegou antes, recebe 409 com mensagem e a lista é atualizada.

Testado: 6 reservas simultâneas no mesmo horário → 1 confirmada, 5 recusadas (`tests/api.test.ts`).

## Rodar localmente
```bash
npm install                                   # instala pg (+ tipos para typecheck)
cp .env.example .env                          # ajuste DATABASE_URL
npm run db:migrate && npm run db:seed
npm run usuario -- --barbeiro "Rafael" --usuario dono --papel owner   # pede a senha (≥ 12)
npm run usuario -- --barbeiro "Bruno"  --usuario bruno       --papel barber
npm run dev                                   # http://localhost:3000
```
Sem instalar nada (só com `psql` na máquina): `DB_DRIVER=psql DATABASE_URL="host=... dbname=..." node src/servidor.ts`.

## Testes
```bash
TEST_DATABASE_URL="host=/var/run/postgresql user=postgres" npm test   # cria e apaga um banco temporário
npm run typecheck
```

## Colocar no ar (Hostinger + Supabase) — começa ZERADO
Passo a passo completo em `docs/deploy-hostinger.md`. Resumo:
1. **Supabase:** criar o projeto → SQL Editor → colar e rodar `db/instalar-supabase.sql` (gerado por `node src/scripts/pacote-sql.ts`; tem as migrações, os dados iniciais e o fechamento da API REST). Sem dados de teste.
2. **Hostinger** (Business/Cloud → Sites → Adicionar site → Node.js App): enviar o zip do projeto (sem `node_modules`, `preview`, `tests` e `docs`), Node **24.x** (ou 22.18+), comando de início `npm start`, variáveis `DATABASE_URL` (Supabase → Connect → **Session pooler**, porta 5432 — a conexão direta é só IPv6), `NODE_ENV=production`, `CODIGO_PRIMEIRO_ACESSO` (≥ 12 caracteres).
3. Abrir `https://SEU-DOMINIO/primeiro-acesso.html`, informar o código e criar o login do Rafael (senha ≥ 12). A página se desliga sozinha depois.
4. Rafael entra em **Área dos barbeiros → Equipe e acessos** e cria `bruno` e `lucas`.

## O que já funciona no servidor real (12/11)
- Site: catálogo, horários livres, agendamento (sem sobreposição, almoço 12h–13h travado, 20 min de antecedência).
- Painel: agenda do dia/semana com almoço travado; marcar, encaixe, bloqueio, remarcar, cancelar, fechar (com valor por serviço, desconto e pagamento), **"Cliente faltou"** (após 15 min; pendência de 50% cobrada no próximo fechamento e creditada 100% ao profissional), clientes, atendimento avulso, área do barbeiro (`team/data`), gestão (`admin`: arrecadação, divisão por %, extrato), correção de atendimento com motivo e histórico, estorno, % por profissional, serviços e preços, logins (criar, redefinir, bloquear).
- Regras de agenda em funções SQL (`db/migrations/0002_painel.sql`): `painel_agendar`, `painel_remarcar`, `painel_fechar`, `painel_faltou`, `painel_avulso`, todas com trava por barbeiro+dia; a view `atendimentos_front` entrega os registros no formato do front.
- Testes: `tests/api.test.ts` (site, login) e `tests/painel.test.ts` (painel) contra PostgreSQL real.

## O que ainda falta
Produtos/vendas/estoque (o cliente vai começar a investir depois), despesas, recados/pendências internas e o link do cliente para cancelar/remarcar. Essas rotas respondem 501 "ainda será ativada".
