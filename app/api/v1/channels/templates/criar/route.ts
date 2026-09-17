/**
 * POST /api/v1/channels/templates/criar — cria um template NA META, daqui.
 *
 * Fecha o caminho que faltava: até aqui o produto só espelhava o que existia lá,
 * e quem quisesse um template novo tinha de sair do sistema, abrir o WhatsApp
 * Manager, lembrar o formato e voltar. "Sai do produto para fazer a coisa que o
 * produto existe para fazer" é funcionalidade pela metade.
 *
 * O template nasce PENDENTE e ninguém aqui decide o contrário: quem aprova é a
 * Meta, e quem conta que aprovou é o webhook `message_template_status_update`,
 * que a conta já assina. Gravar APPROVED na criação seria inventar um estado
 * que o espelho existe justamente para não ter.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { criarTemplate } from "@/lib/channels/meta/criar-template";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { syncTemplates } from "@/lib/channels/meta/template-sync";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  name: z.string().min(1).max(512),
  language: z.string().min(2).max(10).default("pt_BR"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  body: z.string().min(1).max(1024),
  exemplos: z.array(z.string().max(200)).max(10).optional(),
  botoes: z.array(z.string().min(1).max(25)).max(3).optional(),
  header: z.string().max(60).optional(),
  footer: z.string().max(60).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  // `admin`: submeter template é ato que fala em nome da marca na Meta, e uma
  // reprovação suja a conta inteira. Mesmo piso da tela de conexão.
  const authz = await requireRole("admin", { requestId, resource: "channels_templates" });
  if (!authz.ok) return authz.response;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = corpoSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Template inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const db = await createClient();
  const creds = await credenciaisDaOrg(db, authz.org.orgId);
  if (!creds) {
    return fail("invalid_request", "Nenhum canal oficial conectado.", 400, { requestId });
  }

  const r = await criarTemplate({ ...parsed.data, ...creds });
  if (!r.criado) {
    // 422 e não 502 para as recusas nossas: `nome_invalido` e
    // `exemplos_faltando` são do pedido, e um 502 mandaria o operador procurar
    // defeito na Meta.
    const status = r.motivo === "api_error" ? 502 : 422;
    return fail("invalid_request", r.detalhe, status, { requestId });
  }

  void audit({
    action: "channels.template_criado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: { name: parsed.data.name, language: parsed.data.language, status: r.status },
  });

  // Sincroniza na hora para o template novo já aparecer na lista com o estado
  // que a Meta devolveu — sem isto a tela ficaria vazia até o próximo sync e
  // pareceria que a criação falhou.
  try {
    await syncTemplates({
      organizationId: authz.org.orgId,
      wabaId: creds.wabaId,
      token: creds.token,
      graphVersion: creds.graphVersion,
    });
  } catch {
    // A criação JÁ aconteceu. Falhar aqui diria "não criei" sobre algo criado,
    // que é pior que a lista demorar um minuto para refletir.
  }

  return ok({ id: r.id, status: r.status, category: r.category }, { requestId });
}
