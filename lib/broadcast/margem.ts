/**
 * A MARGEM DO DISPARO — o que se cobra menos o que se paga.
 *
 * Puro de propósito, pelo mesmo motivo do resto do módulo: é conta de dinheiro,
 * e conta de dinheiro escrita em dois lugares diverge na primeira correção.
 *
 * ── O erro que esta função existe para impedir ──────────────────────────────
 *
 * A Meta dá mensagens gratuitas por mês, mas de CONVERSA DE SERVIÇO — as que o
 * cliente inicia. Template de MARKETING, que é o que um disparador manda, é
 * cobrado desde a primeira. Os dois têm nome parecido e valor muito diferente:
 * quem precifica supondo o gratuito errado vende abaixo do custo nas primeiras
 * mil mensagens de cada cliente e só descobre na fatura.
 *
 * Por isso a cota gratuita entra por CATEGORIA e nunca é suposta — vem da
 * tarifa declarada (`platform_meta_pricing`), que nasce zero.
 */

export interface TarifaDaMeta {
  categoria: "marketing" | "utility" | "authentication" | "service";
  precoCents: number;
  gratuitasPorMes: number;
}

export interface MargemDoDisparo {
  /** O que o cliente paga. */
  receitaCents: number;
  /** O que a Meta cobra da operação. */
  custoCents: number;
  margemCents: number;
  /** 0 a 1. `null` quando não há receita — dividir por zero não é "0%". */
  margemPercentual: number | null;
  /** Quantas caíram na cota gratuita (e por isso não custaram nada). */
  gratuitas: number;
  cobradasPelaMeta: number;
}

/**
 * A margem de um lote.
 *
 * `jaUsadasNoMes` é quantas mensagens desta categoria já saíram no mês antes
 * deste lote: a cota gratuita é mensal e compartilhada, e ignorar o que já foi
 * gasto faria toda campanha do mês achar que tem a cota inteira.
 */
export function margemDoDisparo(input: {
  mensagens: number;
  precoAoClienteCents: number | null;
  tarifa: TarifaDaMeta | null;
  jaUsadasNoMes?: number;
}): MargemDoDisparo {
  const mensagens = Math.max(0, input.mensagens);
  const receitaCents = (input.precoAoClienteCents ?? 0) * mensagens;

  // Sem tarifa declarada, o custo é DESCONHECIDO — e desconhecido não é zero.
  // Devolver custo zero aqui pintaria margem de 100% numa tela que serve para
  // decidir preço, que é o pior lugar possível para um número otimista.
  if (!input.tarifa) {
    return {
      receitaCents,
      custoCents: 0,
      margemCents: receitaCents,
      margemPercentual: null,
      gratuitas: 0,
      cobradasPelaMeta: mensagens,
    };
  }

  const jaUsadas = Math.max(0, input.jaUsadasNoMes ?? 0);
  const sobramDeGraca = Math.max(0, input.tarifa.gratuitasPorMes - jaUsadas);
  const gratuitas = Math.min(mensagens, sobramDeGraca);
  const cobradasPelaMeta = mensagens - gratuitas;
  const custoCents = cobradasPelaMeta * input.tarifa.precoCents;
  const margemCents = receitaCents - custoCents;

  return {
    receitaCents,
    custoCents,
    margemCents,
    margemPercentual: receitaCents > 0 ? margemCents / receitaCents : null,
    gratuitas,
    cobradasPelaMeta,
  };
}

/**
 * O preço MÍNIMO para não vender no prejuízo, dada a tarifa.
 *
 * Existe para a tela de preço do cliente avisar ANTES de alguém digitar um
 * valor abaixo do custo — e não depois, na conferência da fatura.
 */
export function pisoDoPreco(tarifa: TarifaDaMeta | null): number | null {
  return tarifa ? tarifa.precoCents : null;
}
