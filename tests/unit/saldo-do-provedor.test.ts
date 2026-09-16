/**
 * O saldo que se mantém sozinho.
 *
 * Um campo "saldo" digitado à mão envelhece no instante seguinte e ninguém sabe
 * de quando ele é. Aqui o saldo é derivado da última LEITURA — "fui na conta do
 * provedor e era este o valor" — mais as recargas posteriores, menos o consumo
 * medido no mesmo intervalo.
 *
 * Os dois casos que mais importam são os de ausência: sem leitura o saldo é
 * NULO (zero se leria como "acabou") e sem ritmo não existe "dura até" (divisão
 * por zero viraria "dura para sempre", a frase mais perigosa que um painel de
 * saldo pode dizer).
 */
import { describe, expect, it } from "vitest";

import { derivarSaldo } from "@/lib/ai/custo/saldo";

const AGORA = new Date("2026-09-16T12:00:00.000Z");

describe("derivar o saldo", () => {
  it("leitura + recargas posteriores − consumo", () => {
    const r = derivarSaldo({
      lancamentos: [
        { tipo: "leitura", amount_usd: 69.9, occurred_at: "2026-09-01T00:00:00.000Z" },
        { tipo: "recarga", amount_usd: 40, occurred_at: "2026-09-08T00:00:00.000Z" },
      ],
      consumoDesdeLeituraUsd: 59.42,
      mediaDiariaUsd: 5.13,
      agora: AGORA,
    });
    expect(r.saldoUsd).toBeCloseTo(50.48, 4);
    expect(r.recargasDesdeLeituraUsd).toBe(40);
    expect(r.leitura?.occurred_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("recarga ANTERIOR à leitura não entra: já está dentro do valor conferido", () => {
    // Somá-la de novo contaria o mesmo dinheiro duas vezes — e o saldo pareceria
    // maior justamente quando está acabando.
    const r = derivarSaldo({
      lancamentos: [
        { tipo: "recarga", amount_usd: 30, occurred_at: "2026-08-25T00:00:00.000Z" },
        { tipo: "leitura", amount_usd: 69.9, occurred_at: "2026-09-01T00:00:00.000Z" },
      ],
      consumoDesdeLeituraUsd: 10,
      mediaDiariaUsd: 1,
      agora: AGORA,
    });
    expect(r.saldoUsd).toBeCloseTo(59.9, 4);
    expect(r.recargasDesdeLeituraUsd).toBe(0);
  });

  it("vale a leitura MAIS RECENTE, mesmo com outras antigas na lista", () => {
    const r = derivarSaldo({
      lancamentos: [
        { tipo: "leitura", amount_usd: 100, occurred_at: "2026-08-01T00:00:00.000Z" },
        { tipo: "leitura", amount_usd: 20, occurred_at: "2026-09-10T00:00:00.000Z" },
        { tipo: "recarga", amount_usd: 5, occurred_at: "2026-09-05T00:00:00.000Z" },
      ],
      consumoDesdeLeituraUsd: 2,
      mediaDiariaUsd: 1,
      agora: AGORA,
    });
    // A recarga de 05/09 é anterior à leitura de 10/09: fica de fora.
    expect(r.saldoUsd).toBe(18);
    expect(r.leitura?.amount_usd).toBe(20);
  });

  it("sem nenhuma leitura o saldo é NULO, e não zero", () => {
    const r = derivarSaldo({
      lancamentos: [{ tipo: "recarga", amount_usd: 50, occurred_at: "2026-09-01T00:00:00.000Z" }],
      consumoDesdeLeituraUsd: 0,
      mediaDiariaUsd: 3,
      agora: AGORA,
    });
    expect(r.saldoUsd).toBeNull();
    expect(r.duraAte).toBeNull();
    expect(r.leitura).toBeNull();
  });

  it("sem consumo medido não existe 'dura até' — nada de dura para sempre", () => {
    const r = derivarSaldo({
      lancamentos: [{ tipo: "leitura", amount_usd: 50, occurred_at: "2026-09-01T00:00:00.000Z" }],
      consumoDesdeLeituraUsd: 0,
      mediaDiariaUsd: 0,
      agora: AGORA,
    });
    expect(r.saldoUsd).toBe(50);
    expect(r.diasRestantes).toBeNull();
    expect(r.duraAte).toBeNull();
  });

  it("projeta a data pelo ritmo diário", () => {
    const r = derivarSaldo({
      lancamentos: [{ tipo: "leitura", amount_usd: 20, occurred_at: "2026-09-14T00:00:00.000Z" }],
      consumoDesdeLeituraUsd: 10,
      mediaDiariaUsd: 5,
      agora: AGORA,
    });
    expect(r.diasRestantes).toBeCloseTo(2, 6);
    expect(r.duraAte).toBe("2026-09-18T12:00:00.000Z");
  });

  it("saldo estourado não vira dias negativos: acabou é hoje", () => {
    const r = derivarSaldo({
      lancamentos: [{ tipo: "leitura", amount_usd: 10, occurred_at: "2026-09-01T00:00:00.000Z" }],
      consumoDesdeLeituraUsd: 25,
      mediaDiariaUsd: 5,
      agora: AGORA,
    });
    expect(r.saldoUsd).toBe(-15);
    expect(r.diasRestantes).toBe(0);
    expect(r.duraAte).toBe(AGORA.toISOString());
  });
});
