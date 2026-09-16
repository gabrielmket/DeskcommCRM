/**
 * O preço do catálogo — a peça que tirou o custo do zero.
 *
 * O que estes casos prendem, medido na instalação da Time Company (15/09/2026):
 * o agente rodava em `gpt-5.6-terra`, `pricing.ts` só conhece três Claude, e
 * TODA linha de `llm_calls` nascia com `cost_cents` nulo — tela zerada e teto
 * mensal desarmado, porque `fn_gasto_de_ia_do_mes` soma `coalesce(cost_cents, 0)`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  custoPelaTarifa,
  esquecerPrecos,
  tarifaDoCatalogo,
} from "@/lib/agent-engine/edge/llm/preco-do-catalogo";

type Linha = Record<string, unknown>;

function bancoQueResponde(respostas: Linha[][]) {
  const query = vi.fn(async () => ({ rows: respostas.shift() ?? [] }));
  return { db: { query } as never, query };
}

beforeEach(() => {
  esquecerPrecos();
});

describe("tarifa do catálogo", () => {
  it("lê o preço vigente de ai_pricing, convertendo centavos por milhão em dólar", async () => {
    // gpt-5.6-terra no catálogo: 200 e 1200 centavos por milhão = US$ 2 e US$ 12.
    const { db } = bancoQueResponde([[{ entrada: "200.0000", saida: "1200.0000" }]]);
    expect(await tarifaDoCatalogo(db, "gpt-5.6-terra")).toEqual({ input: 2, output: 12 });
  });

  it("cai para ai_models quando ai_pricing não tem a linha", async () => {
    const { db, query } = bancoQueResponde([[], [{ entrada: 20, saida: 120 }]]);
    expect(await tarifaDoCatalogo(db, "gpt-5.6-luna")).toEqual({ input: 0.2, output: 1.2 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("modelo sem preço em lugar nenhum continua sem custo — nunca zero inventado", async () => {
    const { db } = bancoQueResponde([[], []]);
    expect(await tarifaDoCatalogo(db, "modelo-que-ninguem-cadastrou")).toBeNull();
  });

  it("falha do banco não derruba o turno que já rodou", async () => {
    const db = {
      query: vi.fn(async () => {
        throw new Error("conexão caiu");
      }),
    } as never;
    await expect(tarifaDoCatalogo(db, "gpt-5.6-terra")).resolves.toBeNull();
  });

  it("guarda a resposta em cache: uma consulta por modelo, não uma por turno", async () => {
    const { db, query } = bancoQueResponde([[{ entrada: "200.0000", saida: "1200.0000" }]]);
    await tarifaDoCatalogo(db, "gpt-5.6-terra");
    await tarifaDoCatalogo(db, "gpt-5.6-terra");
    await tarifaDoCatalogo(db, "gpt-5.6-terra");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("cacheia também o 'não tem preço', senão a indisponibilidade vira consulta por turno", async () => {
    const { db, query } = bancoQueResponde([[], []]);
    await tarifaDoCatalogo(db, "sem-preco");
    await tarifaDoCatalogo(db, "sem-preco");
    expect(query).toHaveBeenCalledTimes(2); // as duas fontes, uma vez só
  });
});

describe("custo pela tarifa", () => {
  const terra = { input: 2, output: 12 };

  it("cobra entrada, saída e desconta o que veio do cache", () => {
    // 1M de entrada (300k lidos do cache) + 100k de saída:
    // 700k × US$2 + 300k × US$0,20 + 100k × US$12 = 1,40 + 0,06 + 1,20 = US$ 2,66
    const cents = custoPelaTarifa(terra, {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 300_000,
      cacheWriteTokens: 0,
    });
    expect(cents).toBeCloseTo(266, 6);
  });

  it("o turno real da Rafa custa centavos, não zero", () => {
    // Um agent_turn medido em produção: 46 mil de entrada, 400 de saída.
    const cents = custoPelaTarifa(terra, {
      inputTokens: 46_000,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeCloseTo(9.68, 2);
  });

  it("chamada sem token nenhum custa zero, e não NaN", () => {
    expect(
      custoPelaTarifa(terra, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
