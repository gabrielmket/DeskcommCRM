import { describe, expect, it } from "vitest";

import { desfechoDaMeta, proximoDesfecho } from "@/lib/broadcast/desfecho";

/**
 * A ESCADA DA ENTREGA — e por que ela só sobe.
 *
 * A Meta avisa em etapas e NÃO garante a ordem: `read` chegando antes de
 * `delivered` acontece. Sem régua, o segundo evento sobrescreve o primeiro e a
 * campanha passa a mostrar "entregue" para quem já leu.
 *
 * E nada sobrescreve a falha: uma entrega que chega depois seria a plataforma
 * se contradizendo, e aceitar a segunda versão deixaria o estorno já lançado
 * sem a linha que o explica.
 *
 *     npx vitest run lib/broadcast/desfecho.test.ts
 */

describe("o vocabulário da Meta", () => {
  it("traduz o que interessa e ignora o resto", () => {
    expect(desfechoDaMeta("sent")).toBe("enviada");
    expect(desfechoDaMeta("delivered")).toBe("entregue");
    expect(desfechoDaMeta("read")).toBe("lida");
    expect(desfechoDaMeta("failed")).toBe("falhou");
    expect(desfechoDaMeta("deleted"), "status desconhecido não vira desfecho").toBeNull();
  });
});

describe("a escada só sobe", () => {
  it("enviada → entregue → lida avança", () => {
    expect(proximoDesfecho("enviada", "entregue")).toBe("entregue");
    expect(proximoDesfecho("entregue", "lida")).toBe("lida");
  });

  it("entrega que chega DEPOIS da leitura não rebaixa", () => {
    expect(
      proximoDesfecho("lida", "entregue"),
      "a Meta não garante a ordem: aceitar o atrasado mostraria 'entregue' para quem já leu",
    ).toBeNull();
  });

  it("o mesmo evento duas vezes não mexe em nada", () => {
    expect(proximoDesfecho("entregue", "entregue")).toBeNull();
  });

  it("a falha vence qualquer progresso anterior", () => {
    expect(proximoDesfecho("entregue", "falhou")).toBe("falhou");
  });

  it("NADA sobrescreve a falha — nem uma entrega tardia", () => {
    expect(
      proximoDesfecho("falhou", "entregue"),
      "aceitar a entrega depois da falha deixaria o estorno já lançado sem explicação",
    ).toBeNull();
    expect(proximoDesfecho("falhou", "lida")).toBeNull();
  });

  it("estornada é FINAL — o dinheiro já voltou", () => {
    expect(proximoDesfecho("estornada", "entregue")).toBeNull();
    expect(proximoDesfecho("estornada", "falhou")).toBeNull();
  });
});
