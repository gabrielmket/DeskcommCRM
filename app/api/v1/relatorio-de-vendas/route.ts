/**
 * GET /api/v1/relatorio-de-vendas?periodo=AAAA-MM — o que a fotografia do funil
 * não responde.
 *
 * A tela de Desempenho mostra quantos negócios estão em cada etapa AGORA. Isso
 * é útil e é uma fotografia: não diz por que perdemos, quanto tempo leva para
 * fechar, nem se o mês está melhor ou pior que os anteriores.
 *
 * Tudo aqui é DERIVADO das mesmas linhas de `crm_leads` que o funil usa — não
 * há tabela de relatório, e por isso não há relatório que envelhece.
 *
 * Auth: manager+. Receita, ciclo e motivo de perda são leitura de gestão.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { FUSO_PADRAO, janelaDoMes } from "@/lib/crm/metas/fuso";
import {
  cicloDeVenda,
  historico,
  motivosDePerda,
  taxaDeGanho,
  type LeadDoRelatorio,
} from "@/lib/crm/relatorio/vendas";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Quantos meses a série mostra. Seis cabem numa tela e mostram sazonalidade. */
const MESES_DA_SERIE = 6;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "relatorio_de_vendas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const periodo = req.nextUrl.searchParams.get("periodo") ?? new Date().toISOString().slice(0, 7);
  if (!MES.test(periodo)) {
    return fail("validation_failed", t("Período inválido: use AAAA-MM."), 422, { requestId });
  }

  const db = await createClient();

  const { data: orgRow } = await db
    .from("organizations")
    .select("timezone")
    .eq("id", org.orgId)
    .maybeSingle();
  const fuso = (orgRow?.timezone as string | null) || FUSO_PADRAO;

  /**
   * A janela cobre a SÉRIE inteira, não só o mês pedido: a evolução precisa dos
   * meses anteriores, e uma segunda consulta por mês seria seis idas ao banco
   * para responder uma pergunta.
   */
  const partes = periodo.split("-");
  const inicioDaSerie = janelaDoMes(
    `${new Date(Date.UTC(Number(partes[0]), Number(partes[1]) - 1 - (MESES_DA_SERIE - 1), 1))
      .toISOString()
      .slice(0, 7)}`,
    fuso,
  ).inicio;
  const fimDoMes = janelaDoMes(periodo, fuso).fim;

  const [leadsRes, funisRes] = await Promise.all([
    db
      .from("crm_leads")
      .select(
        "status, pipeline_id, value_cents, revenue_kind, recurring_months, lost_reason, created_at, closed_at",
      )
      .eq("organization_id", org.orgId)
      .not("closed_at", "is", null)
      .gte("closed_at", inicioDaSerie)
      .lt("closed_at", fimDoMes)
      .limit(50_000),
    db.from("crm_pipelines").select("id, settings").eq("organization_id", org.orgId),
  ]);
  if (leadsRes.error) return fail("query_failed", leadsRes.error.message, 500, { requestId });

  // A MESMA régua do módulo de metas: ganhar num funil de SDR não é receita.
  const declararam = (funisRes.data ?? []).some(
    (f) => (f.settings as { vitoria_e_receita?: boolean } | null)?.vitoria_e_receita === false,
  );
  const funisDeReceita = declararam
    ? new Set(
        (funisRes.data ?? [])
          .filter(
            (f) => (f.settings as { vitoria_e_receita?: boolean } | null)?.vitoria_e_receita !== false,
          )
          .map((f) => f.id as string),
      )
    : null;

  const leads = (leadsRes.data ?? []) as unknown as LeadDoRelatorio[];

  return ok(
    {
      periodo,
      fuso,
      taxa_de_ganho: taxaDeGanho(leads, periodo, fuso, funisDeReceita),
      ciclo_de_venda: cicloDeVenda(leads, periodo, fuso, funisDeReceita),
      motivos_de_perda: motivosDePerda(leads, periodo, fuso),
      historico: historico(leads, periodo, MESES_DA_SERIE, fuso, funisDeReceita),
    },
    { requestId },
  );
}
