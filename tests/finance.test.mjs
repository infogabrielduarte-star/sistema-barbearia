// Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { percentAt, splitOf, totals } from '../public/finance.js';

const hist = [
  { barber: 'Bruno', percent: 50, effective_from: '2000-01-01' },
  { barber: 'Bruno', percent: 40, effective_from: '2026-11-10' },
  { barber: 'Lucas', percent: 30, effective_from: '2000-01-01' },
];

test('corte e barba R$ 50,00 a 50/50 → R$ 25,00 e R$ 25,00', () => {
  const s = splitOf({ barber: 'Lucas', amount: 5000, scheduled_amount: 5000, discount: 0, day: '2026-11-05' }, [{ barber: 'Lucas', percent: 50, effective_from: '2000-01-01' }]);
  assert.equal(s.house, 2500); assert.equal(s.barber, 2500);
});
test('corte R$ 30,00 com 10% de desconto (R$ 27,00) → R$ 13,50 e R$ 13,50', () => {
  const s = splitOf({ barber: 'Lucas', amount: 2700, scheduled_amount: 3000, discount: 300, day: '2026-11-05' }, [{ barber: 'Lucas', percent: 50, effective_from: '2000-01-01' }]);
  assert.deepEqual([s.original, s.discount, s.final, s.house, s.barber], [3000, 300, 2700, 1350, 1350]);
});
test('a soma sempre fecha em centavos (sem perder nem criar dinheiro)', () => {
  const s = splitOf({ barber: 'Lucas', amount: 3333, day: '2026-11-05' }, hist);
  assert.equal(s.house + s.barber, 3333);
});
test('mudança de % vale só a partir da data de vigência', () => {
  assert.equal(percentAt(hist, 'Bruno', '2026-11-09'), 50);
  assert.equal(percentAt(hist, 'Bruno', '2026-11-10'), 40);
  assert.equal(percentAt(hist, 'Bruno', '2026-12-01'), 40);
});
test('profissional sem % configurada → 0% (tudo do profissional)', () => {
  assert.equal(percentAt(hist, 'Rafael', '2026-11-11'), 0);
});
test('totais somam original, desconto, final e divisão', () => {
  const t = totals([
    { barber: 'Lucas', amount: 2700, scheduled_amount: 3000, discount: 300, day: '2026-11-05' },
    { barber: 'Lucas', amount: 2000, scheduled_amount: 2000, discount: 0, day: '2026-11-05' },
  ], hist);
  assert.deepEqual([t.original, t.discount, t.final, t.house, t.barber, t.count], [5000, 300, 4700, 1410, 3290, 2]);
});

import { itemCommission, productTotals } from '../public/finance.js';
const venda = (items) => ({ items });
test('pomada R$ 35,00 com 20% → comissão R$ 7,00 por unidade', () => {
  assert.equal(itemCommission({ group: 'general', price: 3500, quantity: 1, commission: 20 }), 700);
  assert.equal(itemCommission({ group: 'general', price: 3500, quantity: 2, commission: 20 }), 1400);
});
test('doce da geladeira nunca gera comissão, mesmo com % preenchida', () => {
  assert.equal(itemCommission({ group: 'fridge', price: 600, quantity: 3, commission: 50 }), 0);
  assert.equal(itemCommission({ price: 600, quantity: 3, commission: 50 }), 0); // venda antiga sem grupo = geladeira
});
test('totais de produtos separam geladeira (reinvestimento) de produtos em geral', () => {
  const t = productTotals([
    venda([{ group: 'fridge', price: 600, quantity: 2 }, { group: 'general', price: 3500, quantity: 1, commission: 20 }]),
    venda([{ group: 'general', price: 2500, quantity: 2, commission: 10 }]),
  ]);
  assert.deepEqual([t.fridge, t.general, t.commission, t.house, t.units], [1200, 8500, 700 + 500, 8500 - 1200, 5]);
});

test('pendência de falta paga fica 100% com o profissional (12/11)', () => {
  const h = [{ barber: 'Bruno', percent: 30, effective_from: '2000-01-01' }];
  const s = splitOf({ barber: 'Bruno', kind: 'no_show_fee', amount: 2000, day: '2026-11-12', paid_day: '2026-11-12' }, h);
  assert.equal(s.house, 0); assert.equal(s.barber, 2000); assert.equal(s.percent, 0);
  const n = splitOf({ barber: 'Bruno', amount: 3000, day: '2026-11-12', paid_day: '2026-11-12' }, h);
  assert.equal(n.house, 900); assert.equal(n.barber, 2100);
});
