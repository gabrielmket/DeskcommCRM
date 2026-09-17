import { describe, expect, it } from "vitest";

import { margemDoDisparo, pisoDoPreco } from "@/lib/broadcast/margem";

/**
 * O ERRO DE PREÇO QUE SÓ APARECE NA FATURA.
 *
 * O tour do autor (17/09/2026) afirma que a Meta dá "mil mensagens grátis" por
 * mês. O gratuito dela é de conversa de SERVIÇO — a que o cliente inicia.
 * Template de MARKETING, que é o que um disparador manda, é cobrado desde a
 * primeira. Quem precifica pela leitura errada vende abaixo do custo nas mil
 * primeiras de cada cliente e descobre um mês depois.
 *
 *     npx vitest run lib/broadcast/margem.test.ts
 */

const MARKETING = { categoria: "marketing" as const, precoCents: 8, gratuitasPorMes: 0 };
const SERVICO = { categoria: "service" as const, precoCents: 5, gratuitasPorMes: 1000 };

describe("a margem do disparo", () => {
  it("marketing NÃO tem cota gratuita — cobra desde a primeira", () => {
    const m = margemDoDisparo({ mensagens: 1000, precoAoClienteCents: 12, tarifa: MARKETING });
    expect(m.gratuitas, "supor cota gratuita em marketing é o erro que faz vender no prejuízo").toBe(0);
    expect(m.custoCents).toBe(1000 * 8);
    expect(m.receitaCents).toBe(1000 * 12);
    expect(m.margemCents).toBe(4000);
  });

  it("serviço tem cota, e ela some conforme o mês anda", () => {
    const primeiro = margemDoDisparo({ mensagens: 600, precoAoClienteCents: 10, tarifa: SERVICO });
    expect(primeiro.gratuitas).toBe(600);
    expect(primeiro.custoCents).toBe(0);

    // Segundo lote do MESMO mês: só sobram 400 de graça.
    const segundo = margemDoDisparo({
      mensagens: 600,
      precoAoClienteCents: 10,
      tarifa: SERVICO,
      jaUsadasNoMes: 600,
    });
    expect(
      segundo.gratuitas,
      "ignorar o que já foi gasto faria toda campanha do mês achar que tem a cota inteira",
    ).toBe(400);
    expect(segundo.custoCents).toBe(200 * 5);
  });

  it("SEM tarifa declarada, o custo é desconhecido — e desconhecido não é zero", () => {
    const m = margemDoDisparo({ mensagens: 100, precoAoClienteCents: 12, tarifa: null });
    expect(
      m.margemPercentual,
      "custo zero pintaria margem de 100% numa tela que serve para decidir preço",
    ).toBeNull();
    expect(m.cobradasPelaMeta, "todas são tratadas como cobráveis, que é o pior caso").toBe(100);
  });

  it("preço abaixo do custo dá margem NEGATIVA, e a conta mostra isso", () => {
    const m = margemDoDisparo({ mensagens: 100, precoAoClienteCents: 5, tarifa: MARKETING });
    expect(m.margemCents).toBe(100 * 5 - 100 * 8);
    expect(m.margemCents).toBeLessThan(0);
  });

  it("sem receita, a porcentagem é NULA — não 0%", () => {
    const m = margemDoDisparo({ mensagens: 100, precoAoClienteCents: 0, tarifa: MARKETING });
    expect(m.margemPercentual).toBeNull();
    expect(m.margemCents, "cortesia custa dinheiro: a margem é o custo negativo").toBe(-800);
  });
});

describe("o piso do preço", () => {
  it("é o que a Meta cobra — abaixo disso é prejuízo por mensagem", () => {
    expect(pisoDoPreco(MARKETING)).toBe(8);
  });

  it("sem tarifa declarada não há piso a afirmar", () => {
    expect(pisoDoPreco(null)).toBeNull();
  });
});
