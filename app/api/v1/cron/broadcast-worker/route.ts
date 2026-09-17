/**
 * GET/POST /api/v1/cron/broadcast-worker — o motor do MIA Broadcast.
 *
 * Pega as campanhas que estão para enviar e manda o que der na rodada. O
 * estado mora todo no banco (uma linha por destinatário), então a próxima
 * rodada continua exatamente de onde esta parou — e um processo que morre no
 * meio não perde nem duplica nada.
 *
 * ── Uma campanha por rodada, e não todas em paralelo ────────────────────────
 *
 * Duas campanhas do mesmo cliente disputando o mesmo saldo passariam as duas
 * pela trava e estourariam juntas. Serializar por rodada resolve sem travar
 * linha no banco — o custo é a segunda campanha esperar a próxima volta do
 * cron, o que para um disparo é irrelevante.
 *
 * Auth: mesmo contrato dos demais crons (Bearer `INTERNAL_CRON_SECRET` |
 * `INTERNAL_SECRET`, fail-closed).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { rodarCampanha, type CampanhaEmCurso } from "@/lib/broadcast/motor";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { qualidadeDoNumero } from "@/lib/channels/meta/qualidade-do-numero";
import { sendTemplateForSession } from "@/lib/channels/meta/send-template-for-session";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Quantas mensagens por rodada. O cron volta em um minuto. */
const POR_RODADA = 50;

function autorizado(req: NextRequest): boolean {
  const esperado = env.INTERNAL_CRON_SECRET || env.INTERNAL_SECRET;
  if (!esperado) return false; // fail-closed
  return req.headers.get("authorization") === `Bearer ${esperado}`;
}

async function handler(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizado(req)) {
    return fail("unauthorized", "cron secret ausente ou inválido", 401, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date().toISOString();

  // `enviando` primeiro, depois `agendada` cuja hora chegou: quem já começou
  // termina antes de outra começar e disputar o mesmo saldo.
  const { data: campanhas } = await admin
    .from("broadcasts")
    .select(
      "id, organization_id, template_name, template_language, valores_padrao, preco_cents, status, agendado_para",
    )
    .in("status", ["enviando", "agendada"])
    .or(`agendado_para.is.null,agendado_para.lte.${agora}`)
    .order("status", { ascending: true })
    .limit(5);

  const alvo = (campanhas ?? [])[0] as
    | (CampanhaEmCurso & { status: string })
    | undefined;
  if (!alvo) return ok({ rodou: false, motivo: "nada_na_fila" }, { requestId });

  const creds = await credenciaisDaOrg(admin, alvo.organization_id);
  if (!creds) {
    // Sem canal a campanha não anda, e deixá-la em `enviando` faria o cron
    // tentar para sempre. Pausar com o motivo é o que põe isso na tela.
    await admin
      .from("broadcasts")
      .update({ status: "pausada", motivo_da_parada: "sem_canal", updated_at: agora })
      .eq("id", alvo.id);
    return ok({ rodou: false, motivo: "sem_canal" }, { requestId });
  }

  if (alvo.status === "agendada") {
    await admin
      .from("broadcasts")
      .update({ status: "enviando", iniciado_em: agora, updated_at: agora })
      .eq("id", alvo.id);
  }

  const resultado = await rodarCampanha(
    admin,
    alvo,
    {
      enviar: (input) =>
        sendTemplateForSession(admin, { ...input, phoneNumberId: creds.phoneNumberId }),
      qualidade: () => qualidadeDoNumero(creds),
      espacar: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    POR_RODADA,
  );

  // O estado final da campanha sai do que a rodada apurou — nunca de um
  // contador próprio, que divergiria da soma das linhas.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (resultado.parou) {
    patch.status = "pausada";
    patch.motivo_da_parada = resultado.parou;
  } else if (resultado.restam === 0) {
    patch.status = "concluida";
    patch.concluido_em = new Date().toISOString();
    patch.motivo_da_parada = null;
  }
  await admin.from("broadcasts").update(patch).eq("id", alvo.id);

  logger.info("[broadcast-worker] rodada", {
    broadcast_id: alvo.id,
    ...resultado,
    request_id: requestId,
  });

  return ok({ rodou: true, broadcast_id: alvo.id, ...resultado }, { requestId });
}

export const GET = handler;
export const POST = handler;
