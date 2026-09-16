/**
 * A COTAÇÃO DO DÓLAR — duas, na verdade, e elas respondem perguntas diferentes.
 *
 *  • **A de mercado**, por dia (`platform_fx_rates`, preenchida pelo cron). Serve
 *    para converter o custo em dólar do provedor para real. Por DIA porque o
 *    custo de um mês fechado não pode mudar quando o câmbio mexe depois.
 *
 *  • **A efetiva**, que é o que VOCÊ pagou pelo dólar: recarga feita com cartão
 *    brasileiro embute spread do banco e IOF. Ela não se calcula por percentual
 *    (a taxa muda por operação, o IOF muda por decreto) — ela se MEDE, dividindo
 *    os reais que saíram pelos dólares que entraram.
 *
 * A diferença entre as duas é o custo de comprar dólar, e é ela que decide
 * margem. Mostrar só a de mercado faria o preço nascer 10% otimista.
 */

/** Piso e teto de sanidade: protege contra resposta quebrada, não contra câmbio real. */
const MIN = 0.5;
const MAX = 100;

export interface CotacaoDoDia {
  dia: string;
  usd_brl: number;
}

/**
 * Lê o número da resposta da origem (awesomeapi: `{ USDBRL: { bid, ask, create_date } }`).
 * Devolve `null` em qualquer forma inesperada — origem fora do ar não pode
 * escrever lixo na tabela que converte dinheiro.
 */
export function lerCotacaoDaOrigem(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const bloco = (payload as Record<string, unknown>)["USDBRL"];
  if (!bloco || typeof bloco !== "object") return null;
  // `bid` é a compra e `ask` a venda; usamos `bid`, que é a referência que a
  // imprensa chama de "dólar comercial". A diferença entre as duas é menor que
  // o spread do cartão, e o número que decide margem é o EFETIVO, não este.
  const bruto = (bloco as Record<string, unknown>)["bid"];
  const valor = typeof bruto === "string" ? Number(bruto) : typeof bruto === "number" ? bruto : NaN;
  if (!Number.isFinite(valor) || valor <= MIN || valor >= MAX) return null;
  // Quatro casas: é o que a coluna guarda, e arredondar aqui evita que a mesma
  // cotação vire duas por causa de dízima.
  return Math.round(valor * 10_000) / 10_000;
}

/**
 * A cotação que vale para um dia: a dele, ou — se aquele dia não foi capturado
 * (cron fora do ar, feriado, instalação nova) — a mais recente ANTERIOR a ele.
 *
 * Nunca usa uma cotação POSTERIOR: seria converter o passado com informação que
 * não existia, que é exatamente o defeito que esta tabela veio consertar.
 */
export function cotacaoDoDia(historico: readonly CotacaoDoDia[], dia: string): number | null {
  let melhor: CotacaoDoDia | null = null;
  for (const linha of historico) {
    if (linha.dia > dia) continue;
    if (!melhor || linha.dia > melhor.dia) melhor = linha;
  }
  return melhor?.usd_brl ?? null;
}

export interface CustoDoDia {
  dia: string;
  cents: number;
}

/**
 * Converte centavos de DÓLAR em REAIS, dia a dia, cada um pela cotação dele.
 * Dia sem cotação nenhuma fica de fora e é devolvido em `semCotacao` — o total
 * em real passa a ser declaradamente parcial, em vez de silenciosamente menor.
 */
export function totalEmReais(
  custos: readonly CustoDoDia[],
  historico: readonly CotacaoDoDia[],
): { reais: number; semCotacao: number } {
  let reais = 0;
  let semCotacao = 0;
  for (const { dia, cents } of custos) {
    const taxa = cotacaoDoDia(historico, dia);
    if (taxa === null) {
      if (cents > 0) semCotacao++;
      continue;
    }
    reais += (cents / 100) * taxa;
  }
  return { reais, semCotacao };
}

export interface RecargaComReais {
  amount_usd: number;
  amount_brl?: number | null;
}

/**
 * A taxa que você pagou de fato, média ponderada pelo tamanho das recargas —
 * recarga grande pesa mais que recarga pequena, como na conta real.
 *
 * Só entram as recargas com os DOIS valores. Nulo quando nenhuma tem, e aí a
 * tela mostra a de mercado dizendo que é de mercado, em vez de fingir que é a sua.
 */
export function taxaEfetiva(recargas: readonly RecargaComReais[]): number | null {
  let usd = 0;
  let brl = 0;
  for (const r of recargas) {
    if (r.amount_brl === null || r.amount_brl === undefined) continue;
    if (!(r.amount_usd > 0) || !(r.amount_brl > 0)) continue;
    usd += r.amount_usd;
    brl += r.amount_brl;
  }
  if (usd <= 0) return null;
  return Math.round((brl / usd) * 10_000) / 10_000;
}
