/**
 * O GASTO REAL DA CONTA — o número da fatura, não o nosso.
 *
 * Este sistema mede o custo somando token × preço de tabela. É uma boa medida e
 * é o que sustenta teto, alarme e preço por conversa. Mas é MEDIÇÃO, e medição
 * tem erro: modelo sem preço na tabela, desconto de cache que a tarifa do
 * catálogo não descreve, uso da mesma chave fora deste sistema.
 *
 * A API de organização da OpenAI responde a outra pergunta, a definitiva:
 * quanto foi COBRADO. Com as duas lado a lado, a diferença deixa de ser
 * suspeita e vira número — e é ela que diz se dá para confiar no custo por
 * conversa na hora de fechar um preço.
 *
 * ── As armadilhas desta API, medidas no painel MIA em 21/08/2026 ────────────
 *
 *  • **O balde é de DIA INTEIRO em UTC.** Pedir a partir da meia-noite de
 *    Brasília (03:00 UTC) faz a OpenAI DESCARTAR o balde em silêncio: a
 *    resposta vem vazia e o painel conclui "gasto de hoje = US$ 0,00" o dia
 *    inteiro. Por isso todo limite aqui é alinhado no piso do dia UTC.
 *  • **O dia de hoje não existe na fatura** até virar a meia-noite UTC. Este
 *    módulo não inventa o dia aberto: ele devolve só os dias FECHADOS, e a
 *    tela usa a nossa medição para o que falta. Melhor um dia declaradamente
 *    ausente do que um número que parece fatura e não é.
 *  • **`bucket_width` só aceita `1d` e `limit` máximo 31**, então a janela é
 *    pedida em fatias de 31 dias.
 *  • **Cobre ~12 meses.** Pedir mais é consulta que não volta.
 *
 * Nunca lança: sem chave, com a origem fora do ar ou com resposta estranha, o
 * resultado é "não disponível" e o resto do painel continua de pé.
 */

const COSTS = "https://api.openai.com/v1/organization/costs";
const DIA_S = 86_400;
const LIMITE_BALDES = 31;
const TIMEOUT_MS = 30_000;

export interface GastoDeUmDia {
  /** AAAA-MM-DD em UTC, como todo carimbo deste repo. */
  dia: string;
  /** Dólares (não centavos): é a unidade em que a OpenAI responde. */
  usd: number;
}

/** Piso do dia em UTC. A API descarta balde que começa no meio do dia. */
export function pisoDoDiaUtc(ts: number): number {
  return Math.floor(ts / DIA_S) * DIA_S;
}

/**
 * Quebra a janela em fatias de 31 dias, que é o teto de baldes por chamada.
 * Devolve pares [inicio, fim) já alinhados no piso do dia UTC.
 */
export function fatias(inicioTs: number, fimTs: number): Array<[number, number]> {
  const inicio = pisoDoDiaUtc(inicioTs);
  const fim = pisoDoDiaUtc(fimTs);
  const saida: Array<[number, number]> = [];
  for (let de = inicio; de < fim; de += LIMITE_BALDES * DIA_S) {
    saida.push([de, Math.min(de + LIMITE_BALDES * DIA_S, fim)]);
  }
  return saida;
}

/**
 * Traduz a resposta da API em dias. A forma é
 * `{ data: [{ start_time, results: [{ amount: { value, currency } }] }] }`.
 *
 * Moeda diferente de USD é DESCARTADA em vez de somada: misturar moeda num
 * total que a tela chama de dólar seria pior que não mostrar.
 */
export function lerFatura(payload: unknown): GastoDeUmDia[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as Record<string, unknown>)["data"];
  if (!Array.isArray(data)) return [];

  const dias: GastoDeUmDia[] = [];
  for (const balde of data) {
    if (!balde || typeof balde !== "object") continue;
    const inicio = (balde as Record<string, unknown>)["start_time"];
    const resultados = (balde as Record<string, unknown>)["results"];
    if (typeof inicio !== "number" || !Array.isArray(resultados)) continue;

    let total = 0;
    for (const linha of resultados) {
      const valor = (linha as Record<string, unknown> | null)?.["amount"];
      if (!valor || typeof valor !== "object") continue;
      const numero = (valor as Record<string, unknown>)["value"];
      const moeda = (valor as Record<string, unknown>)["currency"];
      if (typeof numero !== "number" || !Number.isFinite(numero)) continue;
      if (typeof moeda === "string" && moeda.toLowerCase() !== "usd") continue;
      total += numero;
    }
    dias.push({ dia: new Date(inicio * 1000).toISOString().slice(0, 10), usd: total });
  }
  return dias;
}

export type Buscador = (url: string, chave: string) => Promise<unknown>;

const buscaPadrao: Buscador = async (url, chave) => {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: controle.signal,
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Os dias FECHADOS da fatura na janela pedida. O dia corrente fica de fora de
 * propósito (ver o cabeçalho). Devolve lista vazia quando não há chave ou a
 * consulta não volta — nunca lança.
 */
export async function faturaPorDia(
  chave: string,
  inicioTs: number,
  fimTs: number,
  buscar: Buscador = buscaPadrao,
): Promise<GastoDeUmDia[]> {
  if (!chave) return [];

  // A API cobre ~12 meses; pedir mais é consulta que não volta.
  const limiteDoHistorico = pisoDoDiaUtc(Math.floor(Date.now() / 1000) - 360 * DIA_S);
  const hojeUtc = pisoDoDiaUtc(Math.floor(Date.now() / 1000));
  const de = Math.max(pisoDoDiaUtc(inicioTs), limiteDoHistorico);
  // `fim` nunca passa do começo de hoje: o dia aberto não existe na fatura.
  const ate = Math.min(pisoDoDiaUtc(fimTs), hojeUtc);
  if (ate <= de) return [];

  const dias: GastoDeUmDia[] = [];
  for (const [fatiaDe, fatiaAte] of fatias(de, ate)) {
    const url = new URL(COSTS);
    url.searchParams.set("start_time", String(fatiaDe));
    url.searchParams.set("end_time", String(fatiaAte));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", String(LIMITE_BALDES));
    try {
      dias.push(...lerFatura(await buscar(url.toString(), chave)));
    } catch {
      // Uma fatia que falha não pode apagar as outras: o que veio, veio, e a
      // tela declara o período coberto pelo que existe.
      continue;
    }
  }
  return dias;
}
