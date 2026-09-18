"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useContactTags } from "@/hooks/useContactTags";

/**
 * AS TAGS QUE EXISTEM, COM QUANTOS EM CADA — no lugar de um campo de texto.
 *
 * O campo era livre, com o placeholder "vip, retomada". Quem digitava um nome
 * que não existe recebia uma lista VAZIA e nenhuma explicação. Foi assim que se
 * descobriu, na primeira campanha real, que `contacts.tags` e `crm_leads.tags`
 * são colunas diferentes: a tag estava no CARTÃO do funil, o filtro lê a do
 * CONTATO, e o sistema respondeu zero em silêncio.
 *
 * A contagem ao lado é o conserto de verdade. Ver `vip (0)` encerra a dúvida
 * antes de montar qualquer coisa; sem ela, a descoberta custa um ciclo inteiro
 * de "montar, olhar o zero, não entender".
 *
 * ── Por que alternar e não um `<select multiple>` ──────────────────────────
 *
 * Seleção múltipla nativa é um dos controles mais mal compreendidos da web
 * (exige Ctrl para somar, e quem não sabe disso perde a seleção anterior a cada
 * clique). Com as tags visíveis e clicáveis, somar e tirar é o mesmo gesto, e a
 * lista já mostra o que existe sem ninguém precisar abrir nada.
 */
export function SeletorDeTags({
  selecionadas,
  onChange,
  disabled,
}: {
  selecionadas: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: tags, isPending, isError } = useContactTags();

  function alternar(tag: string) {
    onChange(
      selecionadas.includes(tag)
        ? selecionadas.filter((x) => x !== tag)
        : [...selecionadas, tag],
    );
  }

  return (
    <div className="space-y-1">
      <Label>{t("Filtrar por tags (opcional)")}</Label>

      {isPending ? (
        <p className="text-xs text-muted-foreground">{t("Carregando…")}</p>
      ) : isError ? (
        /**
         * Falha de leitura NÃO vira "nenhuma tag": dizer que a organização não
         * tem tag quando o banco é que não respondeu manda o operador procurar
         * defeito no cadastro dos contatos.
         */
        <p className="text-xs text-error-fg">
          {t("Não consegui ler as tags agora — tente de novo em instantes.")}
        </p>
      ) : (tags ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            "Nenhum contato tem tag ainda. A campanha vai para todos os contatos com telefone.",
          )}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2">
          {(tags ?? []).map((x) => {
            const ativa = selecionadas.includes(x.tag);
            return (
              <button
                key={x.tag}
                type="button"
                disabled={disabled}
                onClick={() => alternar(x.tag)}
                aria-pressed={ativa}
                className={[
                  "rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50",
                  ativa
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:border-muted-foreground/60",
                ].join(" ")}
              >
                {x.tag}{" "}
                <span className={ativa ? "opacity-70" : "text-muted-foreground"}>
                  ({x.quantos})
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {selecionadas.length === 0
          ? t("Nada marcado = todos os contatos com telefone.")
          : /*
              A regra é OU, não E — e dizê-la aqui evita a surpresa de marcar
              duas tags esperando a interseção e receber a união. O filtro no
              banco é `overlaps`.
            */
            t("Quem tiver QUALQUER uma das tags marcadas entra na lista.")}
      </p>

      {selecionadas.some((s) => !(tags ?? []).some((x) => x.tag === s)) ? (
        <p className="text-xs text-warning-fg">
          {t("Alguma tag marcada não existe mais nos contatos:")}{" "}
          {selecionadas
            .filter((s) => !(tags ?? []).some((x) => x.tag === s))
            .map((s) => (
              <Badge key={s} variant="outline" className="ml-1 text-xs">
                {s}
              </Badge>
            ))}
        </p>
      ) : null}
    </div>
  );
}
