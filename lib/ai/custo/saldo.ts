/**
 * O saldo do provedor, derivado — a conta que a rota faz, fora dela para poder
 * ser medida.
 *
 *   saldo = última LEITURA + RECARGAS depois dela − consumo desde a leitura
 *
 * Duas decisões que valem mais que a fórmula:
 *
 *  • sem nenhuma leitura o saldo é NULO, nunca zero. Zero na tela se lê como
 *    "acabou", e levaria alguém a recarregar uma conta cheia — ou a ignorar um
 *    aviso verdadeiro depois, quando o zero for real;
 *  • "dura até" só existe com ritmo medido. Consumo zero nos últimos 30 dias
 *    daria divisão por zero e viraria "dura para sempre", que é a frase mais
 *    perigosa que um painel de saldo pode dizer.
 */
export interface LancamentoBruto {
  tipo: "recarga" | "leitura";
  amount_usd: number;
  occurred_at: string;
}

export interface SaldoDerivado {
  saldoUsd: number | null;
  leitura: { amount_usd: number; occurred_at: string } | null;
  recargasDesdeLeituraUsd: number;
  diasRestantes: number | null;
  duraAte: string | null;
}

export function derivarSaldo(entrada: {
  /** Ordem qualquer: a leitura mais recente é escolhida aqui. */
  lancamentos: readonly LancamentoBruto[];
  consumoDesdeLeituraUsd: number;
  mediaDiariaUsd: number;
  agora?: Date;
}): SaldoDerivado {
  const agora = entrada.agora ?? new Date();

  const leitura = entrada.lancamentos
    .filter((l) => l.tipo === "leitura")
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];

  if (!leitura) {
    return {
      saldoUsd: null,
      leitura: null,
      recargasDesdeLeituraUsd: 0,
      diasRestantes: null,
      duraAte: null,
    };
  }

  // Recarga lançada COM A DATA do fato: uma recarga anterior à leitura já está
  // dentro do valor conferido, e somá-la de novo contaria o mesmo dinheiro duas
  // vezes — o erro que faria o saldo parecer maior justamente quando acaba.
  const recargasDesdeLeituraUsd = entrada.lancamentos
    .filter((l) => l.tipo === "recarga" && l.occurred_at > leitura.occurred_at)
    .reduce((acc, l) => acc + l.amount_usd, 0);

  const saldoUsd = leitura.amount_usd + recargasDesdeLeituraUsd - entrada.consumoDesdeLeituraUsd;

  const diasRestantes =
    entrada.mediaDiariaUsd > 0 ? Math.max(0, saldoUsd / entrada.mediaDiariaUsd) : null;
  const duraAte =
    diasRestantes === null
      ? null
      : new Date(agora.getTime() + diasRestantes * 24 * 60 * 60 * 1000).toISOString();

  return {
    saldoUsd,
    leitura: { amount_usd: leitura.amount_usd, occurred_at: leitura.occurred_at },
    recargasDesdeLeituraUsd,
    diasRestantes,
    duraAte,
  };
}
