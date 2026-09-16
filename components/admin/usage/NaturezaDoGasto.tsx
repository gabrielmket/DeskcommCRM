"use client";

/**
 * As duas naturezas de gasto, lado a lado — e o custo por conversa.
 *
 * Um total só ("a IA custou X") não decide nada. Decide isto: quanto veio de
 * CLIENTE conversando (varia com volume, cabe num preço por conversa) e quanto
 * veio da OPERAÇÃO (o agente se avaliando, ensaio de versão, indexação), que é
 * custo de manter a plataforma de pé.
 *
 * O real só aparece quando existe cotação declarada. Sem ela, dólar puro — o
 * produto não busca câmbio na internet, e inventar um faria o custo de um mês
 * fechado mudar sozinho a cada vez que a tela abrisse.
 */
import { formatCentsUSD } from "@/lib/money";
import type { GastoSeparado } from "@/lib/ai/custo/natureza";

interface Props {
  natureza: GastoSeparado;
  cotacao: { usd_brl: number; cotado_em: string | null } | null;
}

function emReais(cents: number, usdBrl: number): string {
  return ((cents / 100) * usdBrl).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Cartao({
  titulo,
  cents,
  detalhe,
  cotacao,
}: {
  titulo: string;
  cents: number | null;
  detalhe: string;
  cotacao: Props["cotacao"];
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {cents === null ? "—" : cotacao ? emReais(cents, cotacao.usd_brl) : formatCentsUSD(cents)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {cents !== null && cotacao ? `${formatCentsUSD(cents)} · ` : ""}
        {detalhe}
      </p>
    </div>
  );
}

export function NaturezaDoGasto({ natureza, cotacao }: Props) {
  const { atendimentoCents, sistemaCents, totalCents, conversas, porConversaCents, semPreco } = natureza;
  const fatiaAtendimento = totalCents > 0 ? Math.round((atendimentoCents / totalCents) * 100) : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">De onde vem o gasto de IA</h2>
        {cotacao ? (
          <p className="text-xs text-muted-foreground">
            Convertido a R$ {cotacao.usd_brl.toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
            {cotacao.cotado_em
              ? ` · cotação de ${new Date(cotacao.cotado_em).toLocaleDateString("pt-BR")}`
              : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sem cotação registrada: valores em dólar.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo="Atendimento"
          cents={atendimentoCents}
          detalhe={`${fatiaAtendimento}% do total · o que o cliente causou`}
          cotacao={cotacao}
        />
        <Cartao
          titulo="Operação do sistema"
          cents={sistemaCents}
          detalhe="avaliação do agente, ensaios e indexação"
          cotacao={cotacao}
        />
        <Cartao
          titulo="Por conversa"
          cents={porConversaCents}
          detalhe={conversas > 0 ? `${conversas} conversa(s) com gasto` : "nenhuma conversa no período"}
          cotacao={cotacao}
        />
        <Cartao titulo="Total" cents={totalCents} detalhe="atendimento + operação" cotacao={cotacao} />
      </div>

      {semPreco > 0 ? (
        // A ressalva que impede ler um piso como se fosse a conta inteira.
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {semPreco} chamada(s) do período ainda sem preço conhecido — o modelo não está na tabela
          de preços, então o total acima é um piso, não a conta fechada.
        </p>
      ) : null}
    </section>
  );
}
