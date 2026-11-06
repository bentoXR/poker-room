# Poker Room --- Contexto do projeto

## O que é

Poker Room é uma aplicação web para organizar partidas **presenciais de
poker entre amigos**. Ela serve como uma mesa/gerenciador compartilhado
de fichas e turnos. Não é uma plataforma para jogar poker online.

O objetivo é manter a aplicação simples, confiável e fácil de usar. Não
transformar o projeto em um produto complexo nem introduzir tecnologias
sem necessidade.

## Tecnologias e publicação

-   **Frontend:** um único arquivo `index.html`, com HTML, CSS e
    JavaScript no próprio arquivo.
-   **Backend:** Supabase (PostgreSQL, funções RPC e recursos em tempo
    real).
-   **Biblioteca:** `supabase-js` v2 carregada por CDN.
-   **Repositório:** GitHub.
-   **Hospedagem:** GitHub Pages.
-   **Desenvolvimento assistido:** Claude, usando o plano gratuito e
    podendo alternar entre contas.

O arquivo HTML analisado tinha aproximadamente 2.319 linhas. O CSS fica
em um bloco `<style>` e a maior parte do JavaScript em um bloco
`<script>`.

## Como a aplicação está organizada hoje

A interface tem estas telas principais:

1.  Login/criação de conta.
2.  Lista de salas.
3.  Criação de sala/partida.
4.  Entrada ou escolha de participação.
5.  Mesa da partida.
6.  Tela de carregamento.

Entre as funções identificadas no JavaScript estão: login e criação de
conta, carregar salas, criar/abrir sala, entrar como jogador ou
espectador, atualizar a mesa, carregar histórico, sincronização em tempo
real, sinal de presença, ações de jogo, blinds, desfazer jogada,
distribuição do pote, reiniciar/encerrar partida e iniciar a aplicação.

O estado da aplicação é mantido principalmente em variáveis JavaScript
globais. Não reorganizar isso apenas por preferência estética: primeiro
entender o funcionamento e só depois propor mudanças que tragam
benefício concreto.

## Supabase: visão geral encontrada no arquivo de exportação

O arquivo SQL/exportação fornecido contém:

-   Tabelas relacionadas a contas, partidas, jogadores, histórico,
    presença, segredos e senhas de jogadores.
-   Funções RPC para login, criação e entrada em contas/salas, ações de
    jogo, blinds, distribuição do pote, histórico, presença e limpeza de
    salas inativas.
-   Políticas RLS registradas para leitura (`SELECT`) de `historico`,
    `jogadores` e `partidas`.

A exportação consultada lista 26 funções RPC, 53 colunas, 12 restrições,
11 índices e 3 políticas RLS. Isso é apenas um inventário do arquivo
recebido, não uma auditoria de segurança nem uma confirmação de que o
banco atualmente publicado continua idêntico.

O frontend contém uma URL do projeto Supabase e uma chave
`sb_publishable_`. Não copiar credenciais para documentação, mensagens
ou exemplos. Não substituir essa chave por uma chave `service_role`. A
segurança precisa ser avaliada considerando as políticas RLS e as
funções RPC, sem presumir que a configuração atual está correta ou
incorreta.

## Regras de trabalho para o Claude

1.  Antes de qualquer tarefa, leia `CONTEXTO.md` e `ANDAMENTO.md`.
2.  Considere o código e o banco existentes como referência. Não invente
    funcionalidades nem presuma que algo existe sem verificar.
3.  Faça somente o que foi pedido. Se perceber um problema relacionado,
    explique e pergunte antes de ampliar o escopo.
4.  Prefira a menor alteração que resolva o problema.
5.  Preserve o visual, os fluxos e as funções que já funcionam, salvo
    quando a tarefa pedir mudança.
6.  Não reescreva o arquivo inteiro para fazer uma alteração pequena.
7.  Não divida o projeto em vários arquivos, não adicione frameworks,
    bibliotecas ou ferramentas sem uma razão clara e aprovação.
8.  Antes de editar, explique brevemente o que pretende alterar e quais
    partes podem ser afetadas.
9.  Se houver dúvida sobre o comportamento atual, inspecione o código e
    pergunte em vez de adivinhar.
10. Não altere tabelas, políticas RLS, funções RPC ou dados do Supabase
    sem autorização explícita. Para mudanças no banco, mostre o SQL e
    explique o efeito antes de qualquer execução.
11. Nunca exponha senhas, tokens, segredos de jogadores ou chaves
    privadas. Não coloque credenciais em arquivos Markdown.
12. Depois de uma alteração, informe os arquivos modificados, o que
    mudou e como testar manualmente.
13. Atualize `ANDAMENTO.md` ao concluir uma tarefa relevante, deixando
    claro o que foi feito, o que ainda falta e o próximo passo.
14. Como o responsável pelo projeto não é programador, explique decisões
    técnicas em linguagem simples e sem excesso de jargão.

## Como lidar com a troca de contas gratuitas do Claude

O histórico de conversa de uma conta não deve ser necessário para
continuar o projeto.

Ao começar em qualquer conta: - Abra o repositório atualizado no
GitHub. - Leia primeiro `CONTEXTO.md` e `ANDAMENTO.md`. - Confira o
código atual antes de sugerir ou aplicar mudanças. - Não confie em
cópias antigas do HTML anexadas em conversas anteriores se o GitHub
tiver uma versão mais recente.

Ao terminar: - Atualize `ANDAMENTO.md` com o resultado real. - Não
marque testes como concluídos se não foram executados. - Deixe
instruções curtas para a próxima conta continuar.

## Prompt inicial recomendado

> Antes de fazer qualquer coisa, leia `CONTEXTO.md` e `ANDAMENTO.md` no
> repositório. Depois confira os arquivos atuais do projeto. Resuma em
> poucas linhas o estado atual e a próxima tarefa registrada. Não faça
> alterações ainda; aguarde minha solicitação.
