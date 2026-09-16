/**
 * META × REALIDADE — as regras de atribuição, que é onde dá briga no fim do mês.
 *
 * O que estes casos prendem:
 *
 *  · a venda conta para quem FECHOU nas métricas de receita, e para quem
 *    ORIGINOU em `receita_originada`. São perguntas diferentes, não contagem
 *    dobrada — e somá-las numa só é que inventaria dinheiro;
 *  · venda sem natureza declarada NÃO é empurrada para "avulso": ela aparece
 *    separada, porque escolher um lado por omissão inventa a divisão que o
 *    relatório existe para mostrar;
 *  · a meta do agente de IA mede o que ele controla — reunião marcada;
 *  · contrato anualizado só soma com prazo declarado: multiplicar por um prazo
 *    suposto inflaria o número mais citado do relatório com um palpite.
 */
import { describe, expect, it } from "vitest";

import {
  progressoDaMeta,
  realizadoDaMeta,
  resumoDasReunioes,
  resumoDoMes,
  type LeadFechadoComPrazo,
  type Meta,
  type ReuniaoMarcada,
} from "@/lib/crm/metas/progresso";

const CLOSER = "11111111-1111-4111-8111-111111111111";
const SDR = "22222222-2222-4222-8222-222222222222";
const AGENTE = "33333333-3333-4333-8333-333333333333";
const COMERCIAL = "44444444-4444-4444-8444-444444444444";
const FUNIL_DO_SDR = "55555555-5555-4555-8555-555555555555";

function venda(over: Partial<LeadFechadoComPrazo> = {}): LeadFechadoComPrazo {
  return {
    status: "won",
    value_cents: 100_000,
    revenue_kind: "recorrente",
    owner_user_id: CLOSER,
    originated_by_user_id: SDR,
    pipeline_id: COMERCIAL,
    closed_at: "2026-09-10T12:00:00.000Z",
    recurring_months: null,
    ...over,
  };
}

function meta(over: Partial<Meta> = {}): Meta {
  return {
    id: "meta-1",
    periodo: "2026-09-01",
    metrica: "receita_total",
    alvo_cents: 1_000_000,
    alvo_quantidade: null,
    user_id: null,
    agent_id: null,
    ...over,
  };
}

describe("o que conta para a meta de receita", () => {
  it("só venda GANHA entra", () => {
    const leads = [venda(), venda({ status: "open" }), venda({ status: "lost" })];
    expect(realizadoDaMeta(meta(), leads, [])).toBe(100_000);
  });

  it("só o que fechou NO MÊS da meta", () => {
    const leads = [venda(), venda({ closed_at: "2026-08-31T23:00:00.000Z" })];
    expect(realizadoDaMeta(meta(), leads, [])).toBe(100_000);
  });

  it("meta de pessoa conta o que ELA fechou, não o time inteiro", () => {
    const leads = [venda(), venda({ owner_user_id: "outro" })];
    expect(realizadoDaMeta(meta({ user_id: CLOSER }), leads, [])).toBe(100_000);
  });

  it("recorrente e avulso não se misturam", () => {
    const leads = [
      venda({ revenue_kind: "recorrente", value_cents: 99_000 }),
      venda({ revenue_kind: "avulso", value_cents: 200_000 }),
    ];
    expect(realizadoDaMeta(meta({ metrica: "receita_recorrente" }), leads, [])).toBe(99_000);
    expect(realizadoDaMeta(meta({ metrica: "receita_avulsa" }), leads, [])).toBe(200_000);
    expect(realizadoDaMeta(meta({ metrica: "receita_total" }), leads, [])).toBe(299_000);
  });

  it("venda sem natureza declarada não vira avulsa por omissão", () => {
    const leads = [venda({ revenue_kind: null, value_cents: 50_000 })];
    expect(realizadoDaMeta(meta({ metrica: "receita_avulsa" }), leads, [])).toBe(0);
    expect(realizadoDaMeta(meta({ metrica: "receita_recorrente" }), leads, [])).toBe(0);
    // No total ela conta — o dinheiro entrou.
    expect(realizadoDaMeta(meta({ metrica: "receita_total" }), leads, [])).toBe(50_000);
  });

  it("valor nulo não vira NaN", () => {
    expect(realizadoDaMeta(meta(), [venda({ value_cents: null })], [])).toBe(0);
  });
});

describe("a participação de quem originou", () => {
  it("o SDR leva a venda que ELE originou, fechada por outra pessoa", () => {
    const leads = [venda({ owner_user_id: CLOSER, originated_by_user_id: SDR })];
    expect(realizadoDaMeta(meta({ metrica: "receita_originada", user_id: SDR }), leads, [])).toBe(
      100_000,
    );
  });

  it("não é contagem dobrada: a mesma venda também conta para quem fechou", () => {
    const leads = [venda()];
    const doCloser = realizadoDaMeta(meta({ metrica: "receita_total", user_id: CLOSER }), leads, []);
    const doSdr = realizadoDaMeta(meta({ metrica: "receita_originada", user_id: SDR }), leads, []);
    // São perguntas diferentes sobre a MESMA venda — "quanto ele fechou" e
    // "quanto nasceu do trabalho dele" —, e por isso as duas dão 100 mil.
    expect(doCloser).toBe(100_000);
    expect(doSdr).toBe(100_000);
  });

  it("venda sem origem registrada não é creditada a ninguém", () => {
    const leads = [venda({ originated_by_user_id: null })];
    expect(realizadoDaMeta(meta({ metrica: "receita_originada", user_id: SDR }), leads, [])).toBe(0);
  });

  it("originada sem responsável devolve zero, e não o total da casa", () => {
    expect(realizadoDaMeta(meta({ metrica: "receita_originada" }), [venda()], [])).toBe(0);
  });
});

describe("a meta de reunião — do SDR e do agente", () => {
  const reunioes: ReuniaoMarcada[] = [
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-02T10:00:00Z", status: "completed" },
    { marcada_por_user_id: null, marcada_por_agent_id: AGENTE, created_at: "2026-09-03T10:00:00Z", status: "no_show" },
    { marcada_por_user_id: null, marcada_por_agent_id: AGENTE, created_at: "2026-09-04T10:00:00Z", status: "confirmed" },
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-08-30T10:00:00Z", status: "completed" },
  ];

  it("conta as do SDR no mês", () => {
    const m = meta({ metrica: "reunioes", alvo_cents: null, alvo_quantidade: 10, user_id: SDR });
    expect(realizadoDaMeta(m, [], reunioes)).toBe(1);
  });

  it("o agente de IA tem a meta dele, medida pelo que ele controla", () => {
    const m = meta({ metrica: "reunioes", alvo_cents: null, alvo_quantidade: 30, agent_id: AGENTE });
    expect(realizadoDaMeta(m, [], reunioes)).toBe(2);
  });

  it("a meta da casa soma gente e IA", () => {
    const m = meta({ metrica: "reunioes", alvo_cents: null, alvo_quantidade: 50 });
    expect(realizadoDaMeta(m, [], reunioes)).toBe(3);
  });
});

describe("o progresso que a tela desenha", () => {
  it("fração, falta e alvo saem coerentes", () => {
    const p = progressoDaMeta(meta({ alvo_cents: 400_000 }), [venda()], []);
    expect(p.realizado).toBe(100_000);
    expect(p.alvo).toBe(400_000);
    expect(p.fracao).toBeCloseTo(0.25, 6);
    expect(p.falta).toBe(300_000);
  });

  it("bater mais que a meta passa de 100% — e falta vira zero, nunca negativo", () => {
    const p = progressoDaMeta(meta({ alvo_cents: 50_000 }), [venda()], []);
    expect(p.fracao).toBeCloseTo(2, 6);
    expect(p.falta).toBe(0);
  });

  it("alvo zerado por dado velho não vira divisão por zero", () => {
    const p = progressoDaMeta(meta({ alvo_cents: 0 }), [venda()], []);
    expect(p.fracao).toBe(0);
  });
});

describe("o fechamento do mês", () => {
  it("separa as três naturezas e declara o que não foi classificado", () => {
    const leads = [
      venda({ revenue_kind: "recorrente", value_cents: 99_000 }),
      venda({ revenue_kind: "avulso", value_cents: 200_000 }),
      venda({ revenue_kind: null, value_cents: 30_000 }),
    ];
    const r = resumoDoMes(leads, "2026-09-01");
    expect(r.recorrente).toBe(99_000);
    expect(r.avulso).toBe(200_000);
    expect(r.naoClassificada).toBe(30_000);
    expect(r.total).toBe(329_000);
    expect(r.vendasSemClassificacao).toBe(1);
  });

  it("contrato anualizado só soma com prazo declarado", () => {
    const leads = [
      venda({ revenue_kind: "recorrente", value_cents: 99_000, recurring_months: 12 }),
      venda({ revenue_kind: "recorrente", value_cents: 50_000, recurring_months: null }),
    ];
    const r = resumoDoMes(leads, "2026-09-01");
    // 99 mil × 12 = 1,188 mi. A segunda não entra: o prazo não é sabido, e supor
    // 12 meses inflaria o número mais citado do relatório com um palpite.
    expect(r.contratoRecorrenteCents).toBe(1_188_000);
    expect(r.recorrente).toBe(149_000);
  });

  it("mês sem venda devolve zeros, não NaN", () => {
    expect(resumoDoMes([], "2026-09-01")).toMatchObject({ total: 0, vendasSemClassificacao: 0 });
  });
});

/**
 * GANHAR NEM SEMPRE É RECEITA.
 *
 * O desenho da casa (declarado pelo dono em 16/09): o funil do SDR VENCE quando
 * a reunião é agendada — o card passa ao comercial e o dinheiro ainda não
 * existe. Contar esse ganho como receita anuncia faturamento que não entrou, e
 * é justamente o número mais citado do relatório.
 *
 * A régua não pode ser adivinhada: numa casa com um funil só, ganhar É vender,
 * e os dois casos usam o mesmo `is_won`. Por isso quem declara é o FUNIL, e a
 * ausência de declaração mantém o comportamento de sempre.
 */
describe("receita conta só nos funis em que vencer é dinheiro", () => {
  const noSdr = venda({ pipeline_id: FUNIL_DO_SDR, value_cents: 500_000 });
  const noComercial = venda({ pipeline_id: COMERCIAL, value_cents: 300_000 });
  const soComercial = new Set([COMERCIAL]);

  it("sem declaração, tudo conta — quem tem um funil só não muda de comportamento", () => {
    expect(realizadoDaMeta(meta(), [noSdr, noComercial], [])).toBe(800_000);
  });

  it("com o funil do SDR fora, só o comercial vira receita", () => {
    expect(
      realizadoDaMeta(meta(), [noSdr, noComercial], [], soComercial),
      "a reunião agendada no funil do SDR entrou como receita: o relatório anuncia dinheiro que ainda não entrou",
    ).toBe(300_000);
  });

  it("a participação do SDR também respeita a régua — senão ele receberia crédito pela própria reunião", () => {
    const m = meta({ metrica: "receita_originada", user_id: SDR });
    expect(
      realizadoDaMeta(m, [noSdr, noComercial], [], soComercial),
      "o ganho do próprio funil do SDR virou 'receita originada' por ele: crédito em cima de dinheiro que não existe",
    ).toBe(300_000);
  });

  it("o RESUMO usa a mesma régua — dois totais do mesmo mês seria pior que um errado", () => {
    expect(resumoDoMes([noSdr, noComercial], "2026-09-01", soComercial).total).toBe(300_000);
  });

  it("a meta de REUNIÕES não é filtrada por funil — senão a meta do SDR zeraria", () => {
    const m = meta({ metrica: "reunioes", alvo_cents: null, alvo_quantidade: 10 });
    const reunioes: ReuniaoMarcada[] = [
      { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-10T12:00:00.000Z", status: "confirmed" },
    ];
    expect(
      realizadoDaMeta(m, [], reunioes, soComercial),
      "filtrar reunião por funil de receita zeraria justamente a meta do SDR",
    ).toBe(1);
  });
});

/**
 * MARCAR NÃO É COMPARECER.
 *
 * `reunioes` sozinha esconde os dois comportamentos opostos que importam: o SDR
 * que marca bem e leva faltas do cliente, e o que marca com qualquer um para
 * bater número e deixa a agenda do closer virar sala vazia. Com as duas
 * métricas lado a lado, os dois aparecem.
 *
 * A falta NÃO é descontada de `reunioes`, e é decisão: descontar puniria o SDR
 * pelo cliente que não apareceu.
 */
describe("reunião realizada é outra medida que reunião marcada", () => {
  const agenda: ReuniaoMarcada[] = [
    // Duas do SDR: uma aconteceu, uma o cliente faltou.
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-02T10:00:00Z", status: "completed" },
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-03T10:00:00Z", status: "no_show" },
    // E uma que ainda vai acontecer.
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-20T10:00:00Z", status: "confirmed" },
  ];

  it("a falta NÃO é descontada das marcadas", () => {
    const m = meta({ metrica: "reunioes", alvo_cents: null, alvo_quantidade: 10, user_id: SDR });
    expect(
      realizadoDaMeta(m, [], agenda),
      "a falta do cliente foi descontada da meta do SDR: ele é punido por algo que não controla",
    ).toBe(3);
  });

  it("realizadas conta só o que ACONTECEU", () => {
    const m = meta({
      metrica: "reunioes_realizadas",
      alvo_cents: null,
      alvo_quantidade: 10,
      user_id: SDR,
    });
    expect(
      realizadoDaMeta(m, [], agenda),
      "entrou reunião que faltou ou que ainda nem aconteceu na conta de realizadas",
    ).toBe(1);
  });

  it("a taxa de comparecimento ignora o que ainda não tem desfecho", () => {
    const r = resumoDasReunioes(agenda, "2026-09-01");
    expect(r.marcadas).toBe(3);
    expect(r.realizadas).toBe(1);
    expect(r.faltas).toBe(1);
    expect(r.sem_desfecho, "a reunião de amanhã sumiu da contagem").toBe(1);
    expect(
      r.taxa_de_comparecimento,
      "a reunião de amanhã entrou no denominador: a taxa despencaria só porque o mês não acabou",
    ).toBe(0.5);
  });

  it("sem nenhum desfecho, a taxa é NULA — e não zero, que se leria como 'ninguém apareceu'", () => {
    const soFuturas: ReuniaoMarcada[] = [
      { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-20T10:00:00Z", status: "confirmed" },
    ];
    expect(resumoDasReunioes(soFuturas, "2026-09-01").taxa_de_comparecimento).toBeNull();
  });
});
