// Divisão entre barbearia e profissional. Regras puras, sem acesso a tela ou rede.
// Valores em centavos (inteiros); percentual da barbearia em pontos percentuais (0–100).
// A comissão incide sempre sobre o VALOR FINAL do atendimento (já com descontos).
// Produtos (geladeira etc.) não passam por aqui: o dinheiro é 100% da barbearia.

/** % da barbearia vigente para o profissional num dia (histórico: vence a vigência mais recente; empate = lançamento mais novo). */
export function percentAt(history, barber, day) {
  let percent = 0, from = '';
  for (const r of history || []) {
    if (r.barber === barber && r.effective_from <= day && r.effective_from >= from) { from = r.effective_from; percent = Number(r.percent); }
  }
  return percent;
}

/** Valor original, desconto, valor final e divisão de um atendimento. */
export function splitOf(a, history) {
  const final = a.amount;
  const original = a.scheduled_amount ?? final + (a.discount || 0);
  // Pendência de falta paga (kind 'no_show_fee'): fica inteira com o profissional que perdeu o horário — regra do cliente (12/11)
  const percent = a.kind === 'no_show_fee' ? 0 : percentAt(history, a.barber, a.paid_day || a.day);
  const house = Math.round(final * percent / 100);
  return { original, discount: Math.max(0, original - final), final, percent, house, barber: final - house };
}

/** Soma a divisão de vários atendimentos. */
export function totals(list, history) {
  return list.reduce((t, a) => {
    const s = splitOf(a, history);
    t.original += s.original; t.discount += s.discount; t.final += s.final; t.house += s.house; t.barber += s.barber; t.count += 1;
    return t;
  }, { original: 0, discount: 0, final: 0, house: 0, barber: 0, count: 0 });
}

// ---- Produtos ----
// group 'fridge' (doces/bebidas da geladeira): sem comissão; o valor volta para reinvestimento em produtos da geladeira.
// group 'general' (pomada, gel e afins): o barbeiro que vendeu recebe `commission` % do valor vendido do item.
// A comissão fica "congelada" no item da venda, para alterar o cadastro depois não reescrever vendas passadas.
export const itemTotal = i => i.price * i.quantity;
export const itemCommission = i => i.group === 'general' ? Math.round(itemTotal(i) * (Number(i.commission) || 0) / 100) : 0;

/** Soma vendas de produtos (ignorar canceladas antes de chamar). */
export function productTotals(sales) {
  const t = { fridge: 0, general: 0, commission: 0, house: 0, units: 0 };
  for (const sale of sales) for (const i of sale.items) {
    if (i.group === 'general') { t.general += itemTotal(i); t.commission += itemCommission(i); } else t.fridge += itemTotal(i);
    t.units += i.quantity;
  }
  t.house = t.general - t.commission; // parte da barbearia nos produtos em geral
  return t;
}
