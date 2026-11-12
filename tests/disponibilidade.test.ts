import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colide, horarioLivre, horariosLivres, paraMinutos as m, paraHora } from '../src/domain/disponibilidade.ts';

const regras = { abre: m('09:00'), fecha: m('19:00'), almoco: { inicio: m('12:00'), fim: m('13:00') }, passo: 10 };

test('intervalos que só se encostam não colidem', () => {
  assert.equal(colide({ inicio: 600, fim: 640 }, { inicio: 640, fim: 680 }), false);
  assert.equal(colide({ inicio: 600, fim: 641 }, { inicio: 640, fim: 680 }), true);
  assert.equal(colide({ inicio: 600, fim: 700 }, { inicio: 620, fim: 630 }), true); // contido
});
test('horário pedido contra agendamentos e bloqueios', () => {
  const ocupados = [{ inicio: m('10:00'), fim: m('10:40') }, { inicio: m('15:00'), fim: m('16:00') }];
  assert.equal(horarioLivre({ inicio: m('09:20'), fim: m('10:00') }, ocupados), true);
  assert.equal(horarioLivre({ inicio: m('09:30'), fim: m('10:10') }, ocupados), false);
  assert.equal(horarioLivre({ inicio: m('15:30'), fim: m('15:40') }, ocupados), false);
  assert.equal(horarioLivre({ inicio: m('10:00'), fim: m('10:00') }, []), false); // duração zero é inválida
});
test('grade do site: termina até 19h, pula almoço e respeita antecedência', () => {
  const livres = horariosLivres(40, regras, []).map(paraHora);
  assert.equal(livres[0], '09:00');
  assert.equal(livres.at(-1), '18:20');
  assert.ok(livres.includes('11:20') && !livres.includes('11:30') && !livres.includes('12:50') && livres.includes('13:00'));
  assert.equal(horariosLivres(40, { ...regras, minimoInicio: m('10:25') }, []).map(paraHora)[0], '10:30');
  assert.deepEqual(horariosLivres(600, regras, []), []);
});
