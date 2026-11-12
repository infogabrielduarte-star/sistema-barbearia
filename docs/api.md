# API — contratos implementados no servidor real (`src/`)

Todas as respostas são JSON. Erro: `{ "error": "mensagem em português" }` com status 400, 401, 403, 404, 409, 413, 415, 429 ou 500.
POST exige `Content-Type: application/json`. Sessão por cookie `sessao_barbearia` (httpOnly).

| Rota | Acesso | Entrada | Resposta |
|---|---|---|---|
| `GET /api/catalog` | público | — | `{services:{id:{name,price,duration}}, barbers:[{name,whatsapp}]}` (preço em centavos) |
| `GET /api/availability` | público | `?day=AAAA-MM-DD&barber=Nome&duration=min` | `{times:["09:00",…]}` — só horários que cabem no funcionamento, fora do almoço, com 20 min de antecedência, sem colisão |
| `POST /api/book` | público | `{name, phone, barber, day, time, services:[ids], requestKey?}` | `{id, duration, amount, token, barber, whatsapp, start}` · 409 se o horário foi ocupado |
| `POST /api/staff/login` | público | `{username, password}` | `{ok, role:"owner"|"barber", barber}` + cookie · 401/403/429 |
| `POST /api/staff/logout` | sessão | `{}` | `{ok:true}` |
| `GET /api/team/session` | — | — | `{authenticated, role?, barber?}` |
| `GET /api/owner-session` | — | — | `{authenticated, authorized}` |
| `GET /api/calendar/day` | sessão | `?day=` | `{barbers:[…], appointments:[{id,barber,day,time,duration,name,phone,services,amount,status,origin,notes}]}` — dono vê todos; barbeiro só a própria; bloqueios vêm com `status:"blocked"` |
| `GET /api/calendar/week` | sessão | `?start=AAAA-MM-DD` | igual ao dia, para 7 dias, com `start` e `end` |
| `POST /api/calendar/book` | sessão | `{requestKey, customerId?, name, phone?, barber?, services, day, time, notes?, blocked?, duration?}` | `{ok, id}` · barbeiro marca só para si (o `barber` do corpo é ignorado); `blocked:true` cria bloqueio · 409 se ocupado ou no almoço |
| `POST /api/calendar/reschedule` | sessão (dono ou o próprio) | `{id, version, day, time, barber?}` | `{ok}` · mantém a duração; 409 se ocupado/almoço/versão velha |
| `POST /api/calendar/cancel` | sessão (dono ou o próprio) | `{id, version}` | `{ok}` · agendamento fica `cancelado` (registro mantido); bloqueio é liberado; almoço não pode ser liberado |
| `POST /api/calendar/close` | sessão (dono ou o próprio) | `{id, version, items:[{id, amount}], discount, payment, notes, chargeDebt?}` | `{ok}` · idempotente; `chargeDebt` cobra junto as pendências de falta do cliente |
| `POST /api/calendar/no-show` | sessão (dono ou o próprio) | `{id, version}` | `{ok, debt}` · só 15 min após o início; libera o horário e gera pendência de 50% |
| `GET /api/calendar/clients` | sessão | — | `{clients:[{id,name,phone,email,birthday,notes,version,debt}]}` |
| `POST /api/calendar/client` | sessão | `{id?, version?, name, phone, email?, birthday?, notes?}` | `{ok, id}` |
| `POST /api/calendar/archive-client` | sessão | `{id}` | `{ok}` (arquiva, não apaga) |
| `GET /api/team/data` | sessão | `?month=AAAA-MM` | `{barber, appointments, notes:[], products:[], sales:[]}` — só os do próprio barbeiro |
| `POST /api/team/attendance` | sessão | `{requestKey, services, amount, discount, payment, name?, day, time, barber?, origin?, notes?}` | `{ok, id}` · atendimento sem agendamento já concluído |
| `POST /api/status` | dono | `{id, status:"cancelled"}` | `{ok}` · estorno (registro mantido, com auditoria) |
| `GET /api/admin` | dono | `?month=AAAA-MM` | `{appointments, todayAppointments, pendingAppointments, accounts, rateHistory, serviceSettings, weekRevenue, weekStart, weekEnd, weekTitle, previousRevenue, previousLabel, sales:[], products:[], expenses:[], notes:[]}` |
| `POST /api/manage/edit-attendance` | dono | `{id, version, name, barber, amount, discount, payment, reason}` | `{ok}` · motivo obrigatório; auditoria |
| `GET /api/manage/history` | dono | `?id=` | `{entries:[{event, actor, created_at, detail}]}` |
| `POST /api/manage/rate` | dono | `{barber, percent, effectiveFrom}` | `{ok}` · nova % da barbearia (histórico só cresce) |
| `POST /api/manage/service` | dono | `{id, name, price, duration, active}` | `{ok}` |
| `POST /api/manage/account` | dono | `{barber, username, password}` | `{ok}` · usuário `[a-z0-9._-]{3,40}`, senha ≥ 12; redefinir encerra as sessões dele |
| `POST /api/manage/account-state` | dono | `{id, active}` | `{ok}` · bloquear encerra as sessões; o dono não se bloqueia |
| produtos, vendas, estoque, despesas, recados | — | — | `501` "ainda será ativada" (próxima etapa) |

Status no front: `booked` (confirmado), `completed`, `cancelled`, `no_show` (faltou), `blocked` (bloqueio ou almoço; o almoço vem com id `almoco:…`). Origem: `scheduled`, `fitin` (encaixe), `walkin` (avulso). `kind`: `service` ou `no_show_fee` (pendência de falta paga, 100% do profissional). `debt`: pendência de falta em aberto do cliente.
Ainda só na demonstração (`docs/demo/preview-mock.js`): produtos, vendas, estoque, despesas e recados.
