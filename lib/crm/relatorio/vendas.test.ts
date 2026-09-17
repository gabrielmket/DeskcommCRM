import { describe, expect, it } from "vitest";

import {
  cicloDeVenda,
  historico,
  motivosDePerda,
  taxaDeGanho,
  type LeadDoRelatorio,
} from "@/lib/crm/relatorio/vendas";

/**
 * O RELATÓRIO QUE MENTE É PIOR QUE RELATÓRIO NENHUM.
 *
 * Cada caso aqui defende uma decisão de leitura: a média que um caso isolado
 * distorce, o denominador que faz a taxa cair quando o funil cresce, o motivo
 * de perda ordenado por contagem escondendo o contrato grande, e a série
 * temporal sem os meses vazios.
 *
 *     npx vitest run lib/crm/relatorio/vendas.test.ts
 */

const SP = "America/Sao_Paulo";
const COMERCIAL = "c0000000-0000-4000-8000-00000000000c";
const SDR = "50000000-0000-4000-8000-000000000005";

function lead(over: Partial<LeadDoRelatorio> = {}): LeadDoRelatorio {
  return {
    status: "won",
    pipeline_id: COMERCIAL,
    value_cents: 100_000,
    revenue_kind: "avulso",
    recurring_months: null,
    lost_reason: null,
    created_at: "2026-09-01T12:00:00.000Z",
    closed_at: "2026-09-11T12:00:00.000Z",
    ...over,
  };
}

describe("por que perdemos", () => {
  it("ordena pelo VALOR, não pela contagem", () => {
    const r = motivosDePerda(
      [
        ...Array.from({ length: 10 }, () =>
          lead({ status: "lost", lost_reason: "price", value_cents: 50_000 }),
        ),
        lead({ status: "lost", lost_reason: "product_unavailable", value_cents: 900_000 }),
      ],
      "2026-09",
      SP,
    );
    expect(
      r[0]!.motivo,
      "ordenar por contagem esconderia o contrato grande embaixo de dez leads pequenos",
    ).toBe("product_unavailable");
    expect(r[0]!.valorCents).toBe(900_000);
    expect(r[1]!.quantidade).toBe(10);
  });

  it("perda SEM motivo vira linha própria — não se mistura com 'outro'", () => {
    const r = motivosDePerda(
      [
        lead({ status: "lost", lost_reason: "other" }),
        lead({ status: "lost", lost_reason: null }),
        lead({ status: "lost", lost_reason: "   " }),
      ],
      "2026-09",
      SP,
    );
    const semMotivo = r.find((x) => x.motivo === "(sem motivo declarado)");
    expect(
      semMotivo?.quantidade,
      "quem respondeu 'outro' e quem não respondeu nada são coisas diferentes",
    ).toBe(2);
  });

  it("perda no funil do SDR TAMBÉM conta — é reunião que não aconteceu", () => {
    const r = motivosDePerda(
      [lead({ status: "lost", pipeline_id: SDR, lost_reason: "no_response" })],
      "2026-09",
      SP,
    );
    expect(
      r,
      "filtrar perda por funil de receita esconderia metade do problema de quem prospecta",
    ).toHaveLength(1);
  });
});

describe("quanto tempo leva para fechar", () => {
  it("devolve média E mediana — um caso arrastado distorce só a primeira", () => {
    const r = cicloDeVenda(
      [
        lead({ created_at: "2026-09-01T00:00:00Z", closed_at: "2026-09-06T00:00:00Z" }), // 5
        lead({ created_at: "2026-09-01T00:00:00Z", closed_at: "2026-09-08T00:00:00Z" }), // 7
        lead({ created_at: "2026-01-01T00:00:00Z", closed_at: "2026-09-28T00:00:00Z" }), // 270
      ],
      "2026-09",
      SP,
      null,
    );
    expect(r.vendas).toBe(3);
    expect(r.medianaDias, "a mediana mostra o típico").toBe(7);
    expect(
      r.mediaDias! > 90,
      "a média sozinha faria concluir que o ciclo piorou, quando houve UM caso isolado",
    ).toBe(true);
  });

  it("ganho no funil do SDR não entra no ciclo de VENDA", () => {
    const r = cicloDeVenda([lead({ pipeline_id: SDR })], "2026-09", SP, new Set([COMERCIAL]));
    expect(r.vendas).toBe(0);
    expect(r.mediaDias).toBeNull();
  });

  it("data de fechamento anterior à criação é descartada, não vira número negativo", () => {
    const r = cicloDeVenda(
      [lead({ created_at: "2026-09-20T00:00:00Z", closed_at: "2026-09-10T00:00:00Z" })],
      "2026-09",
      SP,
      null,
    );
    expect(r.vendas).toBe(0);
  });
});

describe("a taxa de ganho", () => {
  it("o denominador é só o que FECHOU", () => {
    const r = taxaDeGanho(
      [
        lead({ status: "won" }),
        lead({ status: "lost" }),
        lead({ status: "open", closed_at: null }),
        lead({ status: "open", closed_at: null }),
      ],
      "2026-09",
      SP,
      null,
    );
    expect(
      r.taxa,
      "incluir os abertos faria a taxa despencar sempre que entrasse gente nova no funil",
    ).toBe(0.5);
  });

  it("sem nada fechado, a taxa é NULA — não zero", () => {
    expect(taxaDeGanho([], "2026-09", SP, null).taxa).toBeNull();
  });
});

describe("a evolução dos meses", () => {
  it("traz os meses VAZIOS também — buraco na série é informação", () => {
    const r = historico(
      [lead({ closed_at: "2026-09-10T12:00:00Z", value_cents: 300_000 })],
      "2026-09",
      3,
      SP,
      null,
    );
    expect(r.map((m) => m.periodo)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(r[0]!.receitaCents, "mês sem venda tem que aparecer com zero").toBe(0);
    expect(r[2]!.receitaCents).toBe(300_000);
  });

  it("separa recorrente de avulso dentro do mês", () => {
    const r = historico(
      [
        lead({ revenue_kind: "recorrente", value_cents: 200_000 }),
        lead({ revenue_kind: "avulso", value_cents: 50_000 }),
        lead({ revenue_kind: null, value_cents: 10_000 }),
      ],
      "2026-09",
      1,
      SP,
      null,
    );
    const set = r[0]!;
    expect(set.receitaCents, "o total soma tudo, inclusive a não classificada").toBe(260_000);
    expect(set.recorrenteCents).toBe(200_000);
    expect(set.avulsoCents).toBe(50_000);
  });

  it("conta perdas por mês, de qualquer funil", () => {
    const r = historico([lead({ status: "lost", pipeline_id: SDR })], "2026-09", 1, SP, new Set([COMERCIAL]));
    expect(r[0]!.perdas).toBe(1);
    expect(r[0]!.vendas).toBe(0);
  });
});
