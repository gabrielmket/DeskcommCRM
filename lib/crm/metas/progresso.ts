/**
 * META × REALIDADE — e por que o progresso é DERIVADO, nunca guardado.
 *
 * Uma coluna `realizado` ao lado da meta parece prática e apodrece rápido: ela
 * exige que todo caminho que fecha uma venda lembre de incrementá-la, e no dia
 * em que um caminho esquecer (importação, correção manual, API), a meta passa a
 * mentir sem ninguém ver. Aqui o realizado sai das MESMAS linhas que o funil já
 * usa — se a venda existe, ela conta.
 *
 * ── As cinco métricas, e a pergunta que cada uma responde ───────────────────
 *
 *  • `reunioes` — quantas reuniões foram marcadas no mês. É a meta do SDR e a do
 *    agente de IA: mede ATIVIDADE, que é o que eles controlam.
 *  • `receita_total` — tudo que foi ganho.
 *  • `receita_recorrente` — só mensalidade. Separada porque R$ 10 mil de
 *    assinatura e R$ 10 mil de setup valem coisas diferentes para o negócio.
 *  • `receita_avulsa` — só projeto, setup, venda única.
 *  • `receita_originada` — a venda fechada por OUTRA pessoa que o SDR originou.
 *    É a "participação nas vendas" que hoje vive em planilha paralela.
 *
 * ── A regra de atribuição, escrita porque é onde dá briga ───────────────────
 *
 * Uma venda ganha conta UMA vez para o dono (`owner_user_id`) nas métricas de
 * receita, e UMA vez para quem originou (`originated_by_user_id`) em
 * `receita_originada`. Não é dobra: são perguntas diferentes — "quanto esse
 * closer fechou" e "quanto dessa receita nasceu do trabalho desse SDR". Somar as
 * duas numa só é que inventaria dinheiro.
 *
 * Venda sem `revenue_kind` não entra em recorrente nem em avulso, e o total diz
 * quantas ficaram de fora: escolher um lado por omissão inventaria a divisão que
 * o relatório existe para mostrar.
 */

export type MetricaDeMeta =
  | "reunioes"
  | "receita_total"
  | "receita_recorrente"
  | "receita_avulsa"
  | "receita_originada";

export interface LeadFechado {
  /** 'won' | 'lost' | 'open' — só `won` conta. */
  status: string;
  value_cents: number | null;
  revenue_kind: "recorrente" | "avulso" | null;
  owner_user_id: string | null;
  originated_by_user_id: string | null;
  /** ISO. Fora do mês da meta, não conta. */
  closed_at: string | null;
}

export interface ReuniaoMarcada {
  /** Quem marcou: o atendente, ou o agente de IA. */
  marcada_por_user_id: string | null;
  marcada_por_agent_id: string | null;
  created_at: string;
}

export interface Meta {
  id: string;
  periodo: string;
  metrica: MetricaDeMeta;
  alvo_cents: number | null;
  alvo_quantidade: number | null;
  user_id: string | null;
  agent_id: string | null;
}

export interface ProgressoDaMeta extends Meta {
  /** Centavos para métrica de dinheiro; contagem para `reunioes`. */
  realizado: number;
  alvo: number;
  /** 0 a 1 — e passa de 1 quando bate mais que a meta, de propósito. */
  fracao: number;
  /** Quanto falta, na mesma unidade do alvo. Nunca negativo. */
  falta: number;
}

/** O mês de uma data ISO, em AAAA-MM. */
function mesDe(iso: string | null): string | null {
  return iso ? iso.slice(0, 7) : null;
}

function dentroDoMes(iso: string | null, periodo: string): boolean {
  return mesDe(iso) === periodo.slice(0, 7);
}

/**
 * O realizado de UMA meta, contra as linhas do período.
 *
 * `leads` e `reunioes` chegam já filtrados pela organização — este módulo é
 * puro e não sabe consultar nada; quem lê banco é o chamador.
 */
export function realizadoDaMeta(
  meta: Meta,
  leads: readonly LeadFechado[],
  reunioes: readonly ReuniaoMarcada[],
): number {
  if (meta.metrica === "reunioes") {
    return reunioes.filter((r) => {
      if (!dentroDoMes(r.created_at, meta.periodo)) return false;
      if (meta.user_id) return r.marcada_por_user_id === meta.user_id;
      if (meta.agent_id) return r.marcada_por_agent_id === meta.agent_id;
      // Meta da organização: conta tudo, inclusive o que a IA marcou.
      return true;
    }).length;
  }

  const ganhas = leads.filter(
    (l) => l.status === "won" && dentroDoMes(l.closed_at, meta.periodo),
  );

  if (meta.metrica === "receita_originada") {
    // A pergunta aqui é a do SDR: quanto da receita fechada nasceu do trabalho
    // dele. Sem `user_id` a métrica não faz sentido (a organização inteira
    // "origina" tudo), e devolver 0 é mais honesto que somar o total.
    if (!meta.user_id) return 0;
    return somar(ganhas.filter((l) => l.originated_by_user_id === meta.user_id));
  }

  const doResponsavel = meta.user_id
    ? ganhas.filter((l) => l.owner_user_id === meta.user_id)
    : ganhas;

  if (meta.metrica === "receita_recorrente") {
    return somar(doResponsavel.filter((l) => l.revenue_kind === "recorrente"));
  }
  if (meta.metrica === "receita_avulsa") {
    return somar(doResponsavel.filter((l) => l.revenue_kind === "avulso"));
  }
  return somar(doResponsavel);
}

function somar(leads: readonly LeadFechado[]): number {
  return leads.reduce((acc, l) => acc + (l.value_cents ?? 0), 0);
}

export function progressoDaMeta(
  meta: Meta,
  leads: readonly LeadFechado[],
  reunioes: readonly ReuniaoMarcada[],
): ProgressoDaMeta {
  const realizado = realizadoDaMeta(meta, leads, reunioes);
  const alvo = meta.metrica === "reunioes" ? (meta.alvo_quantidade ?? 0) : (meta.alvo_cents ?? 0);
  return {
    ...meta,
    realizado,
    alvo,
    // Alvo zero não existe (o CHECK do banco impede), mas um dado velho não
    // pode virar divisão por zero numa tela de acompanhamento.
    fracao: alvo > 0 ? realizado / alvo : 0,
    falta: Math.max(0, alvo - realizado),
  };
}

export interface ResumoDoMes {
  /** Receita ganha no mês, por natureza. Centavos. */
  recorrente: number;
  avulso: number;
  naoClassificada: number;
  total: number;
  /** Quantas vendas ganhas ficaram sem classificação — a tela precisa dizer. */
  vendasSemClassificacao: number;
  /** Contrato anualizado: mensalidade × meses, quando o prazo é conhecido. */
  contratoRecorrenteCents: number;
}

export interface LeadFechadoComPrazo extends LeadFechado {
  recurring_months: number | null;
}

/**
 * O fechamento do mês — a base do relatório de vendas.
 *
 * `contratoRecorrenteCents` só soma o que tem prazo declarado: multiplicar por
 * um prazo suposto (12, por exemplo) inflaria o número mais citado do relatório
 * com um palpite que ninguém veria.
 */
export function resumoDoMes(
  leads: readonly LeadFechadoComPrazo[],
  periodo: string,
): ResumoDoMes {
  const ganhas = leads.filter(
    (l) => l.status === "won" && dentroDoMes(l.closed_at, periodo),
  );

  let recorrente = 0;
  let avulso = 0;
  let naoClassificada = 0;
  let contratoRecorrenteCents = 0;
  let vendasSemClassificacao = 0;

  for (const l of ganhas) {
    const valor = l.value_cents ?? 0;
    if (l.revenue_kind === "recorrente") {
      recorrente += valor;
      if (l.recurring_months && l.recurring_months > 0) {
        contratoRecorrenteCents += valor * l.recurring_months;
      }
    } else if (l.revenue_kind === "avulso") {
      avulso += valor;
    } else {
      naoClassificada += valor;
      vendasSemClassificacao++;
    }
  }

  return {
    recorrente,
    avulso,
    naoClassificada,
    total: recorrente + avulso + naoClassificada,
    vendasSemClassificacao,
    contratoRecorrenteCents,
  };
}
