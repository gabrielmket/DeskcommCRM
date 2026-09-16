import { originFromAutomationEvent } from "@/lib/atendimento/origem-automacao";
/**
 * Ação `create_or_move_lead` — reusa os handlers core de /api/v1/leads
 * (mesmo caminho que REST/MCP) em vez de duplicar a lógica de criação/move.
 *
 * Actor = `webhook_source` com id = ruleId (ator automático; audit registra
 * actor_type=webhook_source). requestId = `rule:${ruleId}` — os handlers
 * propagam esse valor pro metadata.request_id dos eventos que emitem, e é
 * esse prefixo "rule:" que o engine (Task 8) usa pra não reprocessar os
 * eventos derivados (anti-loop profundidade 1: regra→ação→handler→evento).
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { createLeadHandler, moveLeadHandler } from "@/app/api/v1/leads/_handler";

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const pipelineId = typeof config.pipeline_id === "string" ? config.pipeline_id : null;
  const stageId = typeof config.stage_id === "string" ? config.stage_id : null;
  /**
   * O que fazer quando o contato JÁ tem negócio, mas em OUTRO funil.
   *
   * Recusar era a única resposta, e ela está certa para "mover": um negócio
   * pertence a um funil, e arrastá-lo para outro apagaria o histórico de etapas
   * dele. Só que recusar também era a resposta para a passagem de bastão — SDR
   * qualifica no funil dele, e o comercial precisa de um card no funil DELE —,
   * e ali a recusa deixa a automação inteira muda: o vendedor não recebe nada
   * porque o lead "já existe" noutro lugar.
   *
   * Continua sendo OPT-IN, com o padrão de hoje: uma regra já salva não muda de
   * comportamento porque este campo nasceu.
   */
  const abreNoOutroFunil = config.quando_em_outro_funil === "abrir_novo_card";
  if (!pipelineId || !stageId) {
    return { type: "create_or_move_lead", status: "failed", error: "missing_config" };
  }

  const handlerCtx: HandlerCtx = {
    organization_id: ctx.organizationId,
    actor: { type: "webhook_source", id: ctx.ruleId },
    requestId: `rule:${ctx.ruleId}`,
  };
  const lead = ctx.context.lead as
    | { id: string; pipeline_id: string; contact_id?: string; title?: string }
    | undefined;
  const contact = ctx.context.contact as
    | { id: string; name?: string | null; display_name?: string | null; phone_number?: string | null }
    | undefined;

  const contactId = contact?.id ?? lead?.contact_id;
  handlerCtx.serviceOrigin = contactId
    ? (await originFromAutomationEvent(ctx, contactId)) ?? { kind: "unavailable", reason: "origin_capture_failed" }
    : { kind: "unavailable", reason: "origin_capture_failed" };

  try {
    const emOutroFunil = Boolean(lead && lead.pipeline_id !== pipelineId);
    if (lead && !emOutroFunil) {
      await moveLeadHandler(ctx.admin, handlerCtx, lead.id, { to_stage_id: stageId });
      return { type: "create_or_move_lead", status: "success", detail: { moved: lead.id } };
    }
    if (emOutroFunil && !abreNoOutroFunil) {
      return { type: "create_or_move_lead", status: "failed", error: "cross_pipeline_move_not_allowed" };
    }
    // A passagem de bastão: card NOVO no funil de destino, com o negócio de
    // origem intacto no funil de origem. É cópia, não mudança — quem qualificou
    // continua com o histórico dele.
    if (emOutroFunil && contactId) {
      const created = await createLeadHandler(ctx.admin, handlerCtx, {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: contact?.name ?? contact?.display_name ?? lead?.title ?? contact?.phone_number ?? "Lead da automação",
        contact_id: contactId,
        source: "automation",
      } as Parameters<typeof createLeadHandler>[2]);
      return {
        type: "create_or_move_lead",
        status: "success",
        detail: { created: String(created.id), de_outro_funil: lead!.id },
      };
    }
    if (contact) {
      const created = await createLeadHandler(ctx.admin, handlerCtx, {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: contact.name ?? contact.display_name ?? contact.phone_number ?? "Lead da automação",
        contact_id: contact.id,
        source: "automation",
      } as Parameters<typeof createLeadHandler>[2]);
      return { type: "create_or_move_lead", status: "success", detail: { created: String(created.id) } };
    }
    return { type: "create_or_move_lead", status: "skipped", detail: { reason: "no_lead_or_contact" } };
  } catch (err) {
    return {
      type: "create_or_move_lead",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerAction({ type: "create_or_move_lead", execute });
