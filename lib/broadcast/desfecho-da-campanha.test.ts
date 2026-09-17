import { describe, expect, it, vi } from "vitest";

import { aplicarDesfechoNaCampanha } from "@/lib/broadcast/desfecho-da-campanha";

/**
 * O WEBHOOK DA META CHEGANDO NA CAMPANHA — e o dinheiro voltando.
 *
 * O motor cobra quando a Meta ACEITA a mensagem, porque é isso que ela fatura.
 * A recusa definitiva vem depois, por webhook, às vezes minutos depois. Sem este
 * caminho, `broadcast_recipients` parava em `enviada` para sempre: a tela
 * mostrava a campanha inteira como enviada e nunca como entregue, e o cliente
 * pagava por mensagem que a própria Meta admitiu não ter entregue — erro que ele
 * só descobre conferindo o extrato, que é o pior lugar para se descobrir
 * qualquer coisa.
 *
 *     npx vitest run lib/broadcast/desfecho-da-campanha.test.ts
 */

const estornar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/broadcast/motor", () => ({ estornar }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

/**
 * Supabase de mentira: guarda o que foi gravado, na ordem.
 *
 * A ORDEM importa — é ela que prova que `estornada` foi escrita DEPOIS de
 * `falhou`, e não no lugar dela.
 */
function bancoFalso(linha: { id: string; status: string; preco_cents: number } | null) {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: linha }) }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ data: null, error: null }) };
      },
    }),
  } as never;
  return { admin, updates };
}

const ENTRADA = {
  organizationId: "org-1",
  externalId: "wamid.TESTE",
  statusDaMeta: "delivered",
};

describe("o que não é disparo passa reto", () => {
  it("status que não nos interessa nem consulta o banco", async () => {
    const { admin, updates } = bancoFalso(null);
    const r = await aplicarDesfechoNaCampanha(admin, { ...ENTRADA, statusDaMeta: "deleted" });
    expect(r).toBe("nao_e_disparo");
    expect(updates).toHaveLength(0);
  });

  it("conversa normal do inbox não vira linha de campanha", async () => {
    const { admin, updates } = bancoFalso(null);
    expect(
      await aplicarDesfechoNaCampanha(admin, ENTRADA),
      "a maior parte do tráfego NÃO é disparo — este caminho é um a mais, não o único",
    ).toBe("nao_e_disparo");
    expect(updates).toHaveLength(0);
  });
});

describe("a escada sobe no banco", () => {
  it("enviada → entregue grava", async () => {
    const { admin, updates } = bancoFalso({ id: "d1", status: "enviada", preco_cents: 12 });
    expect(await aplicarDesfechoNaCampanha(admin, ENTRADA)).toBe("atualizado");
    expect(updates[0]).toMatchObject({ status: "entregue" });
  });

  it("entrega atrasada depois da leitura NÃO grava nada", async () => {
    const { admin, updates } = bancoFalso({ id: "d1", status: "lida", preco_cents: 12 });
    expect(
      await aplicarDesfechoNaCampanha(admin, ENTRADA),
      "a Meta não garante a ordem; aceitar o atrasado mostraria 'entregue' a quem já leu",
    ).toBe("sem_mudanca");
    expect(updates).toHaveLength(0);
  });
});

describe("falhou depois de cobrada devolve o dinheiro", () => {
  const FALHA = { ...ENTRADA, statusDaMeta: "failed" };

  it("grava falhou, estorna e SÓ ENTÃO marca estornada", async () => {
    estornar.mockReset().mockResolvedValue(true);
    const { admin, updates } = bancoFalso({ id: "d1", status: "enviada", preco_cents: 12 });

    expect(await aplicarDesfechoNaCampanha(admin, FALHA)).toBe("estornado");

    expect(estornar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipientId: "d1", precoCents: 12 }),
    );
    expect(
      updates.map((u) => u.status),
      "`estornada` é o estado FINAL: parar em `falhou` deixaria indistinguível 'falhou e devolvemos' de 'falhou e o cliente pagou'",
    ).toEqual(["falhou", "estornada"]);
  });

  it("estorno que NÃO deu certo não mente dizendo que devolveu", async () => {
    estornar.mockReset().mockResolvedValue(false);
    const { admin, updates } = bancoFalso({ id: "d1", status: "enviada", preco_cents: 12 });

    expect(
      await aplicarDesfechoNaCampanha(admin, FALHA),
      "marcar `estornada` sem o crédito ter entrado é a plataforma mentindo sobre o extrato",
    ).toBe("atualizado");
    expect(updates.map((u) => u.status)).toEqual(["falhou"]);
  });

  it("mensagem grátis (preço zero) falha sem estorno — não há o que devolver", async () => {
    estornar.mockReset();
    const { admin, updates } = bancoFalso({ id: "d1", status: "enviada", preco_cents: 0 });

    expect(await aplicarDesfechoNaCampanha(admin, FALHA)).toBe("atualizado");
    expect(estornar, "estorno de zero seria lançamento de nada no extrato").not.toHaveBeenCalled();
    expect(updates.map((u) => u.status)).toEqual(["falhou"]);
  });

  it("a MESMA falha chegando duas vezes não estorna duas vezes", async () => {
    estornar.mockReset().mockResolvedValue(true);
    const { admin, updates } = bancoFalso({ id: "d1", status: "estornada", preco_cents: 12 });

    expect(
      await aplicarDesfechoNaCampanha(admin, FALHA),
      "a Meta reentrega em backoff: sem esta trava, o cliente receberia crédito a cada reentrega",
    ).toBe("sem_mudanca");
    expect(estornar).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
