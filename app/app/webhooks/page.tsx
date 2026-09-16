import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { WebhooksClient } from "./_components/WebhooksClient";

export const dynamic = "force-dynamic";
// O título acompanha o rótulo do menu (ver lib/navigation/catalogo.ts): a aba
// mais usada desta tela é Automações, e o nome antigo escondia isso.
export const metadata: Metadata = { title: "Automações" };

export default async function WebhooksPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const canManage = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  if (!canManage) redirect("/app/inbox");
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Automações", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Receba contatos de fora (landing pages, formulários) e crie automações que agem sozinhas.",
            idioma,
          )}
        </p>
      </header>
      <WebhooksClient />
    </div>
  );
}
