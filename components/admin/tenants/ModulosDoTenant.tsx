"use client";

/**
 * O QUE ESTE CLIENTE COMPROU.
 *
 * A tela lista o catálogo INTEIRO, e não só o que ele tem: quem abre isto está
 * num momento comercial, e uma lista que só mostra o contratado não responde
 * "o que mais eu posso vender para ele".
 *
 * Cancelar não apaga — carimba a data. A linha fica, e é o que permite
 * responder "desde quando ele tinha" e "quando saiu" numa conversa sobre
 * cobrança.
 */
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { Button } from "@/components/ui/button";
import {
  useCancelarModulo,
  useLiberarModulo,
  useModulosDoTenant,
} from "@/hooks/useModulosDoTenant";

export function ModulosDoTenant({ organizationId }: { organizationId: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading, error } = useModulosDoTenant(organizationId);
  const liberar = useLiberarModulo(organizationId);
  const cancelar = useCancelarModulo(organizationId);

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar os módulos agora.")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {t("O que não está nesta lista continua valendo para todos os clientes — aqui só entra o que se vende separado.")}
      </p>
      {data.modulos.map((m) => (
        <div
          key={m.chave}
          className="flex flex-col gap-2 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium">{m.rotulo}</p>
            <p className="text-sm text-text-muted">{m.descricao}</p>
            {m.liberado && m.granted_at && (
              <p className="mt-1 text-xs text-text-muted">
                {t("Liberado em")} {new Date(m.granted_at).toLocaleDateString(tag)}
              </p>
            )}
          </div>
          {m.liberado ? (
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={cancelar.isPending}
              onClick={() => cancelar.mutate(m.chave)}
            >
              {t("Cancelar")}
            </Button>
          ) : (
            <Button
              className="shrink-0"
              disabled={liberar.isPending}
              onClick={() => liberar.mutate(m.chave)}
            >
              {t("Liberar")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
