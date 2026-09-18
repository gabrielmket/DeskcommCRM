"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface TagDeContato {
  tag: string;
  /** Quantos contatos têm esta tag. É o que responde antes de custar. */
  quantos: number;
}

/**
 * O vocabulário real de tags dos CONTATOS desta organização.
 *
 * "Real" é a palavra que importa: não é uma lista canônica configurada em algum
 * lugar, é o que está gravado nos contatos agora. Tag que ninguém tem não
 * aparece; tag que alguém criou digitando aparece no dia seguinte sem cadastro
 * nenhum.
 *
 * Não confundir com `useConversationTags`, que lê o vocabulário de tags de
 * CONVERSA das configurações da organização — outra coluna, outro propósito.
 */
export function useContactTags() {
  return useQuery({
    queryKey: ["contact-tags"],
    queryFn: async () => apiClient.get<{ data: { tags: TagDeContato[] } }>("/api/v1/contacts/tags"),
    select: (r) => r.data.tags,
    // Tag muda devagar (alguém marcando contato), e o seletor é reaberto muitas
    // vezes ao montar campanhas seguidas. Um minuto evita uma ida ao banco por
    // clique sem deixar o número velho o suficiente para enganar.
    staleTime: 60_000,
  });
}
