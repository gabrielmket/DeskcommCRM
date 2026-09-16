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
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { formatCentsUSD } from "@/lib/money";
import type { GastoSeparado } from "@/lib/ai/custo/natureza";

interface Props {
  natureza: GastoSeparado;
  cotacao: { usd_brl: number; cotado_em: string | null } | null;
  /** Já convertido no servidor, dia a dia pela cotação daquele dia. */
  reais: {
    total: number;
    dias_sem_cotacao: number;
    taxa_efetiva: number | null;
    total_pela_taxa_efetiva: number | null;
  };
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
    <div className="rounded-md border p-4">
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

export function NaturezaDoGasto({ natureza, cotacao, reais }: Props) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const { atendimentoCents, sistemaCents, totalCents, conversas, porConversaCents, semPreco } = natureza;
  const fatiaAtendimento = totalCents > 0 ? Math.round((atendimentoCents / totalCents) * 100) : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t("De onde vem o gasto de IA")}</h2>
        {cotacao ? (
          <p className="text-xs text-muted-foreground">
            {t("Convertido a")} R${" "}
            {cotacao.usd_brl.toLocaleString(tagDoIdioma, { minimumFractionDigits: 4 })}
            {cotacao.cotado_em
              ? ` · ${t("cotação de")} ${new Date(cotacao.cotado_em).toLocaleDateString(tagDoIdioma)}`
              : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("Sem cotação registrada: valores em dólar.")}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo={t("Atendimento")}
          cents={atendimentoCents}
          detalhe={`${fatiaAtendimento}% ${t("do total · o que o cliente causou")}`}
          cotacao={cotacao}
        />
        <Cartao
          titulo={t("Operação do sistema")}
          cents={sistemaCents}
          detalhe={t("avaliação do agente, ensaios e indexação")}
          cotacao={cotacao}
        />
        <Cartao
          titulo={t("Por conversa")}
          cents={porConversaCents}
          detalhe={
            conversas > 0
              ? `${conversas} ${t("conversa(s) com gasto")}`
              : t("nenhuma conversa no período")
          }
          cotacao={cotacao}
        />
        <Cartao
          titulo={t("Total")}
          cents={totalCents}
          detalhe={t("atendimento + operação")}
          cotacao={cotacao}
        />
      </div>

      {/* O que a conversão custa de verdade: recarga com cartão brasileiro embute
          spread do banco e IOF, e é a taxa EFETIVA que decide margem. Ela é
          medida (reais que saíram ÷ dólares que entraram), nunca estimada. */}
      <p className="text-xs text-muted-foreground">
        {t("No período:")}{" "}
        <span className="font-medium text-foreground">
          {reais.total.toLocaleString(tagDoIdioma, { style: "currency", currency: "BRL" })}
        </span>{" "}
        {t("pela cotação de cada dia")}
        {reais.total_pela_taxa_efetiva !== null && reais.taxa_efetiva !== null ? (
          <>
            {" · "}
            <span className="font-medium text-foreground">
              {reais.total_pela_taxa_efetiva.toLocaleString(tagDoIdioma, {
                style: "currency",
                currency: "BRL",
              })}
            </span>{" "}
            {t("pelo dólar que você pagou")} (R$ {reais.taxa_efetiva.toLocaleString(tagDoIdioma, { minimumFractionDigits: 4 })})
          </>
        ) : (
          <>
            {" · "}
            {t("informe o valor em reais das recargas para ver o custo com IOF")}
          </>
        )}
        {reais.dias_sem_cotacao > 0 ? (
          <> {" · "}{reais.dias_sem_cotacao} {t("dia(s) sem cotação, total parcial")}</>
        ) : null}
      </p>

      {semPreco > 0 ? (
        // A ressalva que impede ler um piso como se fosse a conta inteira.
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {semPreco}{" "}
          {t(
            "chamada(s) do período ainda sem preço conhecido — o modelo não está na tabela de preços, então o total acima é um piso, não a conta fechada.",
          )}
        </p>
      ) : null}
    </section>
  );
}
