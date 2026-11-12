// Regra pura de disponibilidade (sem banco), espelho da função SQL horarios_disponiveis.
// Serve para testes, para o painel pré-validar um encaixe e como documentação viva da regra.
// O banco continua sendo a autoridade final (constraint de exclusão + trava por barbeiro/dia).

/** Intervalo em minutos desde 00:00 do dia: [inicio, fim) — fim não incluso. */
export type Intervalo = { inicio: number; fim: number };

/** Dois intervalos colidem se um começa antes do outro terminar (bordas que só se encostam NÃO colidem). */
export const colide = (a: Intervalo, b: Intervalo): boolean => a.inicio < b.fim && b.inicio < a.fim;

/** O horário pedido colide com algum agendamento ativo ou bloqueio? */
export function horarioLivre(pedido: Intervalo, ocupados: readonly Intervalo[]): boolean {
  if (!(pedido.fim > pedido.inicio)) return false;
  return !ocupados.some(o => colide(pedido, o));
}

export type RegrasDia = {
  abre: number;            // minutos (ex.: 9h = 540)
  fecha: number;           // minutos (ex.: 19h = 1140) — o atendimento precisa TERMINAR até aqui
  almoco: Intervalo;       // ex.: 12h–13h
  passo: number;           // inícios oferecidos no site (10 min)
  minimoInicio?: number;   // hoje: agora + antecedência (20 min); dias futuros: omitido
};

/** Inícios livres (em minutos) para um atendimento de `duracao` minutos. */
export function horariosLivres(duracao: number, regras: RegrasDia, ocupados: readonly Intervalo[]): number[] {
  const livres: number[] = [];
  if (!(duracao >= 5 && duracao <= 480)) return livres;
  for (let ini = regras.abre; ini + duracao <= regras.fecha; ini += regras.passo) {
    const pedido = { inicio: ini, fim: ini + duracao };
    if (regras.minimoInicio !== undefined && ini < regras.minimoInicio) continue;
    if (colide(pedido, regras.almoco)) continue;
    if (horarioLivre(pedido, ocupados)) livres.push(ini);
  }
  return livres;
}

export const paraMinutos = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const paraHora = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
