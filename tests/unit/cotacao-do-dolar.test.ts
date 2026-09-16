/**
 * A COTAÇÃO — e as duas mentiras que ela evita.
 *
 * 1. **"O custo de agosto mudou."** Converter um período inteiro pela cotação de
 *    hoje faz o custo de um mês fechado se mexer quando o câmbio mexe depois.
 *    Cada dia é convertido pela cotação DELE, e nunca por uma posterior.
 *
 * 2. **"O dólar custa R$ 5,45."** Custa para quem compra no mercado. Recarga no
 *    cartão brasileiro embute spread e IOF, e a taxa que decide margem é a
 *    EFETIVA — medida dividindo os reais que saíram pelos dólares que entraram,
 *    nunca estimada por percentual (a taxa do banco muda por operação e o IOF
 *    muda por decreto).
 */
import { describe, expect, it } from "vitest";

import {
  cotacaoDoDia,
  lerCotacaoDaOrigem,
  taxaEfetiva,
  totalEmReais,
} from "@/lib/ai/custo/cotacao";

describe("ler a cotação da origem", () => {
  it("aceita a resposta da origem e arredonda em quatro casas", () => {
    expect(lerCotacaoDaOrigem({ USDBRL: { bid: "5.4529", ask: "5.4535" } })).toBe(5.4529);
  });

  it("aceita número, além de texto", () => {
    expect(lerCotacaoDaOrigem({ USDBRL: { bid: 5.45 } })).toBe(5.45);
  });

  for (const [rotulo, payload] of [
    ["resposta vazia", null],
    ["sem o bloco esperado", { OUTRA: { bid: "5.45" } }],
    ["valor não numérico", { USDBRL: { bid: "abc" } }],
    ["zero", { USDBRL: { bid: "0" } }],
    ["absurdo para cima", { USDBRL: { bid: "9999" } }],
  ] as const) {
    it(`recusa ${rotulo} — dinheiro não se converte por lixo`, () => {
      expect(lerCotacaoDaOrigem(payload)).toBeNull();
    });
  }
});

describe("a cotação que vale para um dia", () => {
  const historico = [
    { dia: "2026-09-10", usd_brl: 5.4 },
    { dia: "2026-09-12", usd_brl: 5.5 },
    { dia: "2026-09-16", usd_brl: 5.3 },
  ];

  it("usa a do próprio dia quando existe", () => {
    expect(cotacaoDoDia(historico, "2026-09-12")).toBe(5.5);
  });

  it("dia sem captura cai na mais recente ANTERIOR", () => {
    // 13, 14 e 15 sem captura (cron fora do ar): vale a do dia 12.
    expect(cotacaoDoDia(historico, "2026-09-14")).toBe(5.5);
  });

  it("nunca usa cotação POSTERIOR — seria converter o passado com o futuro", () => {
    expect(cotacaoDoDia(historico, "2026-09-09")).toBeNull();
  });

  it("histórico vazio devolve nulo, não zero", () => {
    expect(cotacaoDoDia([], "2026-09-16")).toBeNull();
  });
});

describe("converter o período", () => {
  const historico = [
    { dia: "2026-09-15", usd_brl: 5.0 },
    { dia: "2026-09-16", usd_brl: 6.0 },
  ];

  it("cada dia pela cotação dele", () => {
    // 200 centavos de dólar a 5,00 = R$ 10; 100 a 6,00 = R$ 6.
    const { reais } = totalEmReais(
      [
        { dia: "2026-09-15", cents: 200 },
        { dia: "2026-09-16", cents: 100 },
      ],
      historico,
    );
    expect(reais).toBeCloseTo(16, 6);
  });

  it("dia sem cotação não entra no total, e o total se declara parcial", () => {
    const r = totalEmReais(
      [
        { dia: "2026-09-14", cents: 500 },
        { dia: "2026-09-16", cents: 100 },
      ],
      historico,
    );
    expect(r.reais).toBeCloseTo(6, 6);
    expect(r.semCotacao).toBe(1);
  });

  it("dia sem gasto e sem cotação não conta como buraco", () => {
    const r = totalEmReais([{ dia: "2026-09-01", cents: 0 }], historico);
    expect(r.semCotacao).toBe(0);
  });
});

describe("a taxa que você pagou de verdade", () => {
  it("é média PONDERADA: recarga grande pesa mais", () => {
    // US$ 10 por R$ 64 e US$ 90 por R$ 540 → (64+540)/(100) = 6,04.
    expect(
      taxaEfetiva([
        { amount_usd: 10, amount_brl: 64 },
        { amount_usd: 90, amount_brl: 540 },
      ]),
    ).toBe(6.04);
  });

  it("ignora recarga sem o valor em reais, em vez de contá-la como grátis", () => {
    expect(
      taxaEfetiva([
        { amount_usd: 10, amount_brl: 64 },
        { amount_usd: 100, amount_brl: null },
      ]),
    ).toBe(6.4);
  });

  it("sem nenhuma recarga com os dois valores, devolve nulo", () => {
    // A tela então mostra a de mercado DIZENDO que é de mercado.
    expect(taxaEfetiva([{ amount_usd: 10 }])).toBeNull();
    expect(taxaEfetiva([])).toBeNull();
  });

  it("mostra o custo do IOF sem ninguém estimar percentual", () => {
    // Mercado a 5,45 e efetiva a 6,04: 10,8% de diferença, medidos.
    const efetiva = taxaEfetiva([{ amount_usd: 10, amount_brl: 60.4 }]);
    expect(efetiva).toBe(6.04);
    expect(((efetiva! - 5.45) / 5.45) * 100).toBeCloseTo(10.8, 1);
  });
});
