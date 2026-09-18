---
impacto: nada_mudou
secao: corrigido
titulo: Alargar a janela de envio destrava na hora as respostas que estavam esperando
---

Quando a janela de envio do número está fechada, a resposta da IA fica na fila
até a janela abrir — isso é proposital e protege o número de bloqueio. O que não
funcionava era o caminho de volta: quem alargasse a janela pela tela não
destravava nada. As respostas continuavam marcadas para o horário antigo, e a
impressão era de que a configuração não tinha efeito. Agora, mexer na janela de
um número traz de volta, na hora, os atendimentos que estavam parados
esperando por ela.

No mesmo caminho, três consertos que só apareciam quando algo dava errado:

- Com a janela fechada, a mensagem SEGUINTE do contato entrava de carona no
  atendimento já adiado. Se ela chegasse por outro canal, ficava pendurada numa
  conversa diferente da dela e nunca era respondida.
- O aviso de "este material não entrou na base de conhecimento" ficava aberto
  para sempre na Central, mesmo depois de o material entrar. Agora ele se fecha
  sozinho quando a indexação conclui.
- A ficha de anti-ban de cada conexão registrava a data da última alteração e
  nunca a atualizava — quem fosse investigar lia a data de criação achando que
  era a da última mudança.

E a ferramenta que permite ao assistente anotar um aprendizado da empresa
(`crm_save_org_memory`) passa a funcionar: ela nunca havia gravado nada, e o
banco recusava toda tentativa. Em Memória da IA, essas anotações aparecem
marcadas como "anotado pela IA", separadas do que uma pessoa escreveu.
