import { describe, expect, it } from "vitest";

import { janelaDoMes, mesNoFuso } from "@/lib/crm/metas/fuso";

/**
 * O MÊS DE QUEM OPERA.
 *
 * Este defeito não aparece no total do ano: o dinheiro não some, ele muda de
 * mês. Quem o encontra é quem confere comissão — um mês depois, quando já não
 * dá para lembrar o que aconteceu naquela noite do dia 30.
 *
 * Achado pelo dono do produto em 16/09/2026, reparando que eu citava horários
 * em UTC ("já é 13:31").
 *
 *     npx vitest run lib/crm/metas/fuso.test.ts
 */

const SP = "America/Sao_Paulo";

describe("o mês de um instante depende do fuso", () => {
  it("22h do dia 30 em São Paulo ainda é SETEMBRO — em UTC já seria outubro", () => {
    // 2026-10-01T01:00:00Z === 30/09 22:00 em São Paulo (UTC-3).
    const instante = "2026-10-01T01:00:00.000Z";
    expect(
      instante.slice(0, 7),
      "controle: a leitura ingênua (a de antes desta correção) diz outubro",
    ).toBe("2026-10");
    expect(
      mesNoFuso(instante, SP),
      "a venda fechada às 22h do dia 30 foi parar no mês seguinte: some da comissão de setembro e aparece na de outubro",
    ).toBe("2026-09");
  });

  it("e 1h da manhã do dia 1º continua sendo OUTUBRO", () => {
    expect(mesNoFuso("2026-10-01T04:00:00.000Z", SP)).toBe("2026-10");
  });

  it("instante inválido não entra em mês nenhum — melhor sumir que cair no mês errado", () => {
    expect(mesNoFuso(null, SP)).toBe("");
    expect(mesNoFuso("nem data isso é", SP)).toBe("");
  });

  it("fuso desconhecido cai em UTC em vez de derrubar o relatório", () => {
    expect(mesNoFuso("2026-10-01T01:00:00.000Z", "Marte/Olympus")).toBe("2026-10");
  });
});

describe("a janela do mês", () => {
  it("começa à meia-noite DE SÃO PAULO, que é 03:00 UTC", () => {
    const j = janelaDoMes("2026-09", SP);
    expect(j.inicio).toBe("2026-09-01T03:00:00.000Z");
    expect(j.fim, "o fim é o primeiro instante do mês seguinte, exclusivo").toBe(
      "2026-10-01T03:00:00.000Z",
    );
  });

  it("dezembro vira janeiro do ano seguinte, e não mês 13", () => {
    const j = janelaDoMes("2026-12", SP);
    expect(j.fim).toBe("2027-01-01T03:00:00.000Z");
  });

  it("em UTC a janela é a de sempre — quem não declarou fuso não muda de comportamento", () => {
    const j = janelaDoMes("2026-09", "UTC");
    expect(j.inicio).toBe("2026-09-01T00:00:00.000Z");
    expect(j.fim).toBe("2026-10-01T00:00:00.000Z");
  });

  it("aceita AAAA-MM-DD (o primeiro dia já formatado) sem mudar de resultado", () => {
    expect(janelaDoMes("2026-09-01", SP).inicio).toBe(janelaDoMes("2026-09", SP).inicio);
  });

  it("fuso com horário de verão: a janela sai do lado certo da virada", () => {
    // Lisboa entra no horário de verão no último domingo de março. O mês de
    // abril começa já dentro dele (UTC+1), então a meia-noite local é 23:00 do
    // dia 31 em UTC — é o caso que a segunda passada do cálculo existe para
    // acertar.
    expect(janelaDoMes("2026-04", "Europe/Lisbon").inicio).toBe("2026-03-31T23:00:00.000Z");
    // E março começa ANTES da virada (UTC+0).
    expect(janelaDoMes("2026-03", "Europe/Lisbon").inicio).toBe("2026-03-01T00:00:00.000Z");
  });
});
