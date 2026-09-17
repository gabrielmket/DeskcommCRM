"use client";

/**
 * CRIAR TEMPLATE SEM SAIR DAQUI.
 *
 * O espelho mostrava o que existe na Meta e mandava o operador criar lá. Quem
 * configurou o canal uma vez não devia precisar voltar ao WhatsApp Manager para
 * escrever uma mensagem — é o mesmo produto, e sair dele para usá-lo é meia
 * funcionalidade.
 *
 * ── O que a tela impede ANTES de gastar uma submissão ───────────────────────
 *
 * Template reprovado não é grátis: entra na fila de análise da Meta, volta dias
 * depois, e reprovação suja a reputação da conta. Por isso as duas recusas mais
 * comuns são checadas aqui, com frase que diz o que corrigir:
 *
 *  • nome fora de `minúscula_número_underline`
 *  • variável `{{n}}` sem exemplo (a Meta exige um por variável, e recusa sem
 *    dizer qual faltou)
 *
 * ── Por que o botão de sair vem sugerido ────────────────────────────────────
 *
 * "Parar promoções" é o que mais ajuda na aprovação e o que segura bloqueio:
 * quem consegue sair sozinho não denuncia. Vem preenchido, e dá para tirar.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { useCriarTemplate } from "@/hooks/channels/useTemplates";

/** As mesmas regras de `lib/channels/meta/criar-template.ts`, para avisar antes. */
function variaveis(texto: string): number {
  const achadas = new Set<string>();
  for (const m of texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) achadas.add(m[1]!);
  return achadas.size;
}
function nomeOk(nome: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(nome);
}

const CATEGORIAS = [
  { valor: "MARKETING", rotulo: "Marketing", ajuda: "Prospecção, oferta, retomada de conversa." },
  { valor: "UTILITY", rotulo: "Utilidade", ajuda: "Confirmação, lembrete, atualização de pedido." },
] as const;

export function CriarTemplate() {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [corpo, setCorpo] = useState("");
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [rodape, setRodape] = useState("");
  const [botaoSair, setBotaoSair] = useState(true);
  const criar = useCriarTemplate();

  const quantas = variaveis(corpo);
  const nomeInvalido = nome.length > 0 && !nomeOk(nome);
  const faltamExemplos = quantas > exemplos.filter((e) => e?.trim()).length;

  function enviar() {
    if (!nome.trim() || !corpo.trim()) {
      toast.error(t("Preencha o nome e o texto."));
      return;
    }
    if (nomeInvalido) {
      toast.error(t("O nome só aceita letras minúsculas, números e _."));
      return;
    }
    if (faltamExemplos) {
      toast.error(t("Cada variável precisa de um exemplo — a Meta recusa sem eles."));
      return;
    }
    criar.mutate(
      {
        name: nome.trim(),
        language: "pt_BR",
        category: categoria,
        body: corpo,
        exemplos: exemplos.slice(0, quantas).map((e) => e.trim()),
        botoes: botaoSair ? ["Parar promoções"] : undefined,
        footer: rodape.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("Template enviado para análise da Meta."));
          setAberto(false);
          setNome("");
          setCorpo("");
          setExemplos([]);
          setRodape("");
        },
        onError: (e: unknown) => {
          toast.error(e instanceof Error ? e.message : t("Não consegui criar o template."));
        },
      },
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setAberto(true)} data-testid="btn-criar-template">
        {t("Criar template")}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Criar template")}</DialogTitle>
            <DialogDescription>
              {t("A Meta analisa antes de liberar — costuma levar de minutos a algumas horas. Você acompanha o estado nesta mesma tela.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="tpl-nome">{t("Nome")}</Label>
              <Input
                id="tpl-nome"
                value={nome}
                placeholder="mia_primeiro_contato"
                onChange={(e) => setNome(e.target.value.toLowerCase())}
              />
              <p className={`text-xs ${nomeInvalido ? "text-error-fg" : "text-muted-foreground"}`}>
                {nomeInvalido
                  ? t("Só letras minúsculas, números e _ — sem espaço e sem acento.")
                  : t("Só letras minúsculas, números e _. É o identificador, não aparece para o cliente.")}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="tpl-cat">{t("Categoria")}</Label>
              <select
                id="tpl-cat"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as "MARKETING" | "UTILITY")}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {t(c.rotulo)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t(CATEGORIAS.find((c) => c.valor === categoria)?.ajuda ?? "")}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="tpl-corpo">{t("Texto da mensagem")}</Label>
              <Textarea
                id="tpl-corpo"
                rows={6}
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                placeholder={t("Olá, {{1}}! Aqui é {{2}}, da {{3}}.")}
              />
              <p className="text-xs text-muted-foreground">
                {t("Use {{1}}, {{2}} onde o texto muda por pessoa.")}
              </p>
            </div>

            {quantas > 0 ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">{t("Exemplo de cada variável")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("A Meta exige um exemplo por variável para analisar — e recusa sem dizer qual faltou.")}
                </p>
                {Array.from({ length: quantas }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                      {`{{${i + 1}}}`}
                    </span>
                    <Input
                      value={exemplos[i] ?? ""}
                      onChange={(e) => {
                        const next = [...exemplos];
                        next[i] = e.target.value;
                        setExemplos(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="tpl-rodape">{t("Rodapé (opcional)")}</Label>
              <Input
                id="tpl-rodape"
                value={rodape}
                maxLength={60}
                onChange={(e) => setRodape(e.target.value)}
                placeholder={t("Time Company")}
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={botaoSair}
                onChange={(e) => setBotaoSair(e.target.checked)}
              />
              <span>
                {t("Incluir botão \"Parar promoções\"")}
                <span className="block text-xs text-muted-foreground">
                  {t("É o que mais ajuda na aprovação e o que segura bloqueio: quem consegue sair sozinho não denuncia.")}
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={criar.isPending}>
              {t("Cancelar")}
            </Button>
            <Button onClick={enviar} disabled={criar.isPending}>
              {criar.isPending ? t("Enviando…") : t("Enviar para análise")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
