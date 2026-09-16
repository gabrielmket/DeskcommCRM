import { describe, expect, it } from "vitest";

import { creditoAcabando, derivarSaldo, podeDisparar } from "@/lib/carteira/saldo";

/**
 * A CONTA DO DINHEIRO DO CLIENTE.
 *
 * Esta é a única parte do disparador em que errar custa dinheiro de alguém —
 * para mais (cobrar duas vezes) ou para menos (mandar de graça). Os casos aqui
 * são escritos pelo desfecho que eles evitam, e não pela função que exercitam.
 *
 *     npx vitest run lib/carteira/saldo.test.ts
 */

const em = (dia: string) => `2026-09-${dia}T12:00:00.000Z`;

describe("o saldo sai da soma do extrato", () => {
  it("carteira vazia tem saldo ZERO — e zero aqui é fato, não ausência de informação", () => {
    const s = derivarSaldo([]);
    expect(
      s.saldo_cents,
      "carteira nova apareceu com saldo que ninguém colocou",
    ).toBe(0);
  });

  it("crédito, débito e estorno entram com o sinal do TIPO, nunca do número", () => {
    const s = derivarSaldo([
      { tipo: "credito", amount_cents: 50_000, occurred_at: em("01") },
      { tipo: "debito", amount_cents: 12_000, occurred_at: em("02") },
      { tipo: "estorno", amount_cents: 2_000, occurred_at: em("03") },
    ]);
    expect(s.saldo_cents, "a soma do extrato não bate: o cliente vê um saldo que não é o dele").toBe(40_000);
    expect(s.creditado_cents).toBe(50_000);
    expect(s.debitado_cents).toBe(12_000);
    expect(s.estornado_cents).toBe(2_000);
  });

  it("valor corrompido NÃO vira saldo plausível — fica de fora e a contagem denuncia", () => {
    const s = derivarSaldo([
      { tipo: "credito", amount_cents: 10_000, occurred_at: em("01") },
      { tipo: "debito", amount_cents: -5_000 as number, occurred_at: em("02") },
      { tipo: "credito", amount_cents: Number.NaN, occurred_at: em("03") },
    ]);
    expect(
      s.saldo_cents,
      "um débito negativo virou crédito: dado corrompido produziu saldo maior, e nada na tela denunciaria",
    ).toBe(10_000);
    expect(s.lancamentos, "as linhas ignoradas não aparecem na contagem — a diferença some").toBe(1);
  });
});

describe("a trava de saldo, ANTES do primeiro envio", () => {
  it("sem preço acordado, RECUSA — não supõe zero nem inventa um valor", () => {
    const v = podeDisparar({ saldoCents: 100_000, precoPorMensagemCents: null, destinatarios: 10 });
    expect(
      v.pode,
      "disparou sem preço combinado: ou saiu de graça, ou cobrou um valor que ninguém acordou",
    ).toBe(false);
    expect(v.motivo).toBe("sem_preco_acordado");
  });

  it("preço ZERO é decisão comercial declarada e passa — cortesia não é bug", () => {
    const v = podeDisparar({ saldoCents: 0, precoPorMensagemCents: 0, destinatarios: 4_000 });
    expect(v.pode, "cortesia digitada como zero foi tratada como falta de preço").toBe(true);
    expect(v.mensagens_que_cabem).toBe(4_000);
  });

  it("saldo que não cobre a lista inteira RECUSA — e diz quantas cabem", () => {
    // R$ 50,00 de saldo, R$ 0,12 por mensagem, 4.000 destinatários.
    const v = podeDisparar({ saldoCents: 5_000, precoPorMensagemCents: 12, destinatarios: 4_000 });
    expect(
      v.pode,
      "a lista começou sem caber: para no meio, metade dos contatos recebeu, e ninguém sabe quem",
    ).toBe(false);
    expect(
      v.mensagens_que_cabem,
      "recusar sem dizer quantas cabem deixa a pessoa sem escolha entre cortar a lista e recarregar",
    ).toBe(416);
    expect(v.falta_cents, "não diz quanto falta para recarregar o valor certo").toBe(4_000 * 12 - 5_000);
  });

  it("saldo exato para a lista inteira PASSA — o limite não pode ser exclusivo", () => {
    const v = podeDisparar({ saldoCents: 1_200, precoPorMensagemCents: 12, destinatarios: 100 });
    expect(
      v.pode,
      "quem recarregou o valor exato foi barrado: a conta bate e a tela diz que não",
    ).toBe(true);
    expect(v.falta_cents).toBe(0);
  });

  it("saldo negativo não vira crédito por arredondamento", () => {
    const v = podeDisparar({ saldoCents: -300, precoPorMensagemCents: 12, destinatarios: 1 });
    expect(v.pode).toBe(false);
    expect(v.mensagens_que_cabem, "saldo devedor ofereceu mensagens").toBe(0);
  });
});

describe("o aviso de crédito acabando é OUTRA pergunta que a trava", () => {
  it("sem piso configurado, não avisa (e não inventa um)", () => {
    expect(creditoAcabando(500, null)).toBe(false);
  });

  it("no piso exato JÁ avisa — avisar depois de cruzar é avisar tarde", () => {
    expect(creditoAcabando(10_000, 10_000)).toBe(true);
  });

  it("acima do piso mas sem cobrir a lista: a trava recusa e o aviso fica quieto", () => {
    // As duas coisas ao mesmo tempo, que é o caso em que fundi-las mentiria.
    expect(creditoAcabando(50_000, 10_000)).toBe(false);
    expect(
      podeDisparar({ saldoCents: 50_000, precoPorMensagemCents: 12, destinatarios: 10_000 }).pode,
      "a tela diria 'tudo certo' para quem não tem saldo para a lista de hoje",
    ).toBe(false);
  });
});
