/**
 * QUANTO A IA CUSTA É NÚMERO DA PLATAFORMA, NÃO DO CLIENTE.
 *
 * Decisão desta instalação (Time Company, 15/09/2026), e diferente do desenho do
 * produto — onde a organização vê o próprio gasto e escolhe o próprio teto.
 *
 * Aqui a conta do provedor é paga por quem opera a plataforma, e o cliente
 * contrata atendimento, não tokens. Mostrar o custo para ele seria mostrar a
 * margem: é o preço de custo da coisa que ele está comprando. Por isso a tela
 * "Uso e orçamento" sai do menu do cliente e o valor em dinheiro é retirado das
 * respostas da API — não escondido no componente, que qualquer devtools abre.
 *
 * O QUE CONTINUA VISÍVEL PARA O CLIENTE, de propósito: tokens, tempo de resposta,
 * número de atendimentos e erros. Consumo não é preço, e é justamente o que vira
 * medidor quando o plano passar a ser por conversa ou por pacote mensal — o
 * cliente precisa enxergar o que gastou do pacote dele sem enxergar o que isso
 * custou a nós.
 *
 * Quem enxerga dinheiro é o admin de plataforma (`/admin`), e lá o número é por
 * tenant. `support` fica de fora: uma sessão de acompanhamento entra na conta do
 * cliente para ajudar, e não para ver o custo dela.
 */
import type { AuthUser } from "@/lib/auth/types";

export function podeVerCusto(user: Pick<AuthUser, "is_platform_admin" | "support">): boolean {
  return user.is_platform_admin === true && !user.support;
}

/**
 * Apaga o custo de cada linha quando quem pede não é da plataforma. Devolve
 * `null` (o mesmo valor que "preço desconhecido" já produzia), e não zero: a
 * tela existente esconde a linha de custo quando é nulo, e um zero ali diria
 * "custou nada", que é a mentira que este fork está justamente consertando.
 */
export function semCusto<T extends { cost_cents?: number | string | null }>(
  linhas: T[],
  visivel: boolean,
): T[] {
  if (visivel) return linhas;
  return linhas.map((linha) => ({ ...linha, cost_cents: null }));
}
