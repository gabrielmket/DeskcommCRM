/**
 * POST /api/v1/broadcasts/[id]/disparar — tira a campanha do rascunho.
 *
 * Separado da criação de propósito: criar monta a lista e mostra quem ficou de
 * fora; disparar é o ato que gasta. Juntar os dois tiraria a chance de olhar a
 * peneira antes — e é olhando a peneira que se descobre que 900 dos 4.000
 * contatos não têm telefone.
 *
 * A trava é conferida AQUI DE NOVO, e não só na criação: entre montar a lista e
 * clicar em disparar pode ter passado uma hora, e nessa hora outro disparo pode
 * ter consumido o crédito.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { podeComecar } from "@/lib/broadcast/plano";
import { derivarSaldo, type LancamentoDaCarteira } from "@/lib/carteira/saldo";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const { id } = await ctx.params;
  const { data: campanha } = await db
    .from("broadcasts")
    .select("id, status, template_name, template_language, preco_cents")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!campanha) return fail("not_found", "Campanha não encontrada.", 404, { requestId });

  // Só rascunho e pausada saem daqui. Reenviar uma concluída seria mandar tudo
  // de novo para quem já recebeu — e cobrar de novo.
  if (campanha.status !== "rascunho" && campanha.status !== "pausada") {
    return fail("state_conflict", `A campanha está ${campanha.status}.`, 409, { requestId });
  }

  const [{ count }, { data: extrato }, { data: preco }, { data: template }] = await Promise.all([
    db
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", id)
      .eq("status", "pendente"),
    db
      .from("tenant_wallet_ledger")
      .select("tipo, amount_cents, occurred_at")
      .eq("organization_id", authz.org.orgId)
      .limit(100_000),
    db
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents")
      .eq("organization_id", authz.org.orgId)
      .maybeSingle(),
    db
      .from("meta_templates")
      .select("status")
      .eq("organization_id", authz.org.orgId)
      .eq("name", campanha.template_name)
      .eq("language", campanha.template_language)
      .maybeSingle(),
  ]);

  const precoCents =
    preco?.preco_por_mensagem_cents === null || preco?.preco_por_mensagem_cents === undefined
      ? null
      : Number(preco.preco_por_mensagem_cents);

  const veredicto = podeComecar({
    destinatarios: count ?? 0,
    saldoCents: derivarSaldo((extrato ?? []) as LancamentoDaCarteira[]).saldo_cents,
    precoPorMensagemCents: precoCents,
    templateAprovado: template?.status === "APPROVED",
    temCanal: true,
    qualidade: "UNKNOWN",
  });
  if (!veredicto.pode) {
    return fail("invalid_request", veredicto.motivo ?? "nao_pode_disparar", 422, {
      requestId,
      details: { falta_cents: veredicto.trava?.falta_cents ?? null },
    });
  }

  const agora = new Date().toISOString();
  const admin = createAdminClient();
  await admin
    .from("broadcasts")
    .update({
      status: "enviando",
      // O preço é congelado AQUI: é o acordado no momento do disparo, e é ele
      // que o relatório desta campanha vai usar para sempre.
      preco_cents: precoCents,
      iniciado_em: agora,
      motivo_da_parada: null,
      updated_at: agora,
    })
    .eq("id", id);

  void audit({
    action: "broadcast.disparado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: { broadcast_id: id, destinatarios: count ?? 0, preco_cents: precoCents },
  });

  // O envio em si é do cron (a cada minuto): responder "enviando" e sair é o
  // que evita uma requisição HTTP segurando 4.000 mensagens.
  return ok({ id, status: "enviando", na_fila: count ?? 0 }, { requestId });
}
