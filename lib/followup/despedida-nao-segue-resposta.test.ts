import { describe, expect, it, vi } from "vitest";

/**
 * A RESPOSTA DO LEAD NÃO PODE EMPURRAR A RÉGUA PARA A DESPEDIDA.
 *
 * ## O caso, medido em 17/09/2026
 *
 * O contato escreveu no canal oficial da Meta às 20:47:36. **Seis segundos
 * depois**, recebeu pelo outro canal:
 *
 *     "Vou parar por aqui pra não te incomodar. Se fizer sentido mais pra
 *      frente, é só me responder por aqui."
 *
 * ## O diagnóstico ÓBVIO estava errado, e é por isso que este arquivo existe
 *
 * A primeira explicação — "a régua não viu a resposta porque olha a conversa
 * errada, e o contato tem duas" — não se sustenta na leitura: TODA a detecção
 * já é por CONTATO, de propósito, aqui e em `aplicar-inbound`, no
 * `silence-sweep`, no `cancelPendingCronsForLead` e no gatilho do banco. O
 * comentário de `engine.ts` diz por extenso que filtrar pela conversa
 * "esconde o SIM".
 *
 * O que aconteceu é o **contrário, e é pior**: a resposta FOI vista, acordou a
 * espera (nó `wait`, que fica `active` com timer) e o motor seguiu para o passo
 * seguinte — que era a despedida. A resposta do lead **empurrou** a régua a se
 * despedir dele.
 *
 * Os seis segundos vêm de o webhook da Meta rodar o pipeline INLINE, dentro da
 * própria request, em vez de esperar o cron.
 *
 * ## A regra que este teste tranca
 *
 * `cancel_on_reply` já era consultado nos `waiting_reply`. A espera ativa ficou
 * de fora quando o laço dela nasceu — e é justamente nela que mora o `wait` que
 * antecede a despedida. Quem NÃO ligou o knob continua sendo acordado: isto não
 * muda o padrão, só para de ignorá-lo num dos dois lados.
 *
 *     npx vitest run lib/followup/despedida-nao-segue-resposta.test.ts
 */

vi.mock("@/lib/channels/contato-por-telefone", () => ({
  // O contato e seus "gêmeos" (as duas grafias do nono dígito). Irrelevante
  // para esta regra, e necessário para o caminho rodar.
  idsDoContatoEGemeos: async (_db: unknown, _org: string, id: string) => [id],
}));

const { applyReactivityEvent } = await import("@/lib/followup/reactivity");

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const CONTATO = "cccccccc-0000-4000-8000-00000000000c";

type Enrollment = {
  id: string;
  status: "active" | "waiting_reply";
  current_node_id: string;
  steps_taken: number;
  pointer_id: string;
  handoff_policy: "pause" | "cancel" | "allow";
  trigger_config: unknown;
};

function bancoFalso(enrollments: Enrollment[]) {
  const eventos: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const db = {
    loadConversationContactId: async () => CONTATO,
    loadContactBlocked: async () => false,
    loadLiveEnrollmentsForContact: async () => enrollments,
    insertEnrollmentEvent: async (e: { event_type: string; payload: Record<string, unknown> }) => {
      eventos.push({ event_type: e.event_type, payload: e.payload });
      return { inserted: true };
    },
    updateEnrollment: async (id: string, _org: string, patch: Record<string, unknown>) => {
      patches.push({ id, patch });
    },
    agoraNoBanco: async () => "2026-09-17T20:47:42.000Z",
  } as never;

  return { db, eventos, patches };
}

const inbound = {
  id: "evt-1",
  organization_id: ORG,
  event_type: "message.received",
  entity_kind: "conversation",
  entity_id: "conv-do-canal-oficial",
  payload: { contact_id: CONTATO, direction: "inbound" },
  metadata: {},
  consumed_by: [],
  attempts: 0,
} as never;

const esperando = (extra: Partial<Enrollment> = {}): Enrollment => ({
  id: "enr-1",
  // `active` é o estado do nó `wait` com timer — o que antecede a despedida.
  status: "active",
  current_node_id: "wait-3-dias",
  steps_taken: 4,
  pointer_id: "ptr-1",
  handoff_policy: "allow",
  trigger_config: { kind: "manual", cancel_on_reply: true },
  ...extra,
});

describe("espera ativa respeita cancel_on_reply", () => {
  it("o lead respondeu e a régua PARA — não avança para o passo seguinte", async () => {
    const { db, eventos, patches } = bancoFalso([esperando()]);

    const r = await applyReactivityEvent(db, () => new Date("2026-09-17T20:47:42Z"), inbound);

    expect(r.reacted).toBe(1);
    expect(
      eventos.map((e) => e.event_type),
      "acordar aqui faria o motor seguir para o próximo passo — que era a despedida",
    ).toEqual(["reactivity_replied"]);
    expect(patches[0]?.patch).toMatchObject({ status: "cancelled", outcome: "replied", cancel_reason: "cancel_on_reply" });
  });

  it("sem o knob ligado, continua acordando como sempre", async () => {
    const { db, eventos, patches } = bancoFalso([
      esperando({ trigger_config: { kind: "manual", cancel_on_reply: false } }),
    ]);

    await applyReactivityEvent(db, () => new Date("2026-09-17T20:47:42Z"), inbound);

    expect(
      eventos.some((e) => e.event_type === "reactivity_replied"),
      "isto não muda o padrão: só para de ignorar o knob num dos dois lados",
    ).toBe(false);
    expect(patches.every((p) => p.patch.status !== "cancelled")).toBe(true);
  });

  it("`waiting_reply` segue como antes — o lado que já funcionava", async () => {
    const { db, patches } = bancoFalso([esperando({ status: "waiting_reply" })]);

    await applyReactivityEvent(db, () => new Date("2026-09-17T20:47:42Z"), inbound);

    expect(patches[0]?.patch).toMatchObject({ status: "cancelled", outcome: "replied", cancel_reason: "cancel_on_reply" });
  });

  it("config sem o campo NÃO é tratada como ligada", async () => {
    const { db, patches } = bancoFalso([esperando({ trigger_config: { kind: "manual" } })]);

    await applyReactivityEvent(db, () => new Date("2026-09-17T20:47:42Z"), inbound);

    expect(
      patches.every((p) => p.patch.status !== "cancelled"),
      "ausência de knob é 'não pediram', nunca 'pediram'",
    ).toBe(true);
  });
});
