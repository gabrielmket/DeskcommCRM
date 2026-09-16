import { describe, expect, it, vi } from "vitest";

const enviados = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/channels", () => ({
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      enviados.push(envelope);
      return { externalId: "msg-1" };
    },
  }),
}));

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/notify-group";
import type { ActionCtx } from "@/lib/automation/types";

/**
 * O AVISO INTERNO NÃO PODE SAIR PARA UM CLIENTE.
 *
 * Esta ação é a única do motor cujo destinatário é digitado à mão. Todas as
 * outras derivam o destino do contato do evento — e por isso nenhuma delas pode
 * errar a pessoa. Aqui o operador cola um id, e o erro fácil é colar o telefone
 * de alguém no lugar do grupo: o aviso leva nome do lead, horário e o resumo da
 * qualificação que a IA apurou, e isso chegando ao próprio cliente é o pior
 * desfecho possível desta funcionalidade — pior que o aviso não sair.
 *
 * O segundo caso mede a outra ponta: número da API oficial da Meta não envia
 * para grupo. Sem a recusa explícita, a regra ficaria salva e "ativa", o envio
 * morreria num 4xx lá embaixo, e o time concluiria que o produto não avisa.
 *
 *     npx vitest run lib/automation/actions/notify-group.test.ts
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const CANAL = "bbbbbbbb-0000-4000-8000-00000000000b";
const GRUPO = "120363405136320907@g.us";

function ctxCom(sessao: Record<string, unknown> | null): ActionCtx {
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: sessao, error: null }) }),
        }),
      }),
    }),
  };
  return {
    admin: admin as unknown as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "rule-1",
    ruleName: "Reunião marcada → avisa o comercial",
    event: {} as ActionCtx["event"],
    context: { contact: { display_name: "Joana" } },
    requestId: "req-1",
  };
}

const wahaOk = { provider: "waha", waha_session_name: "org_abc", meta_phone_number_id: null, zernio_account_id: null };

describe("o aviso no grupo", () => {
  it("sai pelo canal do QR Code, com o texto renderizado", async () => {
    enviados.length = 0;
    const r = await getAction("notify_group")!.execute(ctxCom(wahaOk), {
      channel_session_id: CANAL,
      chat_id: GRUPO,
      template: "Reunião marcada com {{contact.display_name}}",
    });

    expect(r.status, "o aviso não saiu: o time só descobre a reunião quando o cliente entra na sala").toBe("success");
    expect(enviados, "nada chegou ao transporte").toHaveLength(1);
    expect(enviados[0]!.to, "o aviso foi para outro destino que não o grupo configurado").toBe(GRUPO);
    expect(
      enviados[0]!.body,
      "o texto saiu cru, com as chaves duplas: o template não foi renderizado com o contexto do evento",
    ).toBe("Reunião marcada com Joana");
  });

  it("RECUSA um destino que não é grupo — o telefone colado no lugar do id", async () => {
    enviados.length = 0;
    const r = await getAction("notify_group")!.execute(ctxCom(wahaOk), {
      channel_session_id: CANAL,
      chat_id: "5531999999999@c.us",
      template: "Reunião marcada com {{contact.display_name}}",
    });

    expect(
      r.status,
      "o aviso INTERNO — com resumo da qualificação e valor — foi enviado a um número de pessoa: se for o do próprio lead, ele lê o que a IA apurou sobre ele",
    ).toBe("failed");
    expect(enviados, "o transporte foi acionado mesmo com o destino recusado").toHaveLength(0);
  });

  it("RECUSA canal da API oficial — a Meta não entrega em grupo", async () => {
    enviados.length = 0;
    const meta = { provider: "meta_cloud", waha_session_name: null, meta_phone_number_id: "123", zernio_account_id: null };
    const r = await getAction("notify_group")!.execute(ctxCom(meta), {
      channel_session_id: CANAL,
      chat_id: GRUPO,
      template: "oi",
    });

    expect(
      r.status,
      "a ação aceitou um canal que não envia para grupo: a regra fica salva e ativa, o envio morre lá embaixo e o time conclui que o produto não avisa",
    ).toBe("failed");
    expect(r.error, "o motivo tem que dizer QUAL é o problema — 4xx de provider não explica nada a quem configurou").toBe(
      "canal_sem_grupo",
    );
  });

  it("RECUSA canal de outra organização (ou inexistente) — a leitura é escopada", async () => {
    const r = await getAction("notify_group")!.execute(ctxCom(null), {
      channel_session_id: CANAL,
      chat_id: GRUPO,
      template: "oi",
    });
    expect(r.status).toBe("failed");
    expect(r.error).toBe("canal_nao_encontrado");
  });
});
