"use client";

/**
 * DEFINIR A META DO MÊS.
 *
 * A rota de escrita e o hook `useDefinirMeta` existiam desde a primeira
 * entrega, e nenhuma tela os chamava: dava para acompanhar meta, não para
 * criar uma. O painel abria vazio dizendo "nenhuma meta definida" sem oferecer
 * onde definir — e a funcionalidade inteira ficava inalcançável para quem não
 * chama API na mão.
 *
 * ── As três perguntas, nesta ordem ──────────────────────────────────────────
 *
 * 1. O QUE medir. A métrica decide tudo o que vem depois, inclusive se o alvo é
 *    dinheiro ou contagem — por isso vem primeiro.
 * 2. DE QUEM é. A empresa inteira, uma pessoa, ou um agente de IA. A meta de
 *    reunião vale para a Mia igual vale para o SDR humano.
 * 3. QUANTO. Em reais ou em unidades, conforme a métrica — o campo troca
 *    sozinho, porque pedir "alvo em centavos" para reunião marcada é o tipo de
 *    formulário que só quem escreveu entende.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAgentsList } from "@/hooks/ai/useAgents";
import { useT } from "@/hooks/i18n/useT";
import { useDefinirMeta } from "@/hooks/useMetas";
import type { MetricaDeMeta } from "@/lib/crm/metas/progresso";
import { parseReaisToCents } from "@/lib/money";

const METRICAS: Array<{ valor: MetricaDeMeta; rotulo: string; ajuda: string }> = [
  {
    valor: "reunioes",
    rotulo: "Reuniões marcadas",
    ajuda: "Atividade de quem prospecta — o que ele controla.",
  },
  {
    valor: "reunioes_realizadas",
    rotulo: "Reuniões realizadas",
    ajuda: "Comparecimento: das marcadas, quantas aconteceram de verdade.",
  },
  {
    valor: "receita_total",
    rotulo: "Receita total",
    ajuda: "Tudo que foi ganho nos funis que contam como receita.",
  },
  {
    valor: "receita_recorrente",
    rotulo: "Receita recorrente",
    ajuda: "Só mensalidade e assinatura.",
  },
  { valor: "receita_avulsa", rotulo: "Receita avulsa", ajuda: "Só projeto, setup, venda única." },
  {
    valor: "receita_originada",
    rotulo: "Receita originada",
    ajuda: "A participação do SDR na venda que outro fechou. Exige escolher uma pessoa.",
  },
];

/** Métricas contadas em unidades; as demais, em dinheiro. */
const CONTAGEM = new Set<MetricaDeMeta>(["reunioes", "reunioes_realizadas"]);

export function DefinirMeta({ periodo }: { periodo: string }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [metrica, setMetrica] = useState<MetricaDeMeta>("reunioes");
  const [dono, setDono] = useState("organizacao");
  const [alvo, setAlvo] = useState("");
  const definir = useDefinirMeta(periodo);

  const { data: membros } = useAssignableMembers(aberto);
  const { data: agentes } = useAgentsList();

  const ehContagem = CONTAGEM.has(metrica);
  const escolhida = METRICAS.find((m) => m.valor === metrica);

  function salvar() {
    const bruto = alvo.trim();
    if (!bruto) {
      toast.error(t("Informe o alvo."));
      return;
    }
    const valor = ehContagem ? Number(bruto.replace(/\D/g, "")) : parseReaisToCents(bruto);
    if (!valor || valor <= 0) {
      toast.error(t("Alvo inválido."));
      return;
    }
    // `receita_originada` sem pessoa não tem resposta: a organização inteira
    // "origina" tudo, e a métrica devolveria zero para sempre. Recusar aqui é
    // melhor que gravar uma meta que nunca sai do lugar.
    if (metrica === "receita_originada" && !dono.startsWith("user:")) {
      toast.error(t("Receita originada é a meta de uma PESSOA — escolha quem."));
      return;
    }

    definir.mutate(
      {
        periodo,
        metrica,
        ...(ehContagem ? { alvo_quantidade: valor } : { alvo_cents: valor }),
        user_id: dono.startsWith("user:") ? dono.slice(5) : null,
        agent_id: dono.startsWith("agent:") ? dono.slice(6) : null,
      },
      {
        onSuccess: () => {
          toast.success(t("Meta definida."));
          setAlvo("");
          setAberto(false);
        },
        onError: (e: unknown) => {
          toast.error(e instanceof Error ? e.message : t("Não consegui gravar a meta."));
        },
      },
    );
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setAberto(true)}>
        {t("Definir meta")}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Definir meta do mês")}</DialogTitle>
            <DialogDescription>
              {t("O acompanhamento é derivado do funil e da agenda — você define só o alvo.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="meta-metrica">{t("O que medir")}</Label>
              <select
                id="meta-metrica"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={metrica}
                onChange={(e) => setMetrica(e.target.value as MetricaDeMeta)}
              >
                {METRICAS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {t(m.rotulo)}
                  </option>
                ))}
              </select>
              {escolhida ? (
                <p className="text-xs text-muted-foreground">{t(escolhida.ajuda)}</p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="meta-dono">{t("De quem é a meta")}</Label>
              <select
                id="meta-dono"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={dono}
                onChange={(e) => setDono(e.target.value)}
              >
                <option value="organizacao">{t("Da empresa inteira")}</option>
                {(membros ?? []).map((m) => (
                  <option key={m.user_id} value={`user:${m.user_id}`}>
                    {m.full_name ?? t("Sem nome")}
                  </option>
                ))}
                {/* O agente de IA entra na mesma lista: a meta de reunião vale
                    para a Mia igual vale para o SDR humano. */}
                {(agentes ?? []).map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.name} {t("(agente)")}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="meta-alvo">
                {ehContagem ? t("Alvo (quantidade)") : t("Alvo (R$)")}
              </Label>
              <Input
                id="meta-alvo"
                inputMode={ehContagem ? "numeric" : "decimal"}
                placeholder={ehContagem ? "20" : "50.000,00"}
                value={alvo}
                onChange={(e) => setAlvo(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={definir.isPending}>
              {t("Cancelar")}
            </Button>
            <Button onClick={salvar} disabled={definir.isPending}>
              {definir.isPending ? t("Salvando…") : t("Salvar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
