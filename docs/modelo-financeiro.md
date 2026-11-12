# Modelo financeiro — divisão barbearia × profissional

Regras do cliente (11/11/2026): % da barbearia por profissional; incide só sobre serviços na cadeira, sobre o **valor final** (desconto antes); produtos ficam 100% com a barbearia.

## Fonte única
Nada de tabela paralela. Todo serviço (agendado, encaixe, avulso) é uma linha de `attendances`:

| Campo | Papel |
|---|---|
| `scheduled_amount` | valor original (cheio) |
| `discount` | desconto adicional informado no fechamento |
| `amount` | **valor final** — base da divisão |
| `barber`, `day`, `paid_day`, `origin`, `payment` | quem, quando, de onde veio |
| `service_items` | valor cobrado por procedimento (controle por procedimento) |

A divisão **não é gravada**: é calculada por `splitOf(atendimento, histórico)` (`public/finance.js`; portar para `src/domain/` no backend, com os mesmos testes). Assim mudar uma regra não deixa dado inconsistente.

## Histórico de porcentagens (`barber_rates`)
`id, barber_id, percent_bp (integer, 0–10000), effective_from (date), created_by, created_at`. Só inserções. % vigente = linha com maior `effective_from ≤ data do recebimento` (empate: a mais nova). Sem linha → 0%.

## Cálculo
`house = round(final × percent / 100)`; `profissional = final − house`. Exemplos nos testes (`tests/finance.test.mjs`).

## Painel do dono
- Financeiro: parte da barbearia, parte dos profissionais, venda de produtos, resultado (serviços + produtos − despesas), cards por profissional, controle diário.
- Equipe: histórico de porcentagens.
- Atendimentos: divisão sob o valor de cada linha.

## Evolução prevista (sem refazer)
- % por serviço: adicionar `service_id` (nulo = padrão) em `barber_rates` e passar o serviço a `percentAt`.
- Taxa da maquininha: campo por forma de pagamento aplicado a `final` antes de dividir.
- Repasse/acerto: tabela `settlements` ligada ao período e ao profissional, com status.
- Barbeiro ver a própria %: expor `rateHistory` filtrado em `GET team/data`.

## Produtos (regras de 11/11)
- `products.group`: `fridge` | `general`; `products.commission_bp` (só `general`).
- `sale_items` guarda `price`, `cost`, `group`, `commission_bp` do momento da venda. Comissão = `round(preço × qtd × % / 100)` para `general`; zero para `fridge`.
- Geladeira não entra no resultado da barbearia: é mostrada como valor a reinvestir. Resultado = parte nos serviços + produtos em geral (após comissão) − despesas.
- Comissão de produto é do barbeiro da venda (`sales.barber`), separada da divisão de serviços.
