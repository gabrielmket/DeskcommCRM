/**
 * O preço que FALTAVA: o catálogo do banco, quando o modelo não está na tabela
 * fixa de `pricing.ts`.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────
 *
 * `pricing.ts` lista três modelos Claude e devolve `null` para qualquer outro,
 * de propósito ("mais honesto que inventar 0"). Só que o catálogo que a tela de
 * IA oferece (`ai_models`, migration 0104) tem 16 modelos, e o PADRÃO de OpenAI
 * — `gpt-5.6-terra` — é um deles. Medido nesta instalação (Time Company,
 * 15/09/2026), com o agente rodando nesse modelo há um dia:
 *
 *   • as 100 últimas linhas de `llm_calls` com `cost_cents` NULO;
 *   • 2,8 milhões de tokens no painel da plataforma ao lado de "Custo AI
 *     US$ 0,00", que se lê como "a IA não custou nada";
 *   • e o pior: `fn_gasto_de_ia_do_mes` soma `coalesce(cost_cents, 0)`, então o
 *     TETO mensal nunca dispara. A proteção contra a conta estourar estava
 *     desarmada justamente para quem escolheu um modelo do catálogo.
 *
 * O conserto de raiz é o que `lib/ai/budget/check.ts` já apontava: o motor
 * consulta o catálogo. O preço nunca é inventado — se o modelo não está nem na
 * tabela fixa nem no banco, o custo continua nulo.
 *
 * ── A tarifa de cache ──────────────────────────────────────────────────────
 *
 * `ai_pricing` tem entrada e saída, não tem cache. Aqui o token lido do cache
 * entra a 10% da entrada (o desconto que as duas famílias do catálogo praticam,
 * e o mesmo fator que `pricing.ts` usa nos Claude), e o token ESCRITO no cache
 * entra a preço de entrada — a OpenAI não cobra a escrita à parte, e cobrar a
 * mais seria pior que cobrar de menos num número que decide bloqueio.
 * Aproximação declarada, e conferível: a leitura de saldo da conta do provedor
 * (Uso & Custo, no admin) compara este número com a fatura real.
 */
import type pg from 'pg';

/** USD por MILHÃO de tokens, como o resto do motor conta. */
export interface TarifaDoCatalogo {
  input: number;
  output: number;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { tarifa: TarifaDoCatalogo | null; expiraEm: number }>();

/** Esvazia o cache de preços. Existe para os testes não contaminarem um ao outro. */
export function esquecerPrecos(): void {
  cache.clear();
}

/**
 * Preço vigente do modelo em `ai_pricing`, com o catálogo `ai_models` como
 * segunda fonte (a 0113 semeia uma a partir da outra, mas uma instalação que
 * habilitou um modelo só pela tela do catálogo tem a linha em `ai_models` e não
 * em `ai_pricing`). Resultado — inclusive "não tem preço" — fica 5 min em cache:
 * é uma consulta por chamada de LLM, e o preço não muda no meio da hora.
 */
export async function tarifaDoCatalogo(
  db: pg.Pool,
  model: string,
): Promise<TarifaDoCatalogo | null> {
  const agora = Date.now();
  const emCache = cache.get(model);
  if (emCache && emCache.expiraEm > agora) return emCache.tarifa;

  let tarifa: TarifaDoCatalogo | null = null;
  try {
    // `ai_pricing` é versionada por vigência: a linha válida é a que já começou
    // e não foi substituída. `limit 1` com a mais recente na frente para o caso
    // de duas vigências abertas por engano — a nova vale, e não a soma.
    const { rows } = await db.query<{ entrada: string | null; saida: string | null }>(
      `select prompt_cents_per_million_tokens as entrada,
              completion_cents_per_million_tokens as saida
         from public.ai_pricing
        where model = $1
          and effective_from <= now()
          and superseded_at is null
        order by effective_from desc
        limit 1`,
      [model],
    );
    const linha = rows[0];
    if (linha && linha.entrada !== null && linha.saida !== null) {
      // A coluna está em CENTAVOS por milhão; o motor conta em dólar por milhão.
      tarifa = { input: Number(linha.entrada) / 100, output: Number(linha.saida) / 100 };
    } else {
      const doCatalogo = await db.query<{ entrada: number | null; saida: number | null }>(
        `select input_price_per_million_cents as entrada,
                output_price_per_million_cents as saida
           from public.ai_models
          where model_id = $1 and deprecated_at is null
          limit 1`,
        [model],
      );
      const c = doCatalogo.rows[0];
      if (c && c.entrada !== null && c.saida !== null) {
        tarifa = { input: Number(c.entrada) / 100, output: Number(c.saida) / 100 };
      }
    }
  } catch {
    // Preço é telemetria: uma falha de leitura NÃO pode derrubar o turno do
    // agente que já rodou. Cai para nulo (custo desconhecido), como um modelo
    // sem preço, e a próxima chamada tenta de novo — o cache negativo dura os
    // mesmos 5 min, então uma indisponibilidade não vira uma consulta por turno.
    tarifa = null;
  }

  cache.set(model, { tarifa, expiraEm: agora + TTL_MS });
  return tarifa;
}

export interface TokensDaChamada {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Custo em CENTS (fracionário, como `pricing.ts`) pela tarifa do catálogo. */
export function custoPelaTarifa(tarifa: TarifaDoCatalogo, uso: TokensDaChamada): number {
  // `inputTokens` é o TOTAL do usage do SDK e já inclui o que veio do cache.
  const entradaNova = Math.max(0, uso.inputTokens - uso.cacheReadTokens);
  const usd =
    (entradaNova * tarifa.input + uso.cacheReadTokens * tarifa.input * 0.1 + uso.outputTokens * tarifa.output) /
    1_000_000;
  return usd * 100;
}
