/**
 * O saldo da carteira do cliente — derivado, nunca guardado.
 *
 * A doutrina é a mesma do saldo do provedor (`lib/ai/custo/saldo.ts`) com uma
 * diferença que simplifica tudo: lá o dinheiro está numa conta de terceiro e
 * existe o lançamento `leitura` para reancorar o que aconteceu fora do nosso
 * alcance. Aqui a conta é NOSSA — todo crédito e todo débito passaram por uma
 * linha — então o saldo é a soma exata, e não uma estimativa.
 *
 * Por isso este arquivo não tem "última leitura" e não devolve `null`: carteira
 * sem lançamento nenhum tem saldo ZERO, e isso é um fato, não uma ausência de
 * informação. (Ver `lib/ai/custo/saldo.ts` para o caso oposto, onde devolver
 * zero seria mentir.)
 */

export type TipoDeLancamento = "credito" | "debito" | "estorno";

export interface LancamentoDaCarteira {
  tipo: TipoDeLancamento;
  /** Sempre positivo — o sinal vem do `tipo`. Ver migration 0244. */
  amount_cents: number;
  occurred_at: string;
}

export interface SaldoDaCarteira {
  saldo_cents: number;
  creditado_cents: number;
  debitado_cents: number;
  estornado_cents: number;
  lancamentos: number;
}

/**
 * Soma o extrato.
 *
 * Lançamento com valor negativo é recusado pelo CHECK do banco, mas esta função
 * também roda sobre dados que vieram de fora (importação, fixture de teste) — e
 * `Math.abs` aqui transformaria um dado corrompido em saldo plausível. Preferir
 * ignorar: um valor que não é número positivo não entra na conta, e a contagem
 * de `lancamentos` denuncia a diferença.
 */
export function derivarSaldo(lancamentos: LancamentoDaCarteira[]): SaldoDaCarteira {
  let creditado = 0;
  let debitado = 0;
  let estornado = 0;
  let contados = 0;

  for (const l of lancamentos) {
    const valor = Number(l.amount_cents);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    contados += 1;
    if (l.tipo === "credito") creditado += valor;
    else if (l.tipo === "debito") debitado += valor;
    else if (l.tipo === "estorno") estornado += valor;
  }

  return {
    saldo_cents: creditado + estornado - debitado,
    creditado_cents: creditado,
    debitado_cents: debitado,
    estornado_cents: estornado,
    lancamentos: contados,
  };
}

/** Por que o disparo não pode começar. `null` = pode. */
export type MotivoDaTrava = "sem_preco_acordado" | "saldo_insuficiente";

export interface VeredictoDaTrava {
  pode: boolean;
  motivo: MotivoDaTrava | null;
  /** Quantas mensagens o saldo cobre — a única frase útil para quem vai disparar. */
  mensagens_que_cabem: number | null;
  /** O que falta, em centavos, para caber a lista inteira. */
  falta_cents: number | null;
}

/**
 * A trava de saldo, ANTES do primeiro envio.
 *
 * Checar mensagem a mensagem parece mais seguro e é pior: a lista para no meio,
 * metade dos contatos recebeu, e a pessoa não sabe quem. Aqui a pergunta é
 * "cabe a lista inteira?", e a resposta diz quantas cabem — com isso quem
 * dispara escolhe cortar a lista ou recarregar, em vez de descobrir o corte
 * depois de feito.
 *
 * ⚠️ Preço NULO recusa. É a organização sem preço acordado, e supor zero
 * mandaria mensagem paga de graça; supor um preço qualquer cobraria um valor
 * que ninguém combinou. As duas são piores que parar e perguntar.
 */
export function podeDisparar(input: {
  saldoCents: number;
  precoPorMensagemCents: number | null;
  destinatarios: number;
}): VeredictoDaTrava {
  const { saldoCents, precoPorMensagemCents, destinatarios } = input;

  if (precoPorMensagemCents === null || !Number.isFinite(precoPorMensagemCents)) {
    return { pode: false, motivo: "sem_preco_acordado", mensagens_que_cabem: null, falta_cents: null };
  }

  // Preço zero é decisão comercial declarada (cortesia, piloto): cabe sempre, e
  // dizer "infinitas" com um número seria pior que dizer o número de contatos.
  if (precoPorMensagemCents === 0) {
    return { pode: true, motivo: null, mensagens_que_cabem: destinatarios, falta_cents: 0 };
  }

  const cabem = Math.max(0, Math.floor(saldoCents / precoPorMensagemCents));
  const custoTotal = destinatarios * precoPorMensagemCents;
  if (custoTotal > saldoCents) {
    return {
      pode: false,
      motivo: "saldo_insuficiente",
      mensagens_que_cabem: cabem,
      falta_cents: custoTotal - saldoCents,
    };
  }
  return { pode: true, motivo: null, mensagens_que_cabem: cabem, falta_cents: 0 };
}

/**
 * O crédito está acabando?
 *
 * Separado da trava de propósito: a trava impede, o aviso avisa. Uma carteira
 * pode estar acima do piso e ainda assim não cobrir a lista de hoje, e pode
 * estar abaixo do piso e cobrir — são perguntas diferentes, e fundi-las faria a
 * tela dizer "tudo certo" para quem está prestes a ficar sem crédito.
 */
export function creditoAcabando(saldoCents: number, alertaCents: number | null): boolean {
  if (alertaCents === null || !Number.isFinite(alertaCents)) return false;
  return saldoCents <= alertaCents;
}
