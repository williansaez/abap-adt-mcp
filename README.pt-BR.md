# abap-adt-mcp

**Deixe o Claude ler, escrever, testar e verificar código ABAP nos seus sistemas SAP.**

[![npm version](https://img.shields.io/npm/v/abap-adt-mcp)](https://www.npmjs.com/package/abap-adt-mcp)
[![CI](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/abap-adt-mcp)](https://nodejs.org)
[![MCP Registry](https://img.shields.io/badge/MCP%20registry-io.github.williansaez%2Fabap--adt--mcp-informational)](https://registry.modelcontextprotocol.io/?search=abap-adt-mcp)

[English](README.md) · Português (Brasil) · [Deutsch](README.de.md)

abap-adt-mcp é um servidor [Model Context Protocol](https://modelcontextprotocol.io). Execute-o ao lado do Claude Desktop, do Claude Code ou de qualquer outro host MCP, aponte-o para um ou mais sistemas SAP, e o modelo passa a ter os mesmos endpoints REST do ADT que o Eclipse usa: pesquisar objetos, ler e editar código-fonte, criar ordens de transporte, ativar, executar ABAP Unit e ATC, ler dumps, consultar tabelas. Um único servidor expõe **173 ferramentas** sobre quantos sistemas SAP você configurar, S/4HANA Cloud e on-premise igualmente.

> Use com critério e prefira sistemas de desenvolvimento. Um destino sem bloco `policy` é totalmente gravável dentro das suas autorizações SAP. As salvaguardas por destino (somente leitura, pacotes permitidos, tabelas negadas) são aplicadas pelo próprio servidor, independentemente do que o host aprova, de modo que um prompt descuidado não alcança o sistema errado.

## Sumário

- [O que há de novo na 2.0.0](#o-que-há-de-novo-na-200)
- [Instalação](#instalação)
- [O que pedir ao modelo](#o-que-pedir-ao-modelo)
- [Fluxos de trabalho em detalhe](#fluxos-de-trabalho-em-detalhe)
- [Prompts embutidos](#prompts-embutidos)
- [Outras formas de instalar](#outras-formas-de-instalar)
- [Autenticação](#autenticação)
- [Mantendo a segurança](#mantendo-a-segurança)
- [Log de auditoria](#log-de-auditoria)
- [S/4HANA Cloud versus on-premise](#s4hana-cloud-versus-on-premise)
- [Referência de configuração](#referência-de-configuração)
- [Transporte HTTP (opcional)](#transporte-http-opcional)
- [Catálogo de ferramentas (todas as 173 ferramentas, por toolset)](#catálogo-de-ferramentas-todas-as-173-ferramentas-por-toolset)
- [Comparação com o ADT MCP Server oficial da SAP](#comparação-com-o-adt-mcp-server-oficial-da-sap)
- [Skills e plugin](#skills-e-plugin)
- [Solução de problemas](#solução-de-problemas)
- [Testes e contribuição](#testes-e-contribuição)
- [Licença](#licença)

## O que há de novo na 2.0.0

Lançada em 2026-09-08. A lista completa está no [CHANGELOG.md](CHANGELOG.md#200---2026-09-08---node-22-floor-puppeteer-core-25-dependabot-cooldown-tls-by-name); o que importa ao atualizar:

- **Node.js 22.12 ou mais novo passa a ser obrigatório** (mudança incompatível). Node 18 e 20 chegaram ao fim da vida útil e não recebem correções de segurança; um servidor que guarda credenciais SAP não deve rodar neles. Em um Node mais antigo o `npm` imprime `EBADENGINE` e o servidor não é testado; instale o LTS atual e reinicie o host. A imagem de contêiner já estava em `node:22-alpine`.
- **`tls.servername` por destino.** Para um sistema acessado por endereço IP ou nome curto cujo certificado carrega o nome totalmente qualificado: o nome é verificado e enviado como SNI, a verificação continua ligada, e `insecureTls` deixa de ser o único caminho nesse cenário. `listSystems` mostra `servername NOME`.
- **Erros de certificado ensinam a correção.** Um handshake que falha chega ao modelo como `kind: "tlsCertificate"` com uma dica que nomeia o destino: emissor desconhecido devolve a linha `openssl s_client` daquele host e aponta para `tls.ca`, nome divergente cita os nomes que o Node reportou e aponta para `tls.servername`, certificado expirado avisa que só a renovação resolve. `insecureTls` é mencionado por último.
- **`insecureTls` permanece**, por destino, desligado por padrão, anunciado na inicialização; o [SECURITY.md](SECURITY.md#tls) registra o porquê.
- **Cadeia de suprimentos.** `puppeteer-core` 25 remove da árvore de dependências o último alerta aberto do Dependabot (`npm audit` reporta zero vulnerabilidades); o Dependabot agora aguarda um período de carência antes de propor atualizações e agrupa as de segurança em um único pull request; `dotenv` é carregado em modo silencioso para que stdout continue um canal JSON-RPC limpo.

Atualizar a partir da 1.x não exige mudança de configuração: `systems.json`, as políticas, os nomes das ferramentas e as variáveis de ambiente não mudaram.

## Instalação

Três coisas antes de começar:

- **Node.js 22.12 ou mais novo** (22 ou 24 LTS; a 2.0.0 abandonou o Node 18 e 20). Baixe o instalador LTS em [nodejs.org](https://nodejs.org); ele traz `npm` e `npx`, que é tudo de que o host precisa. Não é preciso terminal para conferir: se o Node estiver faltando, o log do host mostra `spawn npx ENOENT` ao tentar iniciar o servidor (veja o [passo 2](#2-registre-o-servidor-no-seu-host)).
- **Acesso ao sistema SAP.** No S/4HANA Cloud (edição pública) não há nada a configurar do lado SAP para usuários nomeados: o seu usuário precisa da business role que libera o Eclipse ADT no tenant (`SAP_BR_DEVELOPER` na entrega padrão); se o Eclipse ADT funciona para você, este servidor também funciona. On-premise, o serviço `/sap/bc/adt` precisa estar ativo na transação `SICF` (tarefa de Basis) e o seu usuário precisa das autorizações habituais de desenvolvimento ADT. Só clientes `oauth` não assistidos precisam de um Communication Arrangement, veja [Autenticação](#autenticação).
- **Um navegador Chromium** (Chrome, Edge ou Brave) na máquina, quando usar SSO pelo navegador.

### 1. Descreva os seus sistemas SAP

Crie uma pasta `.abap-adt-mcp` na sua pasta pessoal e, dentro dela, um arquivo `systems.json`, uma entrada por sistema (um "destino"). Sem terminal: no macOS abra o Finder, pressione Shift-Cmd-G, digite `~`, crie a pasta (o Finder pede confirmação para um nome que começa com ponto; Shift-Cmd-. mostra pastas ocultas) e salve o arquivo ali com qualquer editor de texto. No Windows a pasta é `C:\Users\<você>\.abap-adt-mcp`, criada no Explorador de Arquivos como qualquer outra. Um tenant S/4HANA Cloud com SSO pelo navegador precisa exatamente disto:

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true
  }
}
```

`url` é obrigatório; `client` é o mandante em que a sua sessão SSO aterrissa (nos tenants testados o sistema de desenvolvimento logava em `080` e os sistemas de customizing e teste em `100`; a entrada Sobre no menu de usuário do launchpad mostra o valor); `authType` assume `sso` por padrão e `"default": true` permite omitir o nome do destino em toda chamada. A chave (`DEV`) é escolha sua e é o nome que você usará nas conversas. Vários sistemas, com salvaguardas, ficam assim (ou copie [systems.example.json](systems.example.json)):

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["Z*"] }
  },
  "PRD": {
    "url": "https://myYYYYYY.s4hana.cloud.sap",
    "client": "100",
    "authType": "sso",
    "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*", "USR02"], "allowFreeSql": false }
  },
  "ONPREM": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ONPREM_PASSWORD}",
    "policy": { "allowedPackages": ["Z*", "$*"] },
    "tls": { "ca": "/etc/ssl/corp-ca.pem" }
  }
}
```

O padrão para qualquer sistema produtivo ou de teste é a entrada `PRD`: acrescente `"policy": { "readOnly": true }` e o servidor recusa toda escrita ali, seja o que for que peçam ao modelo. `sso` abre um navegador real uma vez para usuários nomeados do S/4HANA Cloud; `basic` é para usuários on-premise e Communication Users; `oauth` é para clientes não assistidos. `${env:VAR}` lê um segredo do ambiente para que ele nunca fique no arquivo, `policy` é aplicada pelo servidor, e `tls.ca` acrescenta uma CA corporativa com a verificação mantida ligada (`tls.servername` nomeia o certificado quando o sistema é acessado por endereço IP). `$*` (pacotes locais) aparece só na entrada on-premise porque o tenant Public Cloud testado recusa `$TMP`.

Se tiver um terminal, restrinja o arquivo ao seu usuário:

```bash
chmod 600 ~/.abap-adt-mcp/systems.json
```

Você pode pular este passo quando o arquivo não contém senhas em texto (um arquivo só com SSO, ou segredos referenciados como `${env:VAR}`): o servidor então só imprime um aviso se o arquivo for legível por outros. Ele se recusa a iniciar apenas quando um arquivo legível por outros contém senhas, client secrets ou senhas git em texto. O Windows não tem modos de arquivo; a verificação é pulada lá.

### 2. Registre o servidor no seu host

O pacote está no npm como [`abap-adt-mcp`](https://www.npmjs.com/package/abap-adt-mcp) (publicado por trusted publishing com proveniência), então `npx` é tudo de que você precisa.

**Claude Code**, uma linha:

```bash
claude mcp add abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -- npx -y abap-adt-mcp
```

**Claude Desktop** (Settings > Developer > Edit Config, depois feche e reabra o aplicativo). Substitua `me` pelo seu nome de usuário; no Windows escreva o caminho como `C:/Users/<você>/.abap-adt-mcp/systems.json`:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": { "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json", "MCP_TOOLSETS": "focused" }
    }
  }
}
```

`MCP_TOOLSETS=focused` publica as 114 ferramentas de desenvolvimento em vez de todas as 173, o que evita que os esquemas das ferramentas consumam a janela de contexto da conversa; retire-o quando precisar dos toolsets de depurador, traces, abapGit, RAP ou refatoração. O mesmo JSON funciona no Cursor, no Cline e em outros hosts que leem um mapa `mcpServers`; o VS Code chama o mapa de `servers`, então renomeie a chave de nível superior lá ([docs/HOSTS.md](docs/HOSTS.md) traz a forma por host). A chave `abap-adt-mcp` é o nome que o host mostra para o servidor e o prefixo de toda ferramenta (`mcp__abap-adt-mcp__searchObject` no Claude Code); skills ABAP públicas escritas para este servidor procuram por esse nome, então uma chave diferente só impede essas skills de reconhecer o servidor, nada mais quebra.

Após reiniciar, o Claude Desktop lista `abap-adt-mcp` com um status em Settings > Developer, e o menu de ferramentas abaixo da caixa de conversa (ícone de controles deslizantes) mostra o servidor com suas ferramentas. Se nada aparecer, leia o log do host: no momento em que isto foi escrito o Claude Desktop grava `mcp.log` e `mcp-server-abap-adt-mcp.log` em `~/Library/Logs/Claude` no macOS e em `%APPDATA%\Claude\logs` no Windows, e o Claude Code mostra o estado com `/mcp`. Tudo o que o servidor imprime (avisos de inicialização, o aviso do arquivo de auditoria, mensagens de `MCP_PROFILE_GATE=warn`) vai para stderr e termina nesse log. Tanto o Claude Desktop quanto o Claude Code perguntam antes de executar uma ferramenta que você não aprovou permanentemente; esse diálogo é comportamento do host e independe da anotação `destructiveHint`, então trate-o como cortesia e o bloco `policy` como garantia.

### 3. Diga olá

Abra uma conversa nova e digite (troque `DEV` pela chave que você escolheu no `systems.json`):

> Liste meus sistemas SAP, faça login no DEV e mostre o código-fonte da classe CL_ABAP_CHAR_UTILITIES.

O modelo chama `listSystems`, `login` (uma janela de navegador aparece para destinos SSO; marque "permanecer conectado" e os próximos logins são silenciosos), `searchObject` e `getObjectSource`. Quando o código-fonte voltar, está pronto. `login` é opcional em todos os modos: o dispatcher faz o login pelo navegador antes da primeira chamada em um destino SSO, e destinos `basic` e `oauth` autenticam na primeira requisição. Chame-o explicitamente só para forçar um login novo ou para provar as credenciais antes de qualquer outra coisa. Pedir `healthcheck` devolve a versão do servidor, os nomes dos destinos, o destino padrão, os toolsets ativos e a contagem de ferramentas; `systemProfile` diz se um destino é S/4HANA Cloud ou on-premise e quais toolsets ele não consegue servir.

## O que pedir ao modelo

O servidor é uma caixa de ferramentas de que o modelo escolhe: peça em linguagem natural e ele define a sequência. Coisas que funcionam bem desde a primeira sessão:

| Pedido | Ferramentas que o modelo usa |
|---|---|
| "Explique o que o método GET_DATA de ZCL_ORDER_SERVICE faz." | `searchObject`, `getMethodSource` |
| "Onde a tabela ZTABLE ainda é usada, e por quais programas?" | `whereUsed`, `sourceTextSearch`, `grepPackage` |
| "Mostre os campos e associações da CDS view ZI_PRODUCT." | `cdsViewInfo`, `objectStructureElements` |
| "Adicione uma verificação de nulo no início de GET_DATA, ative e rode os testes unitários." | `resolveTransport`, `syntaxCheckCode`, `editObjectSource` (com `activate=true`), `unitTestRun`, `objectDiff` |
| "Crie a classe ZCL_HELLO no pacote ZDEMO que imprime Hello World, com um teste unitário." | `validateNewObject`, `resolveTransport`, `createObject`, `setObjectSource`, `createTestInclude`, `unitTestRun` |
| "Rode o ATC no pacote ZFIN e aplique todo quickfix que for seguro." | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcSummary` |
| "O que mudou na ordem `DEVK900123`? Revise e diga se é seguro liberar." | `transportDetails`, `transportUnifiedDiff` |
| "Por que aconteceu o último dump do usuário DEVELOPER? Proponha uma correção." | `dumps`, `dumpDetails`, `getObjectSource` |
| "ZCL_ORDER_SERVICE está pronta para ABAP Cloud? Quais objetos SAP bloqueiam?" | `apiReleaseState`, `createAtcRun` |
| "Selecione as dez linhas mais recentes de ZTABLE onde STATUS = 'X'." | `runQuery` (ou `tableContents` quando a pré-visualização de dados recusa uma tabela) |
| "Experimente este trecho e mostre a saída." | `runSnippet` |
| "Quais toolsets o DEV suporta? O depurador está disponível lá?" | `systemProfile` |

Em um sistema on-premise comum o exemplo de criação também funciona com `$TMP` e sem ordem de transporte; o tenant S/4HANA Cloud testado recusou `$TMP`, então lá você nomeia um pacote de cliente e sua ordem (veja [S/4HANA Cloud versus on-premise](#s4hana-cloud-versus-on-premise)).

Hábitos que o servidor já traz embutidos, para que você não precise explicá-los: ferramentas de escrita bloqueiam e desbloqueiam sozinhas; `activate=true` ativa na mesma chamada; todo erro é JSON com `kind`, `hint` e `nextTools`, então o modelo se recupera em vez de repetir às cegas; sessões expiradas são reautenticadas e a chamada é repetida uma vez; resultados grandes são paginados dentro de um orçamento de 40.000 caracteres (`MCP_MAX_RESPONSE_CHARS`) e reportam `hasMore`; chamadas longas enviam notificações de progresso MCP aos hosts que passam um `progressToken` (mais um heartbeat a cada 10 segundos). Os fluxos canônicos de criação e edição viajam no campo `instructions` do MCP, e toda ferramenta carrega anotações `readOnlyHint`/`destructiveHint` para que hosts que condicionam a aprovação pela anotação perguntem apenas nas escritas.

## Fluxos de trabalho em detalhe

As sequências completas ferramenta por ferramenta, formatos de argumentos e receitas estão em [docs/WORKFLOWS.md](docs/WORKFLOWS.md); esta seção é a versão curta.

Toda ferramenta exceto `listSystems` e `healthcheck` aceita um `destination` opcional; ele é obrigatório quando há vários sistemas configurados e nenhum está marcado como `default` (ou nomeado em `SAP_DEFAULT_DESTINATION`).

**URLs e nomes.** `searchObject` devolve a URL do objeto, por exemplo `/sap/bc/adt/oo/classes/zcl_example`; a URL do código-fonte é essa mais `/source/main`; includes de classe (implementações, classes de teste) usam as URLs de `classIncludes` como vêm. As ferramentas herdadas de várias gerações anteriores nomeiam essa URL de formas diferentes (`objSourceUrl`, `objectSourceUrl`, `objectUrl`, `classUrl`, `url`, `mainUrl`), então o dispatcher mapeia os nomes para o esquema de cada ferramenta e remove ou acrescenta `/source/main` quando necessário: o valor de `searchObject` pode ser passado a qualquer uma delas. Ferramentas de nível de classe (`getMethodSource`, `setMethodSource`, `whereUsed`, `cdsViewInfo`) também aceitam o nome simples.

**Encontrar e ler código.** `searchObject` encontra objetos por nome. Por conteúdo, `sourceTextSearch` usa o índice de texto do ADT e `grepPackage` faz grep nos fontes do pacote do lado do cliente com linhas de contexto (a alternativa quando um tenant não tem índice de texto). `packageTree`, `whereUsed`, `cdsViewInfo`, `typeHierarchy` e `classComponents` dão navegação no estilo de uma IDE. `getObjectSource` lê um fonte (paginado com `startLine`/`maxLines`, `version=inactive` para código não ativado), `getMethodSource` um método, e `exportPackageSources` grava uma árvore de pacote em disco no layout do abapGit para ferramentas locais.

**Editar com segurança.** Escritas bloqueiam, gravam e desbloqueiam sozinhas e ativam quando você passa `activate=true`:

1. `resolveTransport(objSourceUrl)` devolve a ordem que já registra o objeto, a mais nova modificável para o seu pacote, ou `needsTransport: false` para pacotes locais; `createIfMissing=true` cria uma quando não existe nenhuma.
2. `syntaxCheckCode` no fonte pretendido: opcional para uma mudança de uma linha, seguro barato para qualquer coisa maior.
3. `editObjectSource(objectSourceUrl, replacements=[{oldText, newText}], activate=true, transport)` para mudanças pontuais (o servidor relê o SAP primeiro; cada `oldText` deve casar exatamente uma vez, senão a chamada falha com "0 matches" ou os números de linha de cada ocorrência e nada é gravado), `setMethodSource(classUrl, methodName, source, activate=true, transport)` para trocar um bloco `METHOD ... ENDMETHOD` na implementação (passe o bloco inteiro ou só o corpo; a parte de definição fica como está; `include` e `className` selecionam classes locais ou de teste; um método desconhecido é recusado com a lista dos métodos presentes), `setObjectSource` para reescritas completas.
4. Leia o campo `activation` do resultado; corrija e grave de novo, ou `activateByName` / `activatePackage` mais tarde.
5. `unitTestRun(url)`, depois `objectDiff(objectUrl)` para mostrar o que mudou em relação à revisão anterior.

`lock`/`unLock` só mantêm um bloqueio ao longo de várias escritas; `listLocks` e `forceUnlock` recuperam de uma escrita que falhou. Um bloqueio mantido por outra sessão (uma janela aberta do Eclipse, por exemplo) é reportado como externo: `dropSession` e `forceUnlock` não conseguem liberá-lo, só aquela sessão ou a `SM12`.

**Criar objetos e ordens de transporte.** `loadTypes` (escolha o `objtype`, por exemplo `CLAS/OC`), `validateNewObject`, depois `resolveTransport(objSourceUrl="/sap/bc/adt/packages/<pkg>", devClass="<pkg>")` para o próprio pacote, já que o objeto ainda não tem URL (ou `createTransport`), depois `createObject(objtype, name, parentName=<pkg>, description, parentPath="/sap/bc/adt/packages/<pkg>", responsible, transport)`, `setObjectSource` com `activate=true`, `createTestInclude`, `unitTestRun`. `creatableTypeDetails` diz quais campos cada tipo exige; pacotes (`DEVC/K`) precisam de `swcomp`, e backends cloud precisam de `responsible`.

**Testes unitários e ATC.** `unitTestRun` após toda mudança (paginado com `startIndex`/`maxItems`); `unitTestEvaluation` aprofunda nos resultados. ATC: `createAtcRun(mainUrl, variant)` em um objeto, pacote ou ordem de transporte (um nome de variante como `ABAP_CLOUD_DEVELOPMENT_DEFAULT` é resolvido para uma worklist por você), depois `atcWorklists` ou `atcSummary` (totais por prioridade, verificação e objeto), `atcQuickfixProposals` e `atcApplyQuickfix` para correções determinísticas, `atcDocumentation` para verificações desconhecidas; isenções passam por `atcExemptProposal` e `atcRequestExemption`.

**Revisar uma ordem de transporte.** `transportDetails` lista objetos, responsável, tarefas e status; `transportUnifiedDiff` compara todo objeto de código-fonte registrado na ordem com a versão anterior a ela, incluindo includes de classe e métodos `LIMU`, includes `REPS` e módulos `FUNC` (mensagens e DDIC são pulados com uma justificativa). A comparação é contra o fonte atual, então em uma ordem já liberada as mudanças posteriores nos mesmos objetos também aparecem. Roda em tenants S/4HANA Cloud (a cobertura de `LIMU` nasceu de uma sessão RAP lá, veja [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md)). `objectDiff` cobre objetos com várias revisões. `userTransports`, `transportRelease`, `transportSetOwner` e `transportAddUser` completam o quadro.

**Dados.** `runQuery(sqlQuery)` executa um `SELECT` ABAP SQL pela pré-visualização de dados do ADT sobre tabelas e CDS views (por nome de entidade, views de API liberadas incluídas), por exemplo `SELECT carrid, connid, fldate FROM sflight WHERE carrid = 'LH' ORDER BY fldate DESCENDING`. `rowNumber` limita quantas linhas o SAP devolve (padrão 100) e `startRow`/`maxRows` paginam o resultado. As instruções são quebradas no limite de 255 caracteres por linha da pré-visualização antes do envio (um único literal maior que isso ainda falha). Tabelas cujo `dataMaintenance` do DDIC é restrito são recusadas pela pré-visualização: `tableContents(ddicEntityName)` as lê (S_TABU_DIS/S_TABU_NAM continuam valendo). As chaves voltam em formato interno, então `getDataElementProperties` e `getDomainProperties` informam sobre zeros à esquerda e rotinas de conversão.

**Dumps e depurador.** `dumps(from, to, user, contains)` devolve resumos compactos (erro de tempo de execução, exceção, programa, ponto de término com URL do fonte e linha, topo da pilha) e `dumpDetails(dumpId)` a análise completa; `getObjectSource` em torno de `terminatedAt.line` e `whereUsed` encontram a causa. Os toolsets `debugger` e `traces` existem só onde o backend os expõe (`systemProfile` informa) e só quando o toolset é publicado (`focused` deixa ambos de fora). Sem depurador os caminhos são: um dump (`dumps`), reproduzir o erro com `runSnippet` ou `runClass` em um sistema de desenvolvimento e ler a saída, e `traces` onde o backend os serve. Quando o depurador está disponível, `debuggerListen` precisa de `debuggingMode`, `terminalId`, `ideId` e `user`, como no Eclipse.

**Prontidão para ABAP Cloud.** `apiReleaseState` aceita uma de quatro entradas: `names` (separados por vírgula, opcionalmente tipados como `TABL:MARA`), `objectUrl`, `source` (texto ABAP colado) ou `sourceUrl` (uma URL `.../source/main` que o servidor lê e varre). Ele confere os objetos SAP contra o repositório oficial de cloudificação da SAP (liberado, obsoleto com sucessores, classicAPI, noAPI; edições `cloud`, `btp`, `pce2023`, `pce2022`) mais a resposta de `/sap/bc/adt/apireleases` do backend, para que o modelo nunca recorde estados de liberação de memória.

**Executar código.** `runSnippet(code, packageName)` embrulha ABAP descartável em uma classe `IF_OO_ADT_CLASSRUN` temporária, cria, ativa e executa, devolve a saída do console e apaga a classe de novo, também quando a ativação ou a execução falha (uma exclusão que falha é reportada como `cleanupError`; `keep=true` a mantém). On-premise `packageName` assume `$TMP`; no S/4HANA Cloud passe um pacote de cliente, sua `transport` e `responsible`, e a criação e a exclusão ficam registradas nessa ordem. `runClass` executa uma classe existente. Ambos precisam de S_DEVELOP, portanto só em sistemas de desenvolvimento.

**abapGit, gerador RAP, refatoração, serviços.** abapGit: `gitRepos`, `gitCreateRepo`, `gitPullRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `switchRepoBranch`, com `gitUser`/`gitPassword` por destino mantendo as credenciais do remoto fora da conversa. Gerador RAP: `rapGenIsAvailable`, `rapGenGetContent`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate` (ordem de transporte obrigatória), depois `activateObjects` nos objetos gerados e `rapGenPublishService`. Refatoração: `renameEvaluate`, `renamePreview`, `renameExecute`; o mesmo trio para `extractMethod*`; `changePackagePreview` e `changePackageExecute`. Serviços de negócio: `fetchServiceDetails(name)`, `bindingDetails`, `publishServiceBinding`, `unPublishServiceBinding`.

## Prompts embutidos

Seis fluxos prontos viajam como prompts MCP. Cada um nomeia as ferramentas exatas a chamar, em ordem, e diz onde deve parar e perguntar:

| Prompt | Argumentos | O que faz | Onde para |
|---|---|---|---|
| `create-object` | `destination` opcional, depois `objectType` (id de tipo ADT como `CLAS/OC`, `INTF/OI`, `PROG/P`, `DDLS/DF`), `name`, `package`, `purpose` opcional | Valida, cria, grava, ativa, testa e verifica com ATC um objeto novo no pacote e na ordem certos. | Cria e ativa; nunca apaga nem libera. |
| `safe-edit` | `destination` opcional, depois `object` (nome ou URL), `change` | Lê, altera com substituições ancoradas em texto, ativa, testa e mostra o diff. | Nunca chega a `deleteObject`, `transportRelease` ou `forceUnlock` por conta própria; se surgir um bloqueio externo ou uma pergunta de liberação, para e pergunta. |
| `review-transport` | `destination` opcional, depois `transport` (número da ordem) | Faz o diff de todo objeto de uma ordem e produz uma revisão de aprovação ou reprovação. | Nunca chama `transportRelease`. |
| `fix-atc` | `destination` opcional, depois `target` (URL de objeto, nome de pacote ou ordem), `variant` opcional | Roda o ATC, aplica quickfixes determinísticos, corrige o resto com edições, repete até prioridades 1 e 2 ficarem limpas. | Aplica quickfixes e edições; isenções só com aprovação. |
| `clean-core-check` | `destination` opcional, depois `target` (nome ou URL de objeto, ou nome de pacote) | Avalia a prontidão para ABAP Cloud: APIs liberadas, objetos obsoletos, sucessores, verificações ATC cloud. | Não altera código. |
| `debug-dump` | `destination` opcional, depois `filter` opcional (usuário, programa, exceção ou janela de tempo) | Encontra a causa raiz de um dump e propõe a correção na linha exata. | Propõe substituições; não as aplica sem aprovação. |

Como invocá-los depende do host. O Claude Code expõe prompts MCP como comandos de barra chamados `/mcp__<servidor>__<prompt>`, com os argumentos dados posicionalmente na ordem em que o prompt os declara (`destination` vem primeiro em todo prompt, como na tabela):

```text
/mcp__abap-adt-mcp__safe-edit DEV ZCL_ORDER_SERVICE "return early when the input table is empty"
```

O Claude Desktop os oferece no menu de anexos (sinal de mais) da conversa, sob o nome do servidor, no momento em que isto foi escrito; hosts sem suporte a prompts simplesmente não os mostram, e os mesmos fluxos ainda chegam ao modelo pelo campo `instructions` do servidor.

## Outras formas de instalar

**Fixar a versão.** `npx -y abap-adt-mcp` busca a versão mais nova a cada início. Para uma implantação controlada, fixe-a (`npx -y abap-adt-mcp@2.0.0`, ou a tag de contêiner `vX.Y.Z`) e verifique a atestação de proveniência que o trusted publishing anexa com `npm audit signatures` em um diretório onde o pacote esteja instalado.

**Plugin do Claude Code.** O repositório é o seu próprio marketplace de plugins (`.claude-plugin/marketplace.json` ao lado de `plugin.json`), então dois comandos no Claude Code registram o servidor e carregam as duas skills, sem `claude mcp add`:

```text
/plugin marketplace add williansaez/abap-adt-mcp
/plugin install abap-adt-mcp@abap-adt-mcp
```

O manifesto inicia o servidor como `npx -y abap-adt-mcp` com `SAP_SYSTEMS_FILE=${HOME}/.abap-adt-mcp/systems.json` e sem `MCP_TOOLSETS`, portanto publica todas as 173 ferramentas; o `systems.json` do passo 1 continua sendo você quem escreve. As skills sozinhas são instaladas, no momento em que isto foi escrito, com `npx skills add williansaez/abap-adt-mcp` (um instalador de terceiros, não parte deste repositório) ou copiando os dois diretórios de `skills/` para `~/.claude/skills/`.

**Contêiner.** As imagens são construídas a partir de `node:22-alpine`, rodam como o usuário sem privilégios `node` (uid 1000) e são publicadas no GHCR a cada release (tags `latest` e `vX.Y.Z`). Monte o seu `systems.json` como somente leitura e repasse os segredos referenciados:

```bash
docker run -i --rm \
  -v "$PWD/systems.json:/config/systems.json:ro" \
  -e SAP_SYSTEMS_FILE=/config/systems.json \
  -e ONPREM_PASSWORD \
  ghcr.io/williansaez/abap-adt-mcp:latest
```

A verificação de modo do arquivo também roda dentro do contêiner: um arquivo montado com modo `0600` pertencente a outro uid não pode ser lido pelo usuário `node` (o início falha com `is not valid JSON: EACCES`, já que leitura e parse compartilham o mesmo caminho de erro), e um arquivo legível por outros só avisa, a não ser que contenha segredos em texto. Ou faça o arquivo pertencer ao uid 1000 e mantenha `0600`, ou referencie todo segredo como `${env:VAR}` e aceite o aviso. Segredos passados com `-e` ficam visíveis ao `docker inspect`; não há alternativa em arquivo para `MCP_HTTP_TOKEN`, então trate o ambiente do contêiner como confidencial. Para Streamable HTTP dentro do contêiner acrescente `-e MCP_HTTP_PORT=2236 -e MCP_HTTP_HOST=0.0.0.0 -e MCP_HTTP_TOKEN=<token> -p 127.0.0.1:2236:2236`. O SSO pelo navegador precisa de um navegador local, então execute destinos SSO a partir do npm na estação de trabalho; destinos `basic` e `oauth` funcionam dentro do contêiner.

**Registro MCP.** Listado como `io.github.williansaez/abap-adt-mcp` para hosts que navegam pelo registro; [server.json](server.json) é o manifesto do registro.

**A partir do código-fonte.**

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
```

Depois aponte o host para `node /caminho/absoluto/abap-adt-mcp/dist/index.js`. Um `systems.json` ao lado do checkout é encontrado automaticamente; `.env` (veja [.env.example](.env.example)) funciona para configurações de sistema único. Ambos são ignorados pelo git.

## Autenticação

Cada destino escolhe o seu `authType` (`sso`, a menos que `SAP_AUTH_TYPE` diga o contrário). Detalhes e passos do lado SAP estão em [docs/AUTH.md](docs/AUTH.md).

| Modo | Use para | O que você configura | Configuração do lado SAP |
|---|---|---|---|
| `sso` (padrão) | Usuários nomeados do S/4HANA Cloud, exatamente como o Eclipse ADT (SAML2/OIDC via IAS) | Um navegador Chromium (Chrome, Edge, Brave) abre uma vez por host; os cookies de sessão são lidos pelo protocolo DevTools e mantidos em memória, com `sap-client` fixado em toda requisição. A sessão do provedor de identidade vive em um perfil dedicado em `~/.abap-adt-mcp/sso/<host>` (modo `0700`). `SAP_BROWSER_PATH` substitui o navegador, `SAP_BROWSER_PROFILE_DIR` reutiliza um perfil personalizado com passkeys salvas (o perfil padrão do navegador é rejeitado de propósito). | Nada além da business role de desenvolvedor de que o seu usuário já precisa para o Eclipse ADT |
| `basic` | AS ABAP on-premise, Communication Users do S/4HANA Cloud | `user` e `password` (use `${env:VAR}`). Autentica na primeira chamada, `login` é opcional. | Um usuário com autorizações ADT |
| `oauth` | Clientes não assistidos do S/4HANA Cloud | `oauth.tokenUrl`, `oauth.clientId`, `oauth.clientSecret`, `oauth.scope` opcional (client credentials grant; o token é armazenado em cache até pouco antes de expirar e invalidado em um 401). | Um Communication User, um Communication System com OAuth 2.0 e um Communication Arrangement para o cenário que expõe o ADT no seu tenant (varia por tenant e não é listado aqui; o arrangement fornece o endpoint de token). As ferramentas então rodam com as autorizações do Communication User. |

Usuários de negócio nomeados no S/4HANA Cloud não podem usar autenticação básica; eles entram por `sso` ou você cria um Communication User. A sessão SSO é criada para o mandante de logon do tenant, que pode ser diferente do que você espera (`100` em vez de `080`, por exemplo): defina `client` como o que a sessão realmente usa. Um mandante errado aparece como erros de autorização ou de objeto não encontrado em objetos que você consegue abrir no Eclipse, após um login que em si teve sucesso. O diretório de perfil SSO é um diretório de dados de usuário Chromium comum: guarda os cookies e o armazenamento local que o provedor de identidade define quando você marca "permanecer conectado", nada que o servidor acrescente, e é protegido por permissões de arquivo e pelo que o Chromium fizer no seu SO, não criptografado pelo servidor; quanto tempo a sessão continua válida é política do provedor de identidade, e apagar o diretório é a única forma de encerrá-la antes (o cookie de sessão SAP coletado em si nunca é gravado em disco). O `tls` por destino acrescenta uma CA corporativa (`ca`), o nome contra o qual verificar o certificado quando `url` contém um endereço IP ou nome curto (`servername`, também enviado como SNI), ou um certificado de cliente X.509 (`cert` + `key`, ou `pfx` + `passphrase`), com a verificação mantida ligada; a janela do navegador SSO gerencia seu próprio armazenamento de confiança. `gitUser`/`gitPassword` opcionais fornecem credenciais do abapGit para que nunca passem pelo modelo. Sessões expiradas em qualquer modo são restabelecidas uma vez e a chamada repetida; se isso falhar, o erro diz `kind: "sessionExpired"`.

## Mantendo a segurança

Este servidor dá a um modelo de linguagem acesso de leitura e escrita ao SAP. Algumas regras tornam isso confortável:

- **As salvaguardas vivem no servidor, não no host.** O bloco `policy` de um destino é avaliado no servidor antes da própria chamada SAP da ferramenta, independentemente do que o host aprova; `allowedPackages` é a única barreira que pode precisar de uma consulta (`transportInfo`, em cache) para descobrir primeiro o pacote de um objeto existente. As recusas voltam como `kind: "policyDenied"` nomeando a barreira, e `listSystems` mostra cada política. Um destino sem bloco `policy` é totalmente gravável.

  | Chave | Tipo | Efeito |
  |---|---|---|
  | `readOnly` | booleano | Só ferramentas anotadas como somente leitura podem rodar, mais `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` e `exportPackageSources` (que grava apenas localmente). Bloqueadas como escritas: toda escrita de fonte, `lock`, `runSnippet`, `runClass`, `unitTestRun`, `createAtcRun` e `atcSummary`. Ainda permitidas: `runQuery` e `tableContents` (são leituras; negue-as com `allowFreeSql: false` ou `deniedTools`). |
  | `deniedTools` | globs | Ferramentas recusadas de imediato neste destino: um nome, um glob (`rapGen*`) ou `toolset:<nome>` para todas as ferramentas de um toolset, por exemplo `["transportRelease", "toolset:git"]`. Cinco ferramentas do abapGit não têm prefixo git (`pushRepo`, `stageRepo`, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch`), então `git*` sozinho deixa o caminho de push aberto. As ferramentas continuam listadas. |
  | `allowFreeSql` | booleano | `false` recusa `runQuery` e `tableContents` com `sqlQuery`. |
  | `deniedTables` | globs | Aplicado a `tableContents`, a todo alvo `FROM`/`JOIN` de um `runQuery`, e (melhor esforço, varrendo o texto ABAP) a `runSnippet`, `setObjectSource` e `setMethodSource`. SQL dinâmico e views sobre a tabela não são detectados: para dados que não podem sair do SAP, confie nas autorizações de exibição SAP do usuário conectado e combine `allowFreeSql: false` com `deniedTools: ["runSnippet"]` ou `readOnly`. |
  | `allowedPackages` | globs, lista fechada | Limita só escritas; leituras e navegação de qualquer objeto (objetos SAP incluídos) nunca são limitadas. Argumentos de pacote são verificados diretamente; escritas em objeto resolvem o pacote do objeto por `transportInfo`; um pacote não resolvível é recusado. `gitPullRepo`, `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding` e `unPublishServiceBinding` não conseguem derivar um pacote e são recusados sempre que esta chave está definida. |
  | `allowedTransports` | globs | Todo argumento `transport`/`transportNumber` deve casar; `createTransport` e `resolveTransport(createIfMissing=true)` são recusados. |

  Os interruptores globais são `MCP_READ_ONLY=1` (acrescenta `readOnly` a todo destino) e `MCP_DISABLED_TOOLSETS` (oculta toolsets inteiros de todo destino); não há `deniedTools`, `deniedTables` ou `allowedPackages` globais, esses se repetem por entrada. Oculto e recusado são diferentes: um toolset deixado de fora por `MCP_TOOLSETS`/`MCP_DISABLED_TOOLSETS` está ausente da lista de ferramentas e uma chamada por nome (de um prompt, de um host que guardou uma lista antiga, ou de uma skill) é recusada com o nome do toolset; `deniedTools` mantém a ferramenta listada e a recusa naquele destino; ferramentas que um destino não consegue servir (detectadas por `systemProfile`) continuam listadas e são recusadas antes de chamar o SAP (`MCP_PROFILE_GATE=enforce|warn|off`).
- **Segredos ficam fora de arquivos e conversas.** `${env:VAR}` funciona em toda string do `systems.json` (`password`, `oauth.clientSecret`, `gitPassword`, `tls.passphrase`, até `url`); uma variável ausente falha na inicialização pelo nome, nunca pelo valor. Mantenha o `systems.json` em modo `0600`: um arquivo legível pelo grupo ou por todos gera aviso e é recusado quando contém `password`, `oauth.clientSecret` ou `gitPassword` em texto. Prefira `SAP_SYSTEMS_FILE` a `SAP_SYSTEMS` inline nas configurações do host. `MCP_HTTP_TOKEN` é uma variável de ambiente, não uma entrada de arquivo; o lado cliente do transporte HTTP precisa carregar o token na configuração do host, então mantenha esse arquivo em `0600` também. `listSystems` e `healthcheck` não reportam credenciais, as mensagens de erro passam por uma etapa de redação que mascara bearer tokens, cookies, senhas e URLs `user:password@host`, e `exportPackageSources` só pode gravar dentro de `MCP_EXPORT_ROOT` (padrão `~/.abap-adt-mcp/exports`, verificado contra links simbólicos). `reentranceTicket` fica desabilitado a menos que `SAP_ALLOW_REENTRANCE_TICKET=1`, porque devolve uma credencial de logon viva para dentro da conversa.
- **O TLS fica ligado, e não pode ser desligado para tudo de uma vez.** `NODE_TLS_REJECT_UNAUTHORIZED=0` é removido do ambiente antes da primeira conexão, e o servidor avisa na inicialização: o problema de um destino nunca silencia a verificação dos outros, da requisição de token OAuth ou do download de cloudificação. Para um certificado corporativo ou autoassinado use `tls.ca` naquele destino, para um certificado emitido para um nome diferente do que está em `url` use `tls.servername` (a verificação fica ligada em ambos os casos, sem aviso), ou, como último recurso, `insecureTls: true` só naquele destino (anunciado na inicialização, mostrado por `listSystems`). Um handshake que falha volta como `kind: "tlsCertificate"` com a correção para aquele destino explicada.
- **Conteúdo vindo do SAP é entrada não confiável.** Comentários, linhas de tabela e feeds podem carregar texto que tenta conduzir o modelo. Use um host que pergunte antes das chamadas de ferramenta e revise as destrutivas (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `editObjectSource`, `setMethodSource`, `pushRepo`, `forceUnlock`) antes de aprová-las.
- **Privilégio mínimo, e o que "somente leitura" ainda lê.** Conecte com usuários que tenham só as autorizações de que a tarefa precisa. `runQuery` e `tableContents` leem dados de negócio reais, então configure só destinos onde isso é aceitável, e `exportPackageSources` copia pacotes inteiros de fonte para o disco local mesmo em um destino `readOnly`: acrescente-o a `deniedTools` onde o fonte não pode sair do SAP.
- **O que sai da máquina.** O servidor fala com os hosts SAP configurados, com o provedor de identidade durante o SSO pelo navegador, e com o GitHub para o repositório de cloudificação da SAP quando `apiReleaseState` roda (um arquivo JSON por edição de `raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc`, tempo limite de 15 segundos, armazenado em cache por 24 horas em `~/.abap-adt-mcp/cache`, realocável com `MCP_CACHE_DIR`; a cópia em cache é usada quando o download falha). Não há interruptor offline, URL de espelho ou suporte a proxy para esse download (ele usa o `fetch` embutido do Node, que ignora `HTTPS_PROXY`): em um host isolado da rede, popule o diretório de cache uma vez, ou deixe essa única ferramenta falhar. Nada mais é enviado a lugar nenhum: sem telemetria, sem verificação de atualizações. O próprio `npx` contata o registro npm.

## Log de auditoria

Defina `MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl` para anexar uma linha JSON por chamada de ferramenta. O diretório é criado com modo `0700` e o arquivo com `0600`; uma falha de escrita é reportada uma vez no stderr e nunca quebra uma chamada. Cada registro é anexado por caminho, então rotacionar o arquivo renomeando-o é seguro (a próxima chamada cria um novo); o servidor não tem retenção própria. [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) explica como transformar o arquivo em um relatório de sessão útil.

```json
{"ts":"2026-09-03T10:15:42.117Z","requestId":42,"tool":"editObjectSource","destination":"DEV","durationMs":1834,"outcome":"ok","args":{"objectSourceUrl":"/sap/bc/adt/oo/classes/zcl_example/source/main","replacements":"[array 312 chars]","activate":true,"transport":"DEVK900123"}}
{"ts":"2026-09-03T10:16:03.902Z","requestId":43,"tool":"runQuery","destination":"QAS","durationMs":2,"outcome":"denied","args":{"sqlQuery":"SELECT * FROM ztable"},"errorKind":"policyDenied","gate":"allowFreeSql","message":"MCP error -32600: Policy: runQuery blocked on destination QAS (allowFreeSql): free SQL (runQuery) is disabled; use tableContents on an allowed table. Configured in systems.json policy; retrying will not help."}
```

Campos: `ts`, `requestId`, `tool`, `destination`, `durationMs`, `outcome` (`ok`, `error`, `denied` para recusas de política, `unavailable` para barreiras de toolset ou plataforma), `errorKind`, `gate` (a chave de política), `message` (o texto do erro, primeiros 300 caracteres), `args` e `retried` (definido quando a chamada foi reautenticada e repetida). O que `args` guarda: chaves de argumento contendo `pass` (portanto `password` e `passphrase`), `secret`, `token`, `authorization`, `cookie` ou `lockHandle` viram `[REDACTED]`; valores de string de até 200 caracteres são guardados na íntegra após a mesma redação das mensagens de erro (então uma instrução SQL ou um trecho curto com literais de negócio está no arquivo), strings maiores são truncadas, e arrays ou objetos acima de 200 caracteres se reduzem a `[array N chars]` ou `[object N chars]`. Trate o arquivo como sensível. Não há identidade do chamador em um registro (sem endereço remoto, id de sessão MCP ou id de token): em stdio o processo pertence a uma pessoa, e em uma instância HTTP compartilhada a atribuição tem de vir de uma instância por pessoa ou do log de acesso do proxy reverso à frente.

## S/4HANA Cloud versus on-premise

`systemProfile(destination)` reporta se um destino é cloud ou on-premise (domínio do host, informações do sistema e documento de descoberta) e quais toolsets faltam no backend; essas ferramentas são recusadas antes de chamar o SAP. Se você só tem um tenant S/4HANA Cloud, a coluna do meio é a sua. O que [docs/TESTPLAN.md](docs/TESTPLAN.md) e [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) registraram em um tenant Public Cloud:

| Tema | S/4HANA Cloud (edição pública) | On-premise / privado |
|---|---|---|
| Autenticação | Usuários nomeados: só SSO pelo navegador. Não assistido: OAuth2 a partir de um Communication Arrangement, ou autenticação básica com um Communication User. | Autenticação básica; certificados de cliente via `tls`. |
| Objetos locais | `$TMP` foi recusado no tenant testado (objeto de autorização S_ABPLNGVS: objetos em `$TMP` recebem a versão de linguagem Standard); use um pacote de cliente com ABAP for Cloud Development e sua ordem de transporte, `resolveTransport` a escolhe. `runSnippet` precisa de `packageName`, `transport` e `responsible` lá. | `$TMP` disponível, sem ordem de transporte; `runSnippet` assume `$TMP`. |
| Toolsets | Gerador RAP ausente no tenant testado; depurador, traces e abapGit dependem do tenant e das autorizações. `dumps`/`dumpDetails` são o caminho de causa raiz quando o depurador falta. `sourceTextSearch` recorre a `grepPackage` quando o tenant responde "Source Search is not supported". | Conjunto completo de coleções ADT em uma versão atual. |
| APIs liberadas | `apiReleaseState` verifica nomes, uma URL de objeto ou um fonte inteiro; variante ATC `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. `createObject` precisa de `responsible`. | Opcional. |
| Dados de negócio | `runQuery`/`tableContents` respeitam autorizações de exibição; negue tabelas por política. `runSnippet` precisa de S_DEVELOP, portanto só sistemas de desenvolvimento. | Igual. |

Lições que valem em todo lugar: instruções de `runQuery` são quebradas no limite de 255 caracteres por linha da pré-visualização de dados; tabelas com `dataMaintenance` restrito são lidas com `tableContents`; um bloqueio mantido por uma sessão aberta do Eclipse é externo e só a `SM12` ou aquela sessão o libera; gravar uma classe de mensagens por `setObjectSource` reescreve a classe inteira e redefine `masterLanguage` para o idioma de logon.

## Referência de configuração

Toda opção com seu padrão, as barreiras de política ferramenta por ferramenta, trechos por host e notas operacionais estão em [docs/CONFIGURATION.md](docs/CONFIGURATION.md); esta seção é o resumo.

Fontes de configuração, em ordem de precedência: `SAP_SYSTEMS` (JSON inline), `SAP_SYSTEMS_FILE`, um `systems.json` ao lado da instalação, depois as variáveis legadas de sistema único (`SAP_URL`, `SAP_CLIENT`, `SAP_USER`, `SAP_PASSWORD`, `SAP_LANGUAGE`, `SAP_TLS_INSECURE`, `SAP_OAUTH_TOKEN_URL`, `SAP_OAUTH_CLIENT_ID`, `SAP_OAUTH_CLIENT_SECRET`, `SAP_OAUTH_SCOPE`, veja [.env.example](.env.example)).

Chaves por destino no `systems.json`: `url`, `client`, `language`, `authType`, `default`, `user`/`password` (basic), `oauth` (`tokenUrl`, `clientId`, `clientSecret`, `scope`), `insecureTls`, `gitUser`/`gitPassword`, `policy` e `tls` (`ca`, `servername`, `cert` + `key`, `pfx` + `passphrase`). Qualquer valor de string pode ser `${env:VAR}`. Chaves que começam com `_` são ignoradas, então entradas `_comment` são aceitas. Toda saída operacional (avisos de inicialização, mensagens de barreira, o aviso do arquivo de auditoria) vai para stderr, que os hosts MCP capturam em seus logs.

Toda variável declarada em [server.json](server.json):

| Variável | Finalidade | Padrão / notas |
|---|---|---|
| `SAP_SYSTEMS_FILE` | Caminho do arquivo de destinos | Recomendado; mantenha modo `0600` |
| `SAP_SYSTEMS` | O mesmo mapa inline | Contém credenciais, prefira o arquivo |
| `SAP_DEFAULT_DESTINATION` | Destino usado quando uma chamada omite `destination` | Ou marque uma entrada com `"default": true` |
| `SAP_AUTH_TYPE` | Tipo de autenticação padrão para entradas sem um, e o modo da configuração legada de sistema único | `sso`; `basic` ou `oauth` |
| `MCP_TOOLSETS` | Toolsets a publicar: preset `all` ou `focused`, ou uma lista separada por vírgulas | `all` |
| `MCP_DISABLED_TOOLSETS` | Toolsets a ocultar, lista separada por vírgulas | `core` não pode ser desabilitado |
| `MCP_READ_ONLY` | `1` torna todo destino somente leitura, do lado do servidor | Desligado |
| `MCP_MAX_RESPONSE_CHARS` | Orçamento de caracteres de uma resposta de ferramenta antes de paginar ou truncar | 40000, mínimo 5000 |
| `MCP_PROFILE_GATE` | Barreira para toolsets que o destino não expõe | `enforce`; `warn` só registra, `off` desabilita |
| `MCP_SOURCE_CACHE_TTL_SECONDS` | Tempo de vida do cache de fontes por sessão usado por `syntaxCheckCode`, `grepPackage`, `cdsViewInfo`, `typeHierarchy`, `abapDocumentation` e `apiReleaseState(sourceUrl)` | 300; `0` mantém as entradas até o logout |
| `MCP_EXPORT_ROOT` | Diretório em que `exportPackageSources` pode gravar | `~/.abap-adt-mcp/exports` |
| `MCP_AUDIT_FILE` | Caminho da trilha de auditoria JSONL | Desligado quando não definido |
| `SAP_ALLOW_REENTRANCE_TICKET` | `1` habilita a ferramenta `reentranceTicket` | Desabilitado |
| `SAP_BROWSER_PATH` | SSO: caminho de um binário Chromium, Chrome ou Edge | Detectado automaticamente |
| `SAP_BROWSER_PROFILE_DIR` | SSO: perfil de navegador persistente que guarda a sessão do provedor de identidade | `~/.abap-adt-mcp/sso/<host>` |
| `MCP_HTTP_PORT` | Serve Streamable HTTP em `http://127.0.0.1:<porta>/mcp` com autenticação bearer em vez de stdio | Não definido (stdio); aceita 1024 a 65535 |
| `MCP_HTTP_HOST` | Endereço de escuta do transporte HTTP | `127.0.0.1`; `0.0.0.0` só em contêineres |
| `MCP_HTTP_TOKEN` | Token bearer do transporte HTTP | Gerado em `~/.abap-adt-mcp/http-token` |
| `MCP_HTTP_MAX_SESSIONS` | Máximo de sessões MCP simultâneas; requisições `initialize` além disso recebem `503` | 16 |
| `MCP_HTTP_MAX_BODY_BYTES` | Maior corpo de requisição que o transporte HTTP aceita; corpos maiores recebem `413` | 4194304 (4 MB) |
| `MCP_HTTP_SESSION_TTL_MINUTES` | Minutos ociosos após os quais uma sessão HTTP (e suas sessões e bloqueios SAP) é encerrada | 30 |
| `MCP_HTTP_ALLOWED_ORIGINS` | Valores de `Origin` permitidos, separados por vírgula; `*` permite qualquer um | Origens de loopback sempre permitidas em uma escuta de loopback |
| `MCP_HTTP_ALLOWED_HOSTS` | Valores do cabeçalho `Host` permitidos, separados por vírgula (proteção contra DNS rebinding) | Hosts de loopback sempre permitidos em uma escuta de loopback; qualquer host em uma escuta fora do loopback |
| `SAP_URL` | Modo legado de sistema único: URL base, por exemplo `https://host:44300` | |
| `SAP_CLIENT` | Modo legado de sistema único: mandante, por exemplo `100` | |
| `SAP_LANGUAGE` | Modo legado de sistema único: idioma de logon, por exemplo `EN` | |
| `SAP_USER` | Modo legado de sistema único: usuário SAP | |
| `SAP_PASSWORD` | Modo legado de sistema único: senha SAP | Segredo |
| `SAP_TLS_INSECURE` | Modo legado de sistema único: `1` pula a verificação de certificado só para esse sistema | Só sandboxes |
| `SAP_OAUTH_TOKEN_URL` | Modo legado de sistema único com `SAP_AUTH_TYPE=oauth`: endpoint de token | |
| `SAP_OAUTH_CLIENT_ID` | Modo legado de sistema único: id de cliente OAuth2 | |
| `SAP_OAUTH_CLIENT_SECRET` | Modo legado de sistema único: client secret OAuth2 | Segredo |
| `SAP_OAUTH_SCOPE` | Modo legado de sistema único: escopo OAuth2 opcional | |

Lidas em tempo de execução mas fora do manifesto do registro: `MCP_CACHE_DIR` realoca o cache do repositório de cloudificação (padrão `~/.abap-adt-mcp/cache`), e `NODE_TLS_REJECT_UNAUTHORIZED=0` é removida na inicialização para que não possa desabilitar a verificação de certificado do processo inteiro.

## Transporte HTTP (opcional)

Por padrão o servidor fala stdio: um processo por usuário, nada escutando na rede. Para hosts que esperam um endpoint HTTP (Eclipse, outra máquina, um contêiner, uma instância compartilhada de equipe), inicie-o com uma porta:

```bash
MCP_HTTP_PORT=2236 npx -y abap-adt-mcp
```

Ele escuta em `http://127.0.0.1:2236/mcp` (só loopback, a menos que `MCP_HTTP_HOST` diga o contrário) e exige `Authorization: Bearer <token>` em toda requisição. O token é gerado na inicialização e gravado em `~/.abap-adt-mcp/http-token` (modo `0600`); `MCP_HTTP_TOKEN` define o seu. Configuração do host:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:2236/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

O que a porta de entrada impõe:

- Portas abaixo de 1024 são recusadas; o token bearer é comparado em tempo constante; `GET /health` é a única rota sem autenticação e responde com versão, contagem de sessões, o limite de sessões e tempo de atividade (bloqueie-a no proxy se essa divulgação importar). Tudo o mais fora de `/mcp` é `404`.
- Proteção contra DNS rebinding: em uma escuta de loopback só valores de `Host` e `Origin` de loopback passam, ampliáveis com `MCP_HTTP_ALLOWED_HOSTS` e `MCP_HTTP_ALLOWED_ORIGINS` (`*` permite qualquer um). Em uma escuta fora do loopback todo cabeçalho `Host` passa (a verificação de Host só protege escutas de loopback), enquanto um cabeçalho `Origin` ainda precisa estar listado em `MCP_HTTP_ALLOWED_ORIGINS` (chamadores de navegador); requisições sem cabeçalho `Origin` (clientes fora do navegador) passam em qualquer escuta.
- Uma instância de servidor por sessão MCP: sessões SAP, registro de bloqueios e caches separados por chamador. Sessões ociosas expiram após `MCP_HTTP_SESSION_TTL_MINUTES` (padrão 30); além de `MCP_HTTP_MAX_SESSIONS` (padrão 16) novas requisições `initialize` recebem `503` com `Retry-After`; uma sessão encerrada ou expirada libera seus bloqueios e sessões SAP. Em SIGINT/SIGTERM o processo fecha a instância de escuta e sai sem percorrer as sessões abertas, então envie `DELETE /mcp` dos clientes antes de parar uma instância compartilhada. Todo corpo de requisição é limitado a `MCP_HTTP_MAX_BODY_BYTES` (padrão 4 MB); corpos maiores são recusados com `413` e a conexão é fechada.
- Avisos na inicialização quando a escuta vai além do loopback, e de novo quando um destino SSO é exposto dessa forma: todo chamador remoto compartilharia o login de navegador do usuário que executa o servidor.

O que ele não oferece: TLS (coloque um proxy reverso à frente), limitação de taxa, tokens por usuário ou rotação de token sem reinício (um reinício sem `MCP_HTTP_TOKEN` já gera um token novo e sobrescreve `http-token`; quando você mesmo define a variável, troque-a e reinicie; sessões abertas terminam com o processo). Uma instância compartilhada significa, portanto, um token e, para cada destino, um conjunto de credenciais SAP para todos os chamadores. Prefira uma instância por pessoa, ou destinos `basic`/`oauth` com política `readOnly`, mantenha o token em segredo e coloque TLS à frente.

## Catálogo de ferramentas (todas as 173 ferramentas, por toolset)

A referência por ferramenta (descrição, parâmetros, anotações de somente leitura/destrutiva) é [docs/TOOLS.md](docs/TOOLS.md), gerada a partir da resposta viva de `tools/list` por `npm run tools:docs` e verificada por um teste de contrato no CI. Toda ferramenta exceto `listSystems` e `healthcheck` aceita um `destination` opcional; sem ele o destino padrão é usado.

Esquemas de ferramentas custam contexto. Defina `MCP_TOOLSETS` como um preset (`all`, o padrão, ou `focused` = 114 ferramentas de desenvolvimento) ou como uma lista separada por vírgulas dos nomes abaixo; `MCP_DISABLED_TOOLSETS` remove alguns. `core` é sempre publicado. Nomes desconhecidos falham na inicialização.

| Toolset | Em `focused` | Ferramentas |
|---|---|---|
| `core` · Destinations, health & session (6) | sim | `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` |
| `source` · Source code (16) | sim | `lock`, `unLock`, `listLocks`, `forceUnlock`, `getObjectSource`, `setObjectSource`, `editObjectSource`, `getMethodSource`, `setMethodSource`, `prettyPrinterSetting`, `setPrettyPrinterSetting`, `prettyPrinter`, `revisions`, `objectDiff`, `getTextElements`, `setTextElements` |
| `objects` · Objects & navigation (27) | sim | `objectStructure`, `searchObject`, `findObjectPath`, `objectTypes`, `reentranceTicket`, `classIncludes`, `classComponents`, `deleteObject`, `activateObjects`, `activateByName`, `activatePackage`, `inactiveObjects`, `objectRegistrationInfo`, `creatableTypeDetails`, `validateNewObject`, `createObject`, `nodeContents`, `mainPrograms`, `typeHierarchy`, `objectStructureElements`, `objectEnhancements`, `packageTree`, `exportPackageSources`, `whereUsed`, `cdsViewInfo`, `sourceTextSearch`, `grepPackage` |
| `transports` · Transports (18) | sim | `transportDetails`, `transportUnifiedDiff`, `transportInfo`, `resolveTransport`, `createTransport`, `hasTransportConfig`, `transportConfigurations`, `getTransportConfiguration`, `setTransportsConfig`, `createTransportsConfig`, `userTransports`, `transportsByConfig`, `transportDelete`, `transportRelease`, `transportSetOwner`, `transportAddUser`, `systemUsers`, `transportReference` |
| `analysis` · Syntax & code analysis (16) | sim | `syntaxCheckCode`, `syntaxCheckCdsUrl`, `codeCompletion`, `findDefinition`, `usageReferences`, `syntaxCheckTypes`, `codeCompletionFull`, `runClass`, `codeCompletionElement`, `usageReferenceSnippets`, `fixProposals`, `fixEdits`, `fragmentMappings`, `abapDocumentation`, `apiReleaseState`, `runSnippet` |
| `tests` · Unit tests (4) | sim | `unitTestRun`, `unitTestEvaluation`, `unitTestOccurrenceMarkers`, `createTestInclude` |
| `atc` · ATC (14) | sim | `atcCustomizing`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcCheckVariant`, `atcSummary`, `createAtcRun`, `atcWorklists`, `atcUsers`, `atcExemptProposal`, `atcRequestExemption`, `isProposalMessage`, `atcContactUri`, `atcChangeContact`, `atcDocumentation` |
| `data` · Data access & DDIC (10) | sim | `annotationDefinitions`, `ddicElement`, `ddicRepositoryAccess`, `packageSearchHelp`, `getDomainProperties`, `setDomainProperties`, `getDataElementProperties`, `setDataElementProperties`, `tableContents`, `runQuery` |
| `discovery` · Discovery & metadata (7) | não | `featureDetails`, `collectionFeatureDetails`, `findCollectionByUrl`, `loadTypes`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibilityGraph` |
| `runtime` · Runtime errors (3) | sim | `feeds`, `dumps`, `dumpDetails` |
| `refactoring` · Refactoring (8) | não | `renameEvaluate`, `renamePreview`, `renameExecute`, `extractMethodEvaluate`, `extractMethodPreview`, `extractMethodExecute`, `changePackagePreview`, `changePackageExecute` |
| `rap` · RAP generation (8) | não | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenGetContent`, `rapGenValidateInitial`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `services` · Business services (4) | não | `publishServiceBinding`, `unPublishServiceBinding`, `fetchServiceDetails`, `bindingDetails` |
| `git` · abapGit (10) | não | `gitRepos`, `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, `gitUnlinkRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch` |
| `debugger` · Debugger (13) | não | `debuggerListeners`, `debuggerListen`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerSaveSettings`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, `debuggerSetVariableValue` |
| `traces` · Traces (9) | não | `tracesList`, `tracesListRequests`, `tracesHitList`, `tracesDbAccess`, `tracesStatements`, `tracesSetParameters`, `tracesCreateConfiguration`, `tracesDeleteConfiguration`, `tracesDelete` |

Ferramentas destrutivas (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `editObjectSource`, `setMethodSource`, `atcApplyQuickfix`, `runClass`, `runSnippet`, `pushRepo`, `forceUnlock` e outras) carregam `destructiveHint: true` para hosts que condicionam a aprovação pela anotação. Uma ferramenta pode faltar por dois motivos: seu toolset não está publicado (o preset `focused` deixa de fora `debugger`, `traces`, `git`, `rap`, `services`, `refactoring` e `discovery`; a recusa nomeia o toolset), ou o destino não consegue servi-la (`systemProfile` reporta o que falta; a recusa diz "not available on destination").

## Comparação com o ADT MCP Server oficial da SAP

O ADT MCP Server da SAP vem com o ADT para VS Code e Eclipse e publica sob a chave de servidor `abap-adt` com seus próprios nomes de ferramentas, pelos quais skills públicas como `claude-abap-skills` fazem o roteamento. Este projeto publica sob `abap-adt-mcp`, serve vários destinos a partir de um processo por stdio ou HTTP, aplica políticas do lado do servidor e acrescenta composições como `resolveTransport`, `editObjectSource`, `grepPackage`, `apiReleaseState`, `runSnippet` e `objectDiff`. Os dois podem ser registrados lado a lado no mesmo host, já que chaves e nomes de ferramentas não colidem. Este README não cataloga o que o servidor da SAP oferece além deste; [docs/ROUTING.md](docs/ROUTING.md) mapeia os nomes da SAP para os nossos onde existe equivalente. Algumas linhas:

| Ferramenta / capacidade oficial da SAP | Ferramenta(s) do abap-adt-mcp |
|---|---|
| `abap_lists_destinations` | `listSystems`, `systemProfile` |
| `SAPRead` / `abap_get_source` | `getObjectSource` (`version=inactive` para código não ativado) |
| `SAPSearch` / `abap_search_objects` | `searchObject`; por conteúdo `sourceTextSearch`, `grepPackage` |
| `abap_write_source` / `SAPWrite` | `setObjectSource` (`activate=true`), `editObjectSource` pontual |
| `abap_activate_objects` / `ActivatePackage` | `activateByName`, `activateObjects`, `inactiveObjects` |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_atc_run` / `abap_atc_findings` | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcDocumentation` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff`, `transportDetails` |
| `abap_generators-*` | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `abap_lock` / `abap_unlock` | Desnecessário para escritas isoladas (bloqueio automático); `lock`, `unLock`, `listLocks`, `forceUnlock` |
| `abap_dumps` | `dumps`, `dumpDetails` |
| verificação de API liberada / Clean Core | `apiReleaseState` |

## Skills e plugin

Duas skills de agente vêm em `skills/`: `abap-adt-mcp` ensina o modelo a desenvolver ABAP com estas ferramentas (início de sessão, busca de código, o fluxo de mudança, prontidão para cloud, erros, segurança) e `abap-adt-mcp-setup` guia pela instalação, configuração e um primeiro health check. Elas chegam ao host pelo plugin do Claude Code (`/plugin marketplace add williansaez/abap-adt-mcp` e depois `/plugin install abap-adt-mcp@abap-adt-mcp`, que também registra o servidor), pelo instalador de terceiros `npx skills add williansaez/abap-adt-mcp`, ou copiando os dois diretórios para `~/.claude/skills/`; um registro `npx` simples do servidor não instala skill nenhuma, e os fluxos essenciais ainda chegam pelo campo `instructions` do servidor e pelos [prompts embutidos](#prompts-embutidos).

Este README também existe em [inglês](README.md) e [alemão](README.de.md); a versão em inglês é a referência e as contagens geradas são sincronizadas nas três. O que sessões reais ensinaram ao servidor está em [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md), o plano de testes ao vivo em [docs/TESTPLAN.md](docs/TESTPLAN.md), o roteiro em [docs/ROADMAP.md](docs/ROADMAP.md) e os releases em [CHANGELOG.md](CHANGELOG.md).

## Solução de problemas

- **O servidor nunca aparece no host.** Leia o log MCP do host (locais no [passo 2](#2-registre-o-servidor-no-seu-host)). `spawn npx ENOENT`: o Node.js não está instalado ou não está no PATH que o aplicativo enxerga; instale-o ou coloque o caminho absoluto do `npx` em `command` (`/usr/local/bin/npx` para o instalador do macOS, `/opt/homebrew/bin/npx` para o Homebrew). `EBADENGINE` no log: o Node que o host encontrou é mais antigo que 22.12; instale o LTS atual. `No ABAP systems configured`: `SAP_SYSTEMS_FILE` aponta para um arquivo inexistente. `is not valid JSON`: uma vírgula perdida ou um caminho Windows com barras invertidas simples. O Claude Desktop lê a configuração só no início, então feche e reabra após cada mudança.
- **Nenhuma janela de navegador, ou o SSO falha.** Um navegador Chromium precisa estar instalado; `SAP_BROWSER_PATH` aponta para ele quando a detecção automática falha. O perfil padrão do navegador é rejeitado de propósito; `SAP_BROWSER_PROFILE_DIR` nomeia um dedicado. Apague `~/.abap-adt-mcp/sso/<host>` para sair completamente de um tenant.
- **O login funciona, depois tudo é "not authorized" ou "not found".** A sessão SSO aterrissou em outro mandante que não o de `client`: defina `client` como o mandante de logon do tenant (a entrada Sobre do menu de usuário do launchpad o mostra).
- **`kind: "sessionExpired"` continua voltando.** O servidor já reautenticou e repetiu uma vez; peça ao modelo para chamar `login` naquele destino. Handles de bloqueio da sessão antiga são inválidos (`kind: "staleLockHandle"`): bloqueie de novo.
- **`kind: "locked"` por outra sessão.** `listLocks` mostra os bloqueios do próprio servidor; se o objeto não está lá, o bloqueio pertence a outra sessão (Eclipse ou outro usuário) e só aquela sessão ou a `SM12` o libera.
- **`editObjectSource` reporta 0 ocorrências, ou várias.** Nada foi gravado. A âncora precisa ser o texto atual exato no SAP, indentação incluída: releia com `getObjectSource` e copie; para várias ocorrências inclua mais linhas ao redor.
- **Ferramenta recusada como não disponível ou não habilitada.** "Not available on destination": rode `systemProfile`, o tenant não tem aquela coleção ADT (`MCP_PROFILE_GATE=warn` só registra, `off` desabilita a barreira). "Belongs to toolset ... which is not enabled": o toolset falta em `MCP_TOOLSETS` (o preset `focused` não tem `debugger` nem `traces`); acrescente-o ou use `MCP_TOOLSETS=all`. Sem depurador, `dumps` e `dumpDetails` são o caminho de causa raiz.
- **`kind: "policyDenied"`.** A `policy` do destino (ou `MCP_READ_ONLY`) proíbe a chamada e a mensagem nomeia a barreira: a salvaguarda está funcionando. Ajuste a política se a chamada era intencional.
- **A inicialização recusa o arquivo de configuração.** Ele é legível por outros usuários e contém senhas em texto: faça `chmod 600` nele ou referencie os segredos como `${env:VAR}`.
- **Erros de certificado on-premise (`kind: "tlsCertificate"`).** A dica nomeia o destino e a correção. Emissor desconhecido: dê ao destino o seu pacote de CA com `tls.ca` (a dica traz a linha `openssl s_client`). Nome divergente (o sistema é acessado por endereço IP ou nome curto): defina `tls.servername` como o nome `DNS:` que a mensagem cita. Expirado: só a renovação na `STRUST` resolve. `insecureTls: true` (ou `SAP_TLS_INSECURE=1` no modo legado) desabilita a verificação só para aquele destino. `NODE_TLS_REJECT_UNAUTHORIZED=0` não ajuda: o servidor a remove.
- **Erros de conexão.** Confira URL e mandante, autorizações ADT, e on-premise que `/sap/bc/adt` está ativo na `SICF`.
- **`runQuery` falha em uma tabela que o usuário consegue exibir.** A pré-visualização de dados recusa tabelas com `dataMaintenance` restrito; use `tableContents`. Uma instrução que ainda falha após a quebra em 255 caracteres tem um único literal maior que isso, ou um erro de sintaxe real no token nomeado.
- **Os esquemas de ferramentas consomem a janela de contexto.** Comece com `MCP_TOOLSETS=focused`, ou oculte toolsets (`MCP_DISABLED_TOOLSETS=debugger,traces`).

## Testes e contribuição

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
npm test
```

As suítes Jest cobrem handlers, dicas de erro, dimensionamento de respostas, toolsets e o contrato do catálogo contra `docs/tools.snapshot.json`; o CI as executa em Node 22 e 24, constrói a imagem de contêiner e confere que ela inicia e lista as ferramentas. Após mudar a descrição ou o esquema de uma ferramenta, rode `npm run tools:docs` e faça commit do `docs/TOOLS.md` regenerado, do snapshot e das contagens do README (os READMEs traduzidos incluídos), ou o CI os marca como desatualizados; `npm run docs:check` roda a barreira de higiene da documentação (sem identificadores de clientes, sem travessões, sem links quebrados, toda variável de ambiente declarada em `server.json`). Os releases são guiados por tag: npm via trusted publishing (GitHub OIDC, proveniência anexada) mais a imagem GHCR. Faça fork, crie um branch, abra um pull request. Relatórios de sessão para [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) são bem-vindos, sem nomes de clientes, tenants ou números de ordem de transporte.

## Licença

[MIT](LICENSE). Construído sobre [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) de Marcello Urbani. Se o projeto economiza o seu tempo, você pode [patrocinar o autor](https://github.com/sponsors/williansaez).
