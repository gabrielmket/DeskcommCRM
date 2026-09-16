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
  /**
   * O que a OpenAI COBROU nos dias já fechados do período. Nulo = sem chave de
   * administração ou sem dia capturado, e aí a tela não finge ter a fatura.
   */
  fatura: { total_usd: number; dias: number; ate: string | null } | null;
  /** Já convertido no servidor, dia a dia pela cotação daquele dia. */
  reais: {
    total: number;
    dias_sem_cotacao: number;
    taxa_efetiva: number | null;
    total_pela_taxa_efetiva: number | null;
  };
}

/**
 * Quanto a nossa medição se afasta da fatura, em porcento e sem sinal — a
 * direção não importa para decidir se dá para confiar nela; o TAMANHO importa.
 */
function diferencaEmPorcento(medidoEmCents: number, faturaUsd: number): number {
  return Math.abs(Math.round(((medidoEmCents / 100 - faturaUsd) / faturaUsd) * 100));
}

/** A fatura vem em DÓLAR inteiro, não em centavo como `llm_calls.cost_cents`. */
function usdSimples(valor: number, tag: string): string {
  return valor.toLocaleString(tag, { style: "currency", currency: "USD" });
}

function emReais(cents: number, usdBrl: number, tag: string): string {
  return ((cents / 100) * usdBrl).toLocaleString(tag, { style: "currency", currency: "BRL" });
}

function Cartao({
  titulo,
  cents,
  detalhe,
  cotacao,
  tag,
}: {
  titulo: string;
  cents: number | null;
  detalhe: string;
  cotacao: Props["cotacao"];
  /** Idioma de quem lê: número também segue idioma, não só data. */
  tag: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {cents === null ? "—" : cotacao ? emReais(cents, cotacao.usd_brl, tag) : formatCentsUSD(cents)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {cents !== null && cotacao ? `${formatCentsUSD(cents)} · ` : ""}
        {detalhe}
      </p>
    </div>
  );
}

export function NaturezaDoGasto({ natureza, cotacao, reais, fatura }: Props) {
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
          tag={tagDoIdioma}
        />
        <Cartao
          titulo={t("Operação do sistema")}
          cents={sistemaCents}
          detalhe={t("avaliação do agente, ensaios e indexação")}
          cotacao={cotacao}
          tag={tagDoIdioma}
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
          tag={tagDoIdioma}
        />
        <Cartao
          titulo={t("Total")}
          cents={totalCents}
          detalhe={t("atendimento + operação")}
          cotacao={cotacao}
          tag={tagDoIdioma}
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

      {/* A FATURA ao lado da nossa conta. A diferença entre as duas é a margem
          de erro da medição — e é ela que diz se dá para confiar no custo por
          conversa na hora de fechar preço com um cliente. */}
      {fatura ? (
        <p className="text-xs text-muted-foreground">
          {t("A OpenAI cobrou")}{" "}
          <span className="font-medium text-foreground">
            {usdSimples(fatura.total_usd, tagDoIdioma)}
          </span>{" "}
          {t("nos")} {fatura.dias} {t("dia(s) já fechados")} · {t("medimos")}{" "}
          {formatCentsUSD(totalCents)}
          {fatura.total_usd > 0
            ? ` · ${t("diferença de")} ${diferencaEmPorcento(totalCents, fatura.total_usd)}%`
            : ""}
        </p>
      ) : null}

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
