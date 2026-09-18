/**
 * POST /api/v1/channels/templates/midia — sobe a imagem de EXEMPLO do cabeçalho.
 *
 * Um template com cabeçalho de imagem não guarda a imagem: guarda um exemplo,
 * que a Meta usa para revisar o modelo. Esse exemplo viaja como um `handle`,
 * obtido por uma API de upload própria e em duas etapas — o porquê e as
 * armadilhas estão em `lib/channels/meta/subir-midia-do-template.ts`.
 *
 * Esta rota existe separada da criação de propósito: subir o arquivo e submeter
 * o template são atos com tempos muito diferentes (um é uma transferência, o
 * outro é uma chamada), e juntá-los faria uma imagem grande segurar o
 * formulário inteiro sem ninguém saber em qual dos dois está esperando.
 *
 * ⚠️ O handle NÃO é a imagem que o cliente recebe. É só a amostra da análise: a
 * imagem de cada envio vai no parâmetro do cabeçalho, na hora de disparar, e
 * pode mudar a cada campanha.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import {
  formatoDoTipo,
  subirMidiaDoTemplate,
  TIPOS_ACEITOS,
} from "@/lib/channels/meta/subir-midia-do-template";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

/**
 * 5 MB. A Meta aceita mais em vídeo, e o limite aqui é do EXEMPLO — uma amostra
 * para revisão humana, não o material da campanha. Arquivo grande neste campo é
 * quase sempre engano sobre o que ele faz.
 */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  // Mesmo piso de quem cria template: submeter modelo fala em nome da marca na
  // Meta, e uma reprovação suja a conta inteira.
  const authz = await requireRole("admin", { requestId, resource: "channels_templates" });
  if (!authz.ok) return authz.response;

  const appId = (process.env.META_APP_ID ?? "").trim();
  if (!appId) {
    /**
     * O app é UM para todos os clientes, então isto é configuração da
     * instalação e não do tenant. Recusar nomeando a variável é o que evita a
     * próxima hora de investigação: sem isso, o sintoma seria a Meta recusando
     * um upload sem dizer por quê.
     */
    return fail(
      "invalid_request",
      "META_APP_ID não está configurado nesta instalação — sem ele a Meta não abre a sessão de upload.",
      422,
      { requestId },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail("validation_failed", "Envio inválido.", 422, { requestId });
  }

  const arquivo = formData.get("file");
  if (!(arquivo instanceof File)) {
    return fail("validation_failed", "Escolha um arquivo.", 422, { requestId });
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    return fail("validation_failed", "O exemplo precisa ter até 5 MB.", 422, { requestId });
  }

  const formato = formatoDoTipo(arquivo.type);
  if (!formato) {
    // Os tipos aceitos vão na mensagem: "formato não suportado" sem a lista
    // manda o operador tentar por eliminação.
    const aceitos = Object.values(TIPOS_ACEITOS).flat().join(", ");
    return fail(
      "validation_failed",
      `A Meta aceita ${aceitos} no cabeçalho — este arquivo é ${arquivo.type || "de tipo desconhecido"}.`,
      422,
      { requestId },
    );
  }

  const creds = await credenciaisDaOrg(authz.org.orgId);
  if (!creds) {
    return fail("invalid_request", "Nenhum canal oficial conectado.", 400, { requestId });
  }

  const r = await subirMidiaDoTemplate({
    appId,
    token: creds.token,
    graphVersion: creds.graphVersion,
    bytes: await arquivo.arrayBuffer(),
    tipo: arquivo.type,
  });

  if (!r.subiu) {
    // 502 e não 500: quem recusou foi a Meta, e a distinção diz ao operador se
    // ele deve tentar de novo ou conferir a própria configuração.
    return fail("upstream_error", r.detalhe, 502, { requestId });
  }

  return ok({ handle: r.handle, formato }, { requestId });
}
