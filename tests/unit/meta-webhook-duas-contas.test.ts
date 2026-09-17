import { describe, expect, it, vi } from "vitest";

import { donoDoEvento } from "@/lib/channels/meta/dono-do-evento";

/**
 * DUAS CONTAS WHATSAPP NO MESMO APP — o caso que o desenho antigo perdia.
 *
 * A URL de callback do app da Meta é UMA SÓ, e o token nela aponta para UMA
 * sessão. Com uma conta, tudo bem. Com duas, aparecem dois buracos:
 *
 *  1. Os eventos da segunda chegam com o token da primeira, a rota via que a
 *     WABA não batia e **descartava em silêncio** — nenhum erro, nenhuma linha,
 *     a mensagem simplesmente não existia.
 *  2. Se o canal daquele token for ARQUIVADO — natural ao trocar o número de
 *     teste pelo definitivo — o token para de resolver e a rota respondia 404
 *     antes de olhar o corpo, derrubando TODAS as contas de uma vez.
 *
 * Não é caso de borda: é o desenho inteiro do cadastro embutido, em que cada
 * cliente liga a WABA dele ao NOSSO app e todas apontam para a mesma URL. Do
 * jeito antigo, só o primeiro cliente do produto receberia mensagem — e só até
 * alguém arquivar o canal dele.
 *
 * Medido em 17/09/2026, quando a conta "Time Company" (4660237264244026) entrou
 * ao lado da conta de teste.
 *
 *     npx vitest run tests/unit/meta-webhook-duas-contas.test.ts
 */

const WABA_DO_TOKEN = "1838306976824531";
const WABA_NOVA = "4660237264244026";
const ORG_DO_TOKEN = "aaaaaaaa-0000-4000-8000-00000000000a";
const ORG_NOVA = "bbbbbbbb-0000-4000-8000-00000000000b";

const SESSAO_DO_TOKEN = {
  id: "sessao-1",
  organizationId: ORG_DO_TOKEN,
  wabaId: WABA_DO_TOKEN,
};
const SESSAO_NOVA = { id: "sessao-2", organizationId: ORG_NOVA, wabaId: WABA_NOVA };

describe("o dono do evento sai da WABA, não do token", () => {
  it("evento da conta do PRÓPRIO token nem consulta a tabela", async () => {
    const porWaba = vi.fn();
    const dono = await donoDoEvento({
      sessionDoToken: SESSAO_DO_TOKEN,
      wabaDoEvento: WABA_DO_TOKEN,
      porWaba,
    });
    expect(dono?.organizationId).toBe(ORG_DO_TOKEN);
    expect(porWaba, "consulta por WABA é o caminho de exceção, não o normal").not.toHaveBeenCalled();
  });

  it("evento da conta NOVA acha a organização dela", async () => {
    const porWaba = vi.fn(async () => SESSAO_NOVA);
    const dono = await donoDoEvento({
      sessionDoToken: SESSAO_DO_TOKEN,
      wabaDoEvento: WABA_NOVA,
      porWaba,
    });
    expect(
      dono?.organizationId,
      "a mensagem do número novo era descartada em silêncio — sem erro, sem linha, sem existir",
    ).toBe(ORG_NOVA);
  });

  it("TOKEN ÓRFÃO (canal arquivado) não derruba as outras contas", async () => {
    const porWaba = vi.fn(async () => SESSAO_NOVA);
    const dono = await donoDoEvento({
      sessionDoToken: null,
      wabaDoEvento: WABA_NOVA,
      porWaba,
    });
    expect(
      dono?.organizationId,
      "arquivar o canal de teste fazia a rota devolver 404 para TODA conta, antes de olhar o corpo",
    ).toBe(ORG_NOVA);
  });

  it("WABA que não é de nenhuma sessão continua ignorada", async () => {
    const dono = await donoDoEvento({
      sessionDoToken: SESSAO_DO_TOKEN,
      wabaDoEvento: "9999999999",
      porWaba: async () => null,
    });
    expect(dono, "ignorar conta desconhecida continua certo: é evento que não é nosso").toBeNull();
  });

  it("evento SEM waba fica com o dono do token — instalação de uma conta só", async () => {
    const porWaba = vi.fn();
    const dono = await donoDoEvento({
      sessionDoToken: SESSAO_DO_TOKEN,
      wabaDoEvento: null,
      porWaba,
    });
    expect(
      dono?.organizationId,
      "a Meta nem sempre carimba a WABA; exigir igualdade quebraria quem tem uma conta só",
    ).toBe(ORG_DO_TOKEN);
    expect(porWaba).not.toHaveBeenCalled();
  });

  it("sessão ANTIGA sem waba_id gravado continua recebendo o que é dela", async () => {
    const porWaba = vi.fn();
    const dono = await donoDoEvento({
      sessionDoToken: { id: "s", organizationId: ORG_DO_TOKEN, wabaId: null },
      wabaDoEvento: WABA_DO_TOKEN,
      porWaba,
    });
    expect(
      dono?.organizationId,
      "canal ligado antes de guardarmos waba_id não pode virar silêncio no upgrade",
    ).toBe(ORG_DO_TOKEN);
    expect(porWaba).not.toHaveBeenCalled();
  });

  it("sem token E sem waba não há o que perguntar", async () => {
    const porWaba = vi.fn();
    expect(
      await donoDoEvento({ sessionDoToken: null, wabaDoEvento: null, porWaba }),
    ).toBeNull();
    expect(porWaba, "consulta com WABA vazia seria varredura de tabela à toa").not.toHaveBeenCalled();
  });
});
