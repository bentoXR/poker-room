# Poker Room --- Andamento

> Atualize este arquivo sempre que uma tarefa relevante for concluída.
> Ele existe para que qualquer conta gratuita do Claude consiga
> continuar o projeto sem depender do histórico de outra conta.

## Estado atual

-   A aplicação já existe e é usada/pretendida para partidas presenciais
    entre amigos.
-   O frontend está concentrado em `index.html` (HTML, CSS e JavaScript
    no mesmo arquivo).
-   O backend usa Supabase, com tabelas e funções RPC.
-   O código é armazenado no GitHub e publicado pelo GitHub Pages.
-   O projeto está em fase de organização do fluxo de trabalho com
    Claude; **não há, neste registro, uma refatoração ou auditoria
    técnica concluída**.

## Arquivos de referência já analisados

-   `index (1).html`: versão enviada na conversa, com cerca de 2.319
    linhas. Deve ser tratada como uma cópia de referência, não
    necessariamente a versão mais recente do GitHub.
-   `Texto colado.txt`: exportação de estrutura SQL do Supabase. Contém
    inventário de tabelas/colunas, funções RPC, restrições, índices e
    políticas RLS.

## Decisões já tomadas

-   Manter a aplicação simples. Não migrar de tecnologia nem dividir o
    HTML em vários arquivos neste momento.
-   Usar o GitHub como referência principal do código.
-   Manter estes dois documentos no repositório para compartilhar
    contexto entre diferentes contas gratuitas do Claude.
-   Antes de uma alteração, pedir ao Claude que leia estes documentos e
    confira a versão atual do código.
-   Fazer alterações pequenas e testar antes de publicar.

## O que ainda não foi feito

-   [ ] Confirmar que `CONTEXTO.md` e `ANDAMENTO.md` foram adicionados
    ao repositório GitHub.
-   [ ] Confirmar o nome exato do arquivo principal no repositório
    (esperado: `index.html`).
-   [ ] Fazer uma revisão geral do código atual. Nenhuma revisão
    completa foi concluída neste registro.
-   [ ] Fazer uma revisão das configurações de segurança do Supabase.
    Nenhuma auditoria foi concluída neste registro.
-   [ ] Montar uma lista curta de testes manuais das funções principais.

## Próximo passo

Adicionar `CONTEXTO.md` e `ANDAMENTO.md` à raiz do repositório GitHub.
Depois, abrir o repositório no Claude e testar o prompt inicial descrito
em `CONTEXTO.md`.

## Registro de alterações

### Preparação da documentação

-   Criados `CONTEXTO.md` e `ANDAMENTO.md` com base no HTML e na
    exportação SQL enviados anteriormente.
-   Não houve alteração no código da aplicação nem no banco Supabase.
-   Não foram executados testes funcionais.
