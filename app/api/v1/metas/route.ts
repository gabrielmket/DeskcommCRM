/**
 * GET/POST /api/v1/metas — a meta do mês e o quanto dela já foi feito.
 *
 * O PROGRESSO não é guardado: é derivado, na leitura, das mesmas linhas que o
 * funil e a agenda já usam (`lib/crm/metas/progresso.ts`). Uma coluna
 * `realizado` ao lado da meta exigiria que todo caminho que fecha uma venda
 * lembrasse de incrementá-la — e no dia em que um caminho esquecesse, a meta
 * passaria a mentir sem ninguém ver.
 *
 * Quem define meta é manager+ (é decisão de gestão); quem acompanha é todo mundo
 * que enxerga o funil. A RLS da tabela já diz isso; aqui a porta repete, porque
 * política de banco não devolve mensagem que gente entende.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  progressoDaMeta,
  resumoDoMes,
  type LeadFechadoComPrazo,
  type Meta,
  type ReuniaoMarcada,
} from "@/lib/crm/metas/progresso";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** AAAA-MM: o mês é a unidade da meta comercial. */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const criarSchema = z.object({
  periodo: z.string().regex(MES, "use AAAA-MM"),
  metrica: z.enum([
    "reunioes",
    "receita_total",
    "receita_recorrente",
    "receita_avulsa",
    "receita_originada",
  ]),
  alvo_cents: z.number().int().positive().max(1_000_000_000_000).optional(),
  alvo_quantidade: z.number().int().positive().max(100_000).optional(),
  user_id: z.string().uuid().nullish(),
  agent_id: z.string().uuid().nullish(),
});

function primeiroDia(periodo: string): string {
  return `${periodo}-01`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "metas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const periodo = req.nextUrl.searchParams.get("periodo") ?? new Date().toISOString().slice(0, 7);
  if (!MES.test(periodo)) {
    return fail("validation_failed", t("Período inválido: use AAAA-MM."), 422, { requestId });
  }

  const db = await createClient();
  const dia1 = primeiroDia(periodo);
  // Fim EXCLUSIVO do mês: `lt` no primeiro dia do mês seguinte pega o mês
  // inteiro sem depender de quantos dias ele tem.
  const proximoMes = new Date(`${dia1}T00:00:00Z`);
  proximoMes.setUTCMonth(proximoMes.getUTCMonth() + 1);
  const fim = proximoMes.toISOString();

  const [metasRes, leadsRes, reunioesRes] = await Promise.all([
    db
      .from("sales_targets")
      .select("id, periodo, metrica, alvo_cents, alvo_quantidade, user_id, agent_id")
      .eq("organization_id", org.orgId)
      .eq("periodo", dia1),
    db
      .from("crm_leads")
      .select(
        "status, value_cents, revenue_kind, recurring_months, owner_user_id, originated_by_user_id, closed_at",
      )
      .eq("organization_id", org.orgId)
      .eq("status", "won")
      .gte("closed_at", `${dia1}T00:00:00Z`)
      .lt("closed_at", fim)
      .limit(10_000),
    db
      .from("calendar_appointments")
      .select("created_by_user_id, created_by_agent_id, created_at, status")
      .eq("organization_id", org.orgId)
      .gte("created_at", `${dia1}T00:00:00Z`)
      .lt("created_at", fim)
      .limit(10_000),
  ]);

  if (metasRes.error) return fail("query_failed", metasRes.error.message, 500, { requestId });

  const leads: LeadFechadoComPrazo[] = (leadsRes.data ?? []).map((l) => ({
    status: l.status as string,
    value_cents: l.value_cents === null ? null : Number(l.value_cents),
    revenue_kind: (l.revenue_kind as "recorrente" | "avulso" | null) ?? null,
    recurring_months: (l.recurring_months as number | null) ?? null,
    owner_user_id: (l.owner_user_id as string | null) ?? null,
    originated_by_user_id: (l.originated_by_user_id as string | null) ?? null,
    closed_at: (l.closed_at as string | null) ?? null,
  }));

  // Reunião CANCELADA não conta como marcada: a meta do SDR mede compromisso de
  // pé, e contar cancelamento premiaria quem marca por marcar.
  const reunioes: ReuniaoMarcada[] = (reunioesRes.data ?? [])
    .filter((r) => r.status !== "cancelled")
    .map((r) => ({
      marcada_por_user_id: (r.created_by_user_id as string | null) ?? null,
      marcada_por_agent_id: (r.created_by_agent_id as string | null) ?? null,
      created_at: r.created_at as string,
    }));

  const metas = (metasRes.data ?? []) as unknown as Meta[];

  return ok(
    {
      periodo,
      metas: metas.map((m) => progressoDaMeta(m, leads, reunioes)),
      resumo: resumoDoMes(leads, dia1),
      reunioes_no_mes: reunioes.length,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org, user } = authz;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  }
  const parsed = criarSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", t("Meta inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const dados = parsed.data;

  // As duas regras que o banco também cobra, repetidas aqui para a mensagem ser
  // legível: o CHECK devolveria 23514, que não diz nada a quem está na tela.
  const ehAtividade = dados.metrica === "reunioes";
  if (ehAtividade && !dados.alvo_quantidade) {
    return fail("validation_failed", t("Meta de reuniões precisa de uma quantidade."), 422, {
      requestId,
    });
  }
  if (!ehAtividade && !dados.alvo_cents) {
    return fail("validation_failed", t("Meta de receita precisa de um valor."), 422, { requestId });
  }
  if (dados.user_id && dados.agent_id) {
    return fail("validation_failed", t("A meta é de uma pessoa OU de um agente, não dos dois."), 422, {
      requestId,
    });
  }

  const db = await createClient();
  const { data, error } = await db
    .from("sales_targets")
    .upsert(
      {
        organization_id: org.orgId,
        periodo: primeiroDia(dados.periodo),
        metrica: dados.metrica,
        alvo_cents: ehAtividade ? null : (dados.alvo_cents ?? null),
        alvo_quantidade: ehAtividade ? (dados.alvo_quantidade ?? null) : null,
        user_id: dados.user_id ?? null,
        agent_id: dados.agent_id ?? null,
        created_by: user.id,
      },
      // Redefinir a meta do mês é o caminho NORMAL (o número muda no meio do
      // trimestre); criar uma segunda linha para o mesmo par faria a tela
      // mostrar duas metas concorrentes sem dizer qual vale.
      { onConflict: "organization_id,periodo,metrica,user_id,agent_id" },
    )
    .select("id, periodo, metrica, alvo_cents, alvo_quantidade, user_id, agent_id")
    .single();

  if (error || !data) {
    return fail("db_error", t("Não consegui gravar a meta."), 500, { requestId });
  }
  return ok(data, { requestId });
}
