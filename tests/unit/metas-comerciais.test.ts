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
  resumoDoMes,
  type LeadFechadoComPrazo,
  type Meta,
  type ReuniaoMarcada,
} from "@/lib/crm/metas/progresso";

const CLOSER = "11111111-1111-4111-8111-111111111111";
const SDR = "22222222-2222-4222-8222-222222222222";
const AGENTE = "33333333-3333-4333-8333-333333333333";

function venda(over: Partial<LeadFechadoComPrazo> = {}): LeadFechadoComPrazo {
  return {
    status: "won",
    value_cents: 100_000,
    revenue_kind: "recorrente",
    owner_user_id: CLOSER,
    originated_by_user_id: SDR,
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
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-09-02T10:00:00Z" },
    { marcada_por_user_id: null, marcada_por_agent_id: AGENTE, created_at: "2026-09-03T10:00:00Z" },
    { marcada_por_user_id: null, marcada_por_agent_id: AGENTE, created_at: "2026-09-04T10:00:00Z" },
    { marcada_por_user_id: SDR, marcada_por_agent_id: null, created_at: "2026-08-30T10:00:00Z" },
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
