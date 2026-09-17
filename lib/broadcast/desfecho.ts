/**
 * O DESFECHO DE UMA MENSAGEM DISPARADA — e por que ele não pode voltar atrás.
 *
 * A Meta avisa a entrega em etapas (`sent` → `delivered` → `read`), e não
 * garante a ORDEM: `read` chegando antes de `delivered` é raro e acontece. Sem
 * uma régua, o segundo evento sobrescreveria o primeiro e a campanha mostraria
 * "entregue" para quem já tinha lido.
 *
 * A régua é uma escada: só sobe. `falhou` é o único que quebra a escada, porque
 * não é progresso — é o fim.
 */

export type StatusDoDestinatario =
  | "pendente"
  | "enviada"
  | "entregue"
  | "lida"
  | "falhou"
  | "estornada";

/** Quanto cada estado "avançou". Maior vence. */
const DEGRAU: Record<StatusDoDestinatario, number> = {
  pendente: 0,
  enviada: 1,
  entregue: 2,
  lida: 3,
  // `falhou` e `estornada` ficam FORA da escada: são desfecho, não progresso.
  falhou: 0,
  estornada: 0,
};

/** O vocabulário da Meta traduzido para o nosso. `null` = não nos interessa. */
export function desfechoDaMeta(status: string): StatusDoDestinatario | null {
  switch (status) {
    case "sent":
      return "enviada";
    case "delivered":
      return "entregue";
    case "read":
      return "lida";
    case "failed":
      return "falhou";
    default:
      return null;
  }
}

/**
 * O novo estado, dado o que já estava gravado. `null` = não muda nada.
 *
 * ⚠️ Nada sobrescreve `falhou` nem `estornada`. Uma entrega que chega depois da
 * falha seria a plataforma se contradizendo, e aceitar a segunda versão faria o
 * estorno já lançado ficar sem a linha que o explica.
 */
export function proximoDesfecho(
  atual: StatusDoDestinatario,
  chegou: StatusDoDestinatario,
): StatusDoDestinatario | null {
  if (atual === "falhou" || atual === "estornada") return null;
  if (chegou === "falhou") return "falhou";
  return DEGRAU[chegou] > DEGRAU[atual] ? chegou : null;
}
