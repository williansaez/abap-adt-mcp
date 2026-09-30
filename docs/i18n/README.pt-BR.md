# abap-adt-mcp

**Deixe o Claude ler, escrever, testar e verificar código ABAP nos seus sistemas SAP.**

[English](../../README.md) · Português (Brasil) · [Deutsch](README.de.md) · [Site do projeto](https://williansaez.github.io/abap-adt-mcp/pt-BR/)

[![npm version](https://img.shields.io/npm/v/abap-adt-mcp)](https://www.npmjs.com/package/abap-adt-mcp)
[![CI](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Node.js](https://img.shields.io/node/v/abap-adt-mcp)](https://nodejs.org)
[![MCP Registry](https://img.shields.io/badge/MCP%20registry-listed-informational)](https://registry.modelcontextprotocol.io/?search=abap-adt-mcp)
[![Site do projeto](https://img.shields.io/badge/site%20do%20projeto-williansaez.github.io-4db1ff)](https://williansaez.github.io/abap-adt-mcp/pt-BR/)

Você escreve uma frase no Claude. Recebe de volta uma classe ativada, testes unitários verdes e um número de ordem de transporte. O abap-adt-mcp é o servidor no meio: um servidor [Model Context Protocol](https://modelcontextprotocol.io) que dá ao Claude Desktop, ao Claude Code, ao VS Code ou a qualquer outro host MCP os mesmos serviços ADT que o Eclipse usa, em todos os sistemas SAP que você configurar, S/4HANA Cloud e on-premise igualmente. **173 ferramentas**, um processo, e salvaguardas que o próprio servidor aplica: um destino marcado como somente leitura recusa toda escrita antes de chegar ao SAP, independentemente do que o host aprova.

**Veja em movimento.** O [site do projeto](https://williansaez.github.io/abap-adt-mcp/pt-BR/) tem sete filmes curtos, a instalação em três passos e o que pedir ao modelo.

> **Antes de conectar um sistema produtivo**
>
> - O modelo age como o seu usuário SAP e não consegue nada que o Eclipse lhe recusaria. O que ele lê (fonte, dumps, linhas de tabelas onde você as abre) é enviado ao modelo.
> - Um destino sem bloco [`policy`](#chaves-de-política) é gravável em todo pacote que o seu usuário pode editar; os dados de tabelas ficam fechados até você abri-los.
> - Recomendado: só sistemas de desenvolvimento e teste. Se um destino produtivo precisa existir, dê a ele a política `PRD` do [passo 4](#4-acrescente-sistemas-produtivos-e-on-premise): o servidor a aplica antes de qualquer chamada ao SAP, seja o que for que o host aprove, de modo que um prompt descuidado não grava onde a política proíbe ([Para administradores](#para-administradores)).

## Veja funcionar

![Uma frase no chat vira searchObject, getObjectSource, editObjectSource e unitTestRun, depois um cartão de resultado: 3 testes aprovados, ordem de transporte DEVK900123](../../docs/media/brag/film-flow.gif)

A ideia é essa. Você escreve uma frase. O modelo escolhe as ferramentas, o servidor bloqueia o objeto, grava, ativa e desbloqueia, e os testes unitários voltam verdes com o número da ordem de transporte. Peça a mesma mudança num sistema produtivo e a resposta é `policyDenied` antes de qualquer chamada ao SAP: as salvaguardas vivem no servidor, não na janela do chat.

Sete filmes curtos mostram isso e os trabalhos por trás, um dump rastreado até a linha, uma execução do ATC com seus quickfixes, uma revisão de transporte, uma classe criada com o seu teste, uma verificação de prontidão para ABAP Cloud. Estão no [site do projeto](https://williansaez.github.io/abap-adt-mcp/pt-BR/#watch).

## Sumário

- [Veja funcionar](#veja-funcionar)
- [Instalação](#instalação)
- [O que pedir ao modelo](#o-que-pedir-ao-modelo)
- [Para administradores](#para-administradores)
- [Autenticação](#autenticação)
- [S/4HANA Cloud versus on-premise](#s4hana-cloud-versus-on-premise)
- [Outras formas de instalar](#outras-formas-de-instalar)
- [Configuração](#configuração)
- [Catálogo de ferramentas](#catálogo-de-ferramentas)
- [Comparação com o ADT MCP Server oficial da SAP](#comparação-com-o-adt-mcp-server-oficial-da-sap)
- [Política de API da SAP](#política-de-api-da-sap)
- [Solução de problemas](#solução-de-problemas)
- [Testes e contribuição](#testes-e-contribuição)
- [Créditos](#créditos)
- [Licença](#licença)

## Instalação

Três pré-requisitos:

- **Node.js 22.12 ou mais recente** (22 ou 24 LTS), de [nodejs.org](https://nodejs.org). Em um notebook gerenciado pela empresa, o chamado ao TI é uma linha: "Por favor instalem o Node.js LTS (22 ou mais recente)"; nada mais precisa ser instalado.
- **Acesso ao sistema SAP**, o mesmo do Eclipse ADT: no S/4HANA Cloud o papel de negócio de desenvolvedor (`SAP_BR_DEVELOPER` na entrega padrão); on-premise, peça ao time Basis o serviço `/sap/bc/adt` na `SICF` e as autorizações ADT habituais.
- **Um navegador Chromium** (Chrome, Edge ou Brave) para o login pelo navegador (`authType: sso`, o padrão); desnecessário para `basic`, `oauth` ou `sso2`.

### 1. Descreva os seus sistemas SAP

Crie a pasta `.abap-adt-mcp` na sua pasta pessoal e o arquivo `systems.json` dentro dela, uma entrada por sistema (um "destino"):

- Windows: a pasta é `C:\Users\<seu usuário>\.abap-adt-mcp`. Cole o JSON no Bloco de Notas e em Salvar como defina "Tipo" como "Todos os arquivos" e o nome como `systems.json`, senão o Bloco de Notas salva `systems.json.txt` e o servidor não encontra nada.
- macOS: a pasta é `/Users/<voce>/.abap-adt-mcp` (Finder, Shift-Cmd-G, `~`); qualquer editor.

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["ZFIN"] }
  }
}
```

- `DEV` é o nome que você dá ao sistema e a palavra que usará nos chats; `"default": true` permite omiti-la.
- `url`: o endereço com que você abre o launchpad ou o Eclipse, sem caminho.
- `client`: o mandante em que a sua sessão SSO faz logon (a entrada Sobre do menu de usuário do launchpad o mostra). Um mandante errado aparece depois como "not authorized" em objetos que você abre no Eclipse.
- `authType` assume `sso`: uma janela de navegador abre uma vez para o login, como no Eclipse ADT. Outros modos: [Autenticação](#autenticação).
- `policy.allowedPackages`: os pacotes em que o modelo pode gravar, nomes exatos ou padrões (`ZFIN`, `Z*`). Sem essa chave, todo pacote que você edita no Eclipse é gravável; comece com um.

Sistemas produtivos e on-premise vêm no [passo 4](#4-acrescente-sistemas-produtivos-e-on-premise), depois da primeira chamada bem-sucedida.

### 2. Registre o servidor no seu host

O pacote está no npm como [`abap-adt-mcp`](https://www.npmjs.com/package/abap-adt-mcp); o `npx` o baixa. Claude Desktop, sem terminal: primeiro bloco. Claude Code: um comando. VS Code, Cursor e outros: ponteiro abaixo. Toda entrada passa ao servidor duas configurações: `SAP_SYSTEMS_FILE` (onde está o `systems.json`) e `MCP_TOOLSETS=focused`, que publica as 114 ferramentas de desenvolvimento do dia a dia em vez de todas as 173 para que os esquemas das ferramentas não consumam o contexto do chat (retire-o quando precisar do depurador, traces, abapGit, RAP ou refatoração).

**Claude Desktop**, sem terminal:

1. Settings > Developer > Edit Config abre a pasta que contém `claude_desktop_config.json`; abra o arquivo no Bloco de Notas ou em qualquer editor. Se Settings não tem a aba Developer, o seu Claude Desktop é gerenciado pelo TI: peça a eles que acrescentem a entrada abaixo.
2. Se o arquivo já contém `"mcpServers"`, acrescente só a entrada `"abap-adt-mcp"` dentro dele; se está vazio, cole o bloco inteiro.
3. Troque `<voce>` pelo seu usuário (macOS: `/Users/<voce>/.abap-adt-mcp/systems.json`). As barras normais no caminho Windows são propositais: em JSON cada barra invertida precisa ser `\\`, a barra normal não precisa de nada.
4. Feche e reabra o aplicativo.

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": { "SAP_SYSTEMS_FILE": "C:/Users/<voce>/.abap-adt-mcp/systems.json", "MCP_TOOLSETS": "focused" }
    }
  }
}
```

**Claude Code**, uma linha no terminal (`-s user` registra o servidor para todos os projetos, não só para a pasta atual):

```bash
claude mcp add -s user abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -e MCP_TOOLSETS=focused -- npx -y abap-adt-mcp
```

O mesmo no PowerShell do Windows:

```powershell
claude mcp add -s user abap-adt-mcp -e SAP_SYSTEMS_FILE=$env:USERPROFILE\.abap-adt-mcp\systems.json -e MCP_TOOLSETS=focused -- npx -y abap-adt-mcp
```

**VS Code com GitHub Copilot**: a mesma entrada em `.vscode/mcp.json` sob uma chave de topo `servers` em vez de `mcpServers`; [docs/HOSTS.md](../../docs/HOSTS.md#vs-code-with-github-copilot-agent-mode) (em inglês) traz o arquivo como foi testado, com `${input:}` para segredos.

- Cursor, Cline, Windsurf, o Copilot CLI e o Eclipse: [docs/HOSTS.md](../../docs/HOSTS.md).
- Mantenha a chave `abap-adt-mcp`: é o nome que o host mostra, o prefixo de toda ferramenta e o que as skills de agente deste projeto procuram.

### 3. Diga olá

Abra um chat novo e digite (troque `DEV` pela chave que você escolheu; a classe é padrão SAP, então o pedido é só de leitura e seguro em qualquer sistema):

> Liste meus sistemas SAP, faça login no DEV e mostre o fonte da classe CL_ABAP_CHAR_UTILITIES.

Uma janela de navegador abre para o login SSO (marque "permanecer conectado" e os próximos logins são silenciosos); o modelo então chama `listSystems`, `searchObject` e `getObjectSource`, e a resposta nomeia os seus destinos e termina com o fonte da classe. O host pergunta antes de rodar uma ferramenta que você não aprovou permanentemente: esse diálogo é uma cortesia do host, o bloco `policy` é a garantia. Se o servidor não aparece no host, [Solução de problemas](#solução-de-problemas) nomeia o log a ler.

Duas coisas que vale saber antes da primeira edição:

- Uma escrita que a política proíbe volta como recusa, não como nada silencioso: `kind: "policyDenied"`, `Policy: setObjectSource blocked on destination PRD (readOnly)`.
- Toda mudança que o modelo faz está na sua ordem de transporte e no histórico de versões do objeto: `objectDiff` e `revisions` a mostram, e nada sai do DEV sem uma liberação de ordem que você aprove.

### 4. Acrescente sistemas produtivos e on-premise

O mesmo arquivo com uma entrada produtiva e uma on-premise ([systems.example.json](../../docs/systems.example.json) tem todas as opções):

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
    "policy": { "readOnly": true, "allowDataPreview": false, "deniedTools": ["exportPackageSources"] }
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

- Se um destino produtivo precisa existir, `PRD` é a sua política mínima: `readOnly` recusa toda escrita, seja o que for que se peça ao modelo; `allowDataPreview: false` mantém os dados de tabelas fechados mesmo onde o ambiente os abre para outros destinos; `deniedTools` fecha `exportPackageSources`, a única leitura que copia pacotes inteiros para o disco.
- `${env:VAR}` lê um segredo do ambiente, para que ele nunca fique no arquivo; acrescente a variável onde o host inicia o servidor: `-e ONPREM_PASSWORD=...` no `claude mcp add` (ou exporte-a no shell que inicia o Claude Code), uma linha `"ONPREM_PASSWORD": "..."` no bloco `env` do Claude Desktop, que não repassa o ambiente do seu shell. Um arquivo com senha em texto precisa ser legível só por você (`chmod 600 ~/.abap-adt-mcp/systems.json` no macOS e no Linux; no Windows a sua pasta de perfil já é privada); um arquivo só com SSO não precisa de nada.
- `tls.ca` nomeia um certificado de CA corporativa. A verificação pode ser relaxada só por destino (`insecureTls: true`, anunciado na inicialização), nunca para o processo inteiro.

A instalação termina aqui. A seguir: [O que pedir ao modelo](#o-que-pedir-ao-modelo).

## O que pedir ao modelo

O servidor é uma caixa de ferramentas de que o modelo escolhe: peça em linguagem natural e ele define a sequência.

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
| "Selecione as dez linhas mais recentes de ZTABLE onde STATUS = 'X'." | `runQuery`, ou `tableContents` quando a pré-visualização de dados recusa uma tabela |
| "Experimente este trecho e mostre a saída." | `runSnippet` |
| "Quais toolsets o DEV suporta? O depurador está disponível lá?" | `systemProfile` |

O que o servidor faz sozinho, para que você não precise explicar:

- Ferramentas de escrita bloqueiam, gravam e desbloqueiam por conta própria; `activate=true` ativa na mesma chamada.
- Todo erro volta como JSON com `kind`, `hint` e `nextTools`, então o modelo se recupera em vez de repetir às cegas; uma sessão expirada é reautenticada e a chamada repetida uma vez.
- Resultados grandes são paginados dentro de um orçamento de 40.000 caracteres e reportam `hasMore`; chamadas longas enviam notificações de progresso.
- Leituras de tabelas só rodam onde o destino permite: `tableContents` por nome precisa de `allowDataPreview`, `runQuery` precisa de `allowFreeSql`.
- Os fluxos de criação e edição viajam no campo `instructions` do MCP, e seis fluxos prontos vêm como prompts MCP (`create-object`, `safe-edit`, `review-transport`, `fix-atc`, `clean-core-check`, `debug-dump`; no Claude Code `/mcp__abap-adt-mcp__safe-edit DEV ZCL_ORDER_SERVICE "retornar cedo quando a tabela de entrada estiver vazia"`).
- Toda ferramenta carrega anotações `readOnlyHint`/`destructiveHint`, para que hosts que condicionam a aprovação pela anotação perguntem só nas escritas.

As sequências ferramenta por ferramenta, os formatos de argumento e as receitas estão em [docs/WORKFLOWS.md](../../docs/WORKFLOWS.md) (em inglês).

## Para administradores

O que o servidor é, nos termos que o dono de uma paisagem pergunta:

- **Identidade.** Toda chamada chega ao SAP como o usuário do destino, com as autorizações desse usuário; o servidor não remove nenhuma verificação da SAP e não tem acesso que o usuário não tenha. Com `sso` e `sso2` esse usuário é a pessoa no teclado; `basic` e `oauth` carregam credenciais armazenadas, então prefira usuários nomeados onde a responsabilização importa. As autorizações de um usuário SAP só de exibição estão em [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md#on-prem-production-read-only-with-a-dedicated-display-user).
- **Processo.** Um processo por pessoa, iniciado pelo host MCP, falando stdio; nada escuta na rede a menos que você inicie o [transporte HTTP](../../docs/CONFIGURATION.md#6-http-transport) opcional.
- **Rede.** Ele fala com os hosts SAP configurados, com o provedor de identidade durante o SSO pelo navegador e com `raw.githubusercontent.com` para o repositório de cloudificação da SAP quando `apiReleaseState` roda (cache de 24 horas; `deniedTools: ["apiReleaseState"]` tira isso da rede). Sem telemetria, sem verificação de atualizações; o próprio `npx` contata o registro npm.
- **O que o modelo vê.** O resultado de toda chamada de ferramenta que o usuário aprova (fonte, linhas de tabelas onde abertas, dumps, achados do ATC, texto de erro após a redação) vai ao host MCP e dali ao provedor do modelo, nos termos de dados do próprio host (quem escolhe o provedor é o host, não este servidor); o servidor não envia nada a mais nenhum lugar. `readOnly`, `deniedTables` e `deniedTools` limitam esse conjunto por destino.
- **Disco.** `~/.abap-adt-mcp/`: `systems.json` (seu), o perfil de navegador do SSO por host (`sso/<host>`, modo `0700`), o cache de cloudificação, exportações de pacotes (`exports/`, só onde `exportPackageSources` pode gravar), o token HTTP e, quando habilitado, o log de auditoria. Cookies de sessão SAP nunca são gravados em disco.
- **Segredos.** `${env:VAR}` funciona em toda string do `systems.json`; um arquivo legível por outros é recusado quando contém senhas em texto. Mensagens de erro passam por uma etapa de redação (tokens bearer, cookies, senhas, URLs `user:password@host`); resultados bem-sucedidos não são redigidos, então `readOnly`, `deniedTables` e `deniedTools` são o que os limita. `reentranceTicket` (um ticket de logon que o modelo poderia levar a outro lugar) fica desabilitado a menos que `SAP_ALLOW_REENTRANCE_TICKET=1`.
- **O que a política não enxerga.** ABAP que o modelo executa (`runSnippet`, `runClass`, `unitTestRun`) roda com as autorizações do usuário; `deniedTables` examina o texto do trecho, mas SQL dinâmico e o que quer que o código chame não são inspecionados. Onde a execução de código é inaceitável, liste essas ferramentas em `deniedTools` ou use `readOnly`.
- **Entrada não confiável.** Comentários, linhas de tabelas e feeds do SAP podem carregar texto que tenta guiar o modelo. Use um host que pergunte antes das chamadas e revise as ferramentas em negrito no [Catálogo de ferramentas](#catálogo-de-ferramentas) (as destrutivas) antes de aprovar.
- **Auditoria.** `MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl` acrescenta uma linha JSON por chamada: ferramenta, destino, resultado, duração, a barreira de política que recusou e os argumentos com segredos redigidos. O arquivo é gravado por estação de trabalho pelo processo do próprio usuário; coleta central e proteção contra adulteração ficam por sua conta. [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md#7-audit-log-record-format) traz o formato do registro.
- **Política de API da SAP.** A SAP chama os serviços ADT que este servidor usa de internos, para desenvolvimento pelos canais que ela endossa, e este projeto não está entre eles; interfaces não publicadas são usadas por conta e risco próprios. Pergunte ao seu contato na SAP e mantenha o servidor em sistemas de desenvolvimento e teste. Detalhes em [Política de API da SAP](#política-de-api-da-sap).
- **Revogação.** Um notebook perdido ou um segredo vazado se fecha peça por peça (perfil SSO, sessão no provedor de identidade, segredo OAuth, senha SAP, arquivos locais): [SECURITY.md, Decommissioning](../../.github/SECURITY.md#decommissioning).
- **Releases.** Só a versão mais recente recebe correções; para uma implantação controlada fixe a versão em vez do `npx -y abap-adt-mcp` sem versão da instalação ([Outras formas de instalar](#outras-formas-de-instalar)). Modos testados: `sso`, `sso2` e `basic` on-premise; `oauth` e `basic` com Communication User não ([Autenticação](#autenticação)). Vulnerabilidades: [SECURITY.md, Reporting a vulnerability](../../.github/SECURITY.md#reporting-a-vulnerability).

### Chaves de política

Aplicadas no servidor antes de qualquer chamada ao SAP, por destino no `systems.json`:

| Chave | Efeito |
|---|---|
| `readOnly` | Só ferramentas de leitura rodam: toda escrita de fonte, `lock`, `runSnippet`, `runClass`, `unitTestRun`, `createAtcRun` e `atcSummary` são recusados. Leituras de tabelas (onde abertas) e `exportPackageSources` continuam permitidas; feche-as com as chaves abaixo. |
| `allowDataPreview` | Desligado a menos que `true`: `tableContents` pode ler as linhas de uma tabela ou entidade CDS por nome. Um `false` explícito prevalece sobre `MCP_ALLOW_DATA_PREVIEW`. |
| `allowFreeSql` | Desligado a menos que `true`: `runQuery` e `tableContents` com `sqlQuery` (implica `allowDataPreview`). |
| `deniedTables` | Padrões que o modelo não pode ler (`["PA*", "HR*", "USR02"]`), aplicados às leituras e ao texto ABAP que ele grava ou executa; a autorização de exibição da própria SAP continua sendo o piso. |
| `deniedTools` | Ferramentas recusadas de imediato: nomes, padrões (`rapGen*`) ou `toolset:git`. |
| `allowedPackages` | Escritas só dentro destes pacotes (`["Z*", "$*"]`); um pacote que não se resolve é recusado. |
| `allowedTransports` | Escritas só nestas ordens; criar novas é recusado. |

Recusas voltam como `kind: "policyDenied"` nomeando a barreira; `listSystems` mostra toda política e o `dataAccess` efetivo. O modelo de ameaças e os riscos residuais estão em [SECURITY.md](../../.github/SECURITY.md); as barreiras ferramenta por ferramenta, com receitas, em [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md#3-policy-in-depth); a posição perante a Política de API da SAP em [docs/API-POLICY.md](../../docs/API-POLICY.md). Os três documentos estão em inglês.

## Autenticação

Cada destino escolhe o seu `authType`. Detalhes e os passos do lado SAP estão em [docs/AUTH.md](../../docs/AUTH.md) (em inglês).

| Modo | Use para | O que você configura | Lado SAP |
|---|---|---|---|
| `sso` (padrão) | Usuários nomeados no S/4HANA Cloud, e sistemas on-premise que respondem com um desafio Basic | Nada: um navegador abre uma vez por host; a sessão fica em memória. `SAP_BROWSER_PATH` sobrepõe o navegador. | O papel de negócio de desenvolvedor que o seu usuário já precisa para o Eclipse ADT |
| `sso2` | Usuários nomeados on-premise sem navegador, quando uma ponte local SNC/RFC confiável emite um ticket de vida curta | `sso2.command`, `args`, `timeoutMs` | Mapeamento SNC, aceitação de ticket e logon ICF do ADT configurados pelo Basis |
| `basic` | Usuários de AS ABAP on-premise, Communication Users do S/4HANA Cloud | `user` e `password` (como `${env:VAR}`) | Um usuário com autorizações ADT |
| `oauth` | Clientes não assistidos no S/4HANA Cloud | `oauth.tokenUrl`, `clientId`, `clientSecret` | Communication User, Communication System com OAuth 2.0, Communication Arrangement para o cenário ADT do seu tenant |

- Usuários de negócio nomeados no S/4HANA Cloud não podem usar autenticação básica: eles entram por `sso`, ou você cria um Communication User. `oauth` e `basic` com Communication User seguem a documentação da SAP para usuários técnicos, mas não foram exercitados por este projeto contra um tenant real; confirme no seu antes de depender deles.
- Em um desafio Basic on-premise a janela do navegador pede a senha SAP; se você deixar o navegador salvá-la, ela fica no perfil dedicado em `~/.abap-adt-mcp/sso/<host>`.
- A verificação TLS fica ligada para o processo. Por destino, `tls.ca` acrescenta uma CA corporativa, `tls.servername` nomeia o certificado de um sistema acessado por endereço IP, `tls.cert` + `key` (ou `pfx` + `passphrase`) apresentam um certificado de cliente, e `insecureTls: true` é anunciado na inicialização. `gitUser`/`gitPassword` opcionais mantêm as credenciais do abapGit fora da conversa.

## S/4HANA Cloud versus on-premise

`systemProfile(destination)` reporta se um destino é cloud ou on-premise e quais toolsets faltam no backend; essas ferramentas são recusadas antes de chamar o SAP. O que [docs/TESTPLAN.md](../../docs/TESTPLAN.md) registrou em um tenant Public Cloud:

| Tema | S/4HANA Cloud (edição pública) | On-premise / privado |
|---|---|---|
| Autenticação | Usuários nomeados: só SSO pelo navegador. Não assistido: OAuth2 a partir de um Communication Arrangement, ou autenticação básica com um Communication User. | Autenticação básica; certificados de cliente via `tls`; SSO pelo navegador em sistemas com desafio Basic; `sso2` sem navegador por um provedor local de tickets. |
| Objetos locais | `$TMP` foi recusado no tenant testado (objeto de autorização `S_ABPLNGVS`); use um pacote de cliente com ABAP for Cloud Development e sua ordem de transporte, `resolveTransport` a escolhe. `runSnippet` precisa de `packageName`, `transport` e `responsible` lá. | `$TMP` disponível, sem ordem de transporte; `runSnippet` assume `$TMP`. |
| Toolsets | Gerador RAP ausente no tenant testado; depurador, traces e abapGit dependem do tenant e das autorizações. `dumps`/`dumpDetails` são o caminho de causa raiz quando o depurador falta; `sourceTextSearch` recorre a `grepPackage` quando o tenant não tem índice de texto. | Conjunto completo de coleções ADT em uma versão atual. |
| APIs liberadas | `apiReleaseState` verifica nomes, uma URL de objeto ou um fonte inteiro; variante ATC `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. `createObject` precisa de `responsible`. | Opcional. |
| Dados de negócio | `runQuery`/`tableContents` respeitam autorizações de exibição, e o destino tem que permiti-los. `runSnippet` precisa de `S_DEVELOP`, portanto só sistemas de desenvolvimento. | Igual. |

Mais em [docs/CLOUD.md](../../docs/CLOUD.md) e, de sessões reais, [docs/FIELD-NOTES.md](../../docs/FIELD-NOTES.md) (ambos em inglês).

## Outras formas de instalar

- **Fixe a versão.** `npx -y abap-adt-mcp` baixa a versão mais recente a cada início; para uma implantação controlada, fixe-a (`npx -y abap-adt-mcp@X.Y.Z`, ou a tag de contêiner `vX.Y.Z`). Os releases carregam uma atestação de proveniência npm, verificável com `npm audit signatures`.
- **Plugin do Claude Code.** Dois comandos registram o servidor e instalam as duas skills de agente (`abap-adt-mcp` ensina o fluxo de desenvolvimento, `abap-adt-mcp-setup` guia pela instalação): `/plugin marketplace add williansaez/abap-adt-mcp`, depois `/plugin install abap-adt-mcp@abap-adt-mcp`. O plugin fixa a versão com que foi publicado e publica todos os toolsets; o `systems.json` do passo 1 continua sendo seu.
- **Contêiner.** `ghcr.io/williansaez/abap-adt-mcp:latest` (também `vX.Y.Z`), construído de `node:22-alpine`, roda como uid 1000. Monte o `systems.json` só de leitura e passe os segredos referenciados; o SSO pelo navegador precisa de um navegador local, então rode destinos `sso` a partir do npm na estação de trabalho. [docs/HOSTS.md](../../docs/HOSTS.md#docker-based-hosts) traz a linha `docker run` e as armadilhas de propriedade de arquivos.
- **Registro MCP.** Listado como `io.github.williansaez/abap-adt-mcp` para hosts que navegam pelo registro.
- **A partir do fonte.** `git clone https://github.com/williansaez/abap-adt-mcp.git`, `npm ci`, `npm run build`, depois aponte o host para `node /caminho/absoluto/abap-adt-mcp/dist/index.js`. Um `systems.json` ao lado do checkout é lido automaticamente.

## Configuração

- Fontes, em ordem de precedência: `SAP_SYSTEMS` (JSON em linha), `SAP_SYSTEMS_FILE`, um `systems.json` ao lado da instalação, depois as variáveis legadas de sistema único (`SAP_URL`, `SAP_CLIENT`, `SAP_USER`, `SAP_PASSWORD`, ...).
- Chaves por destino: `url`, `client`, `language`, `authType`, `default`, `user`/`password`, `sso2`, `oauth`, `insecureTls`, `gitUser`/`gitPassword`, `policy`, `tls`; qualquer string pode ser `${env:VAR}`.
- Não existe `deniedTools`, `deniedTables` ou `allowedPackages` global: essas chaves se repetem por entrada.

As variáveis que você mais provavelmente vai definir:

| Variável | Finalidade | Padrão |
|---|---|---|
| `SAP_SYSTEMS_FILE` | Caminho do arquivo de destinos | Recomendado em vez de `SAP_SYSTEMS` em linha |
| `MCP_TOOLSETS` | `all`, `focused`, ou uma lista separada por vírgulas de toolsets a publicar | `all` (a instalação acima escolheu `focused`) |
| `MCP_READ_ONLY` | `1` torna todo destino somente leitura | Desligado |
| `MCP_ALLOW_DATA_PREVIEW`, `MCP_ALLOW_FREE_SQL` | `1` abre dados de tabelas ou SQL nos destinos que não declaram a chave | Desligado |
| `MCP_AUDIT_FILE` | Trilha de auditoria JSONL | Desligado |
| `MCP_MAX_RESPONSE_CHARS` | Orçamento de uma resposta de ferramenta antes da paginação | 40000 |
| `MCP_HTTP_PORT` | Serve Streamable HTTP em `127.0.0.1:<porta>/mcp` com um token bearer em vez de stdio | Não definido (stdio) |
| `SAP_BROWSER_PATH` | SSO: o binário Chromium a usar | Detectado automaticamente |

Toda variável, com o seu padrão e o que ela afeta, o transporte HTTP (token, limites de sessão e de corpo, proteção contra DNS rebinding, o que uma instância compartilhada significa) e o formato do registro de auditoria estão em [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md) (em inglês).

## Catálogo de ferramentas

A referência ferramenta por ferramenta (descrição, parâmetros, anotações de leitura/destrutiva) é [docs/TOOLS.md](../../docs/TOOLS.md), gerada da resposta real de `tools/list` e verificada por um teste de contrato no CI. Toda ferramenta exceto `listSystems` e `healthcheck` aceita um `destination` opcional.

Esquemas de ferramentas consomem contexto. `MCP_TOOLSETS` aceita um preset (`all`, o padrão, ou `focused` = 114 ferramentas de desenvolvimento) ou uma lista separada por vírgulas dos nomes de toolset abaixo; `MCP_DISABLED_TOOLSETS` remove alguns; `core` é sempre publicado.

<!-- toolsets:begin -->
Nomes em **negrito** carregam `destructiveHint: true` (23 ferramentas): elas sobrescrevem, apagam, liberam ou executam algo, e hosts que condicionam a aprovação pela anotação perguntam antes de cada uma.

**No preset `focused` (114 ferramentas)**

| Toolset | Ferramentas |
|---|---|
| `core` (6)<br>Destinations, health & session | `login`, `logout`, **`dropSession`**, `listSystems`, `healthcheck`, `systemProfile` |
| `source` (16)<br>Source code | `lock`, `unLock`, `listLocks`, **`forceUnlock`**, `getObjectSource`, **`setObjectSource`**, **`editObjectSource`**, `getMethodSource`, **`setMethodSource`**, `prettyPrinterSetting`, `setPrettyPrinterSetting`, `prettyPrinter`, `revisions`, `objectDiff`, `getTextElements`, **`setTextElements`** |
| `objects` (27)<br>Objects & navigation | `objectStructure`, `searchObject`, `findObjectPath`, `objectTypes`, `reentranceTicket`, `classIncludes`, `classComponents`, **`deleteObject`**, `activateObjects`, `activateByName`, `activatePackage`, `inactiveObjects`, `objectRegistrationInfo`, `creatableTypeDetails`, `validateNewObject`, `createObject`, `nodeContents`, `mainPrograms`, `typeHierarchy`, `objectStructureElements`, `objectEnhancements`, `packageTree`, `exportPackageSources`, `whereUsed`, `cdsViewInfo`, `sourceTextSearch`, `grepPackage` |
| `transports` (18)<br>Transports | `transportDetails`, `transportUnifiedDiff`, `transportInfo`, `resolveTransport`, `createTransport`, `hasTransportConfig`, `transportConfigurations`, `getTransportConfiguration`, `setTransportsConfig`, `createTransportsConfig`, `userTransports`, `transportsByConfig`, **`transportDelete`**, **`transportRelease`**, `transportSetOwner`, `transportAddUser`, `systemUsers`, `transportReference` |
| `analysis` (16)<br>Syntax & code analysis | `syntaxCheckCode`, `syntaxCheckCdsUrl`, `codeCompletion`, `findDefinition`, `usageReferences`, `syntaxCheckTypes`, `codeCompletionFull`, **`runClass`**, `codeCompletionElement`, `usageReferenceSnippets`, `fixProposals`, `fixEdits`, `fragmentMappings`, `abapDocumentation`, `apiReleaseState`, **`runSnippet`** |
| `tests` (4)<br>Unit tests | `unitTestRun`, `unitTestEvaluation`, `unitTestOccurrenceMarkers`, `createTestInclude` |
| `atc` (14)<br>ATC | `atcCustomizing`, `atcQuickfixProposals`, **`atcApplyQuickfix`**, `atcCheckVariant`, `atcSummary`, `createAtcRun`, `atcWorklists`, `atcUsers`, `atcExemptProposal`, `atcRequestExemption`, `isProposalMessage`, `atcContactUri`, `atcChangeContact`, `atcDocumentation` |
| `data` (10)<br>Data access & DDIC | `annotationDefinitions`, `ddicElement`, `ddicRepositoryAccess`, `packageSearchHelp`, `getDomainProperties`, **`setDomainProperties`**, `getDataElementProperties`, **`setDataElementProperties`**, `tableContents`, `runQuery` |
| `runtime` (3)<br>Runtime errors | `feeds`, `dumps`, `dumpDetails` |

**Só com `MCP_TOOLSETS=all` ou pelo nome do toolset (59 ferramentas)**

| Toolset | Ferramentas |
|---|---|
| `discovery` (7)<br>Discovery & metadata | `featureDetails`, `collectionFeatureDetails`, `findCollectionByUrl`, `loadTypes`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibilityGraph` |
| `refactoring` (8)<br>Refactoring | `renameEvaluate`, `renamePreview`, **`renameExecute`**, `extractMethodEvaluate`, `extractMethodPreview`, **`extractMethodExecute`**, `changePackagePreview`, **`changePackageExecute`** |
| `rap` (8)<br>RAP generation | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenGetContent`, `rapGenValidateInitial`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `services` (4)<br>Business services | `publishServiceBinding`, **`unPublishServiceBinding`**, `fetchServiceDetails`, `bindingDetails` |
| `git` (10)<br>abapGit | `gitRepos`, `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, **`gitUnlinkRepo`**, `stageRepo`, **`pushRepo`**, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch` |
| `debugger` (13)<br>Debugger | `debuggerListeners`, `debuggerListen`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerSaveSettings`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, **`debuggerSetVariableValue`** |
| `traces` (9)<br>Traces | `tracesList`, `tracesListRequests`, `tracesHitList`, `tracesDbAccess`, `tracesStatements`, `tracesSetParameters`, `tracesCreateConfiguration`, **`tracesDeleteConfiguration`**, **`tracesDelete`** |
<!-- toolsets:end -->

Uma ferramenta pode faltar por dois motivos: o toolset dela não está publicado (a recusa nomeia o toolset), ou o destino não consegue servi-la (`systemProfile` reporta o que falta).

## Comparação com o ADT MCP Server oficial da SAP

O ADT MCP Server da SAP vem com o ADT para VS Code e Eclipse e publica sob a chave de servidor `abap-adt` com seus próprios nomes de ferramentas. Este projeto publica sob `abap-adt-mcp`, serve vários destinos a partir de um processo, aplica políticas do lado do servidor e acrescenta composições como `resolveTransport`, `editObjectSource`, `grepPackage`, `apiReleaseState`, `runSnippet` e `objectDiff`. Os dois podem rodar lado a lado no mesmo host; [docs/ROUTING.md](../../docs/ROUTING.md) mapeia os nomes da SAP para os nossos.

Nomes como a página "Model Context Protocol Tools" do SAP Help os lista (setembro de 2026). O servidor da SAP cria, ativa, testa, verifica e transporta; ele não lê nem busca fonte, não grava fonte, não bloqueia e não mostra dumps: isso vem só deste servidor.

| Ferramenta oficial da SAP | Ferramenta(s) do abap-adt-mcp |
|---|---|
| `abap_lists_destinations` | `listSystems`, `systemProfile` |
| `abap_creation-get_all_creatable_objects`, `abap_creation-get_object_type_details` | `objectTypes`, `creatableTypeDetails` |
| `abap_creation-run_validation`, `abap_creation-create_object` | `validateNewObject`, `createObject` |
| `abap_activate_objects` | `activateByName`, `activateObjects`, `activatePackage` |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_transport-create`, `abap_transport-get` | `createTransport`, `resolveTransport`, `transportInfo`, `transportDetails`, `userTransports` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff` |
| `abap_generators-list_generators`, `abap_generators-get_schema`, `abap_generators-generate_objects` | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate` |
| `abap_business_services-fetch_services`, `abap_business_services-fetch_service_information` | `fetchServiceDetails`, `bindingDetails` |
| `abap_atc_run`, `abap_atc_get_result` | `createAtcRun`, `atcWorklists`, `atcSummary` |
| `abap_atc_execute_deterministic_quickfixes` | `atcQuickfixProposals`, `atcApplyQuickfix` |
| `abap_atc_apply_ai_fix`, `abap_atc_get_ai_fix_result` (licença Joule) | Sem equivalente: o modelo lê o achado (`atcDocumentation`) e edita o fonte ele mesmo (`editObjectSource`) |
| Fora do servidor da SAP: ler e buscar fonte, gravar fonte, bloqueios, dumps, dados, onde-usado, depurador, abapGit, verificação Clean Core | `getObjectSource`, `searchObject`, `sourceTextSearch`, `grepPackage`, `setObjectSource`, `editObjectSource`, `lock`, `dumps`, `runQuery`, `whereUsed`, os toolsets de depurador e abapGit, `apiReleaseState` |

## Política de API da SAP

- **O que a SAP diz.** Os serviços REST do ADT que este servidor chama (`/sap/bc/adt`) são os mesmos que o Eclipse ADT usa; a SAP não os lista no SAP Business Accelerator Hub. A Política de API da SAP (abril de 2026) restringe as interfaces não publicadas e o uso de APIs por agentes de IA fora das arquiteturas que a SAP endossa. O FAQ da SAP sobre a política chama as APIs do ADT de internas, para desenvolvimento e somente pelos canais endossados, e um servidor MCP de terceiros não está entre os canais que ele lista; o mesmo FAQ permite servidores MCP de terceiros em geral e diz que interfaces não publicadas são usadas por conta e risco próprios.
- **O que isso significa para você.** Se a SAP aceita o seu uso é uma pergunta para o seu contato na SAP, não para este projeto.
- **O que fazer.** Faça essa pergunta, e mantenha o servidor em trabalho de desenvolvimento, em sistemas de desenvolvimento e teste.

O que o servidor faz do lado dele: roda como o usuário SAP que fez o logon e não remove nenhuma verificação de autorização da SAP, não lê dados de tabelas até que um destino permita, executa as chamadas a um destino uma de cada vez, e `apiReleaseState` marca todo objeto SAP que confere como `released`, `classic`, `notReleased` ou `prohibited`. [docs/API-POLICY.md](../../docs/API-POLICY.md) (em inglês) traz a política seção por seção, as perguntas a levar à SAP e uma configuração conservadora.

## Solução de problemas

- **O servidor nunca aparece no host.** Leia o log MCP do host: o Claude Desktop grava `mcp.log` e `mcp-server-abap-adt-mcp.log` em `~/Library/Logs/Claude` no macOS e em `%APPDATA%\Claude\logs` no Windows; o Claude Code mostra o estado com `/mcp`. O Claude Desktop lê a configuração só no início: feche e reabra após cada mudança.
  - `spawn npx ENOENT`: o Node.js não está instalado, ou não está no PATH que o aplicativo enxerga. Instale-o, ou coloque o caminho absoluto do `npx` em `command` (`C:/Program Files/nodejs/npx.cmd` no Windows, `/usr/local/bin/npx` ou `/opt/homebrew/bin/npx` no macOS).
  - `EBADENGINE`: o Node que o host encontrou é mais antigo que 22.12.
  - `No ABAP systems configured`: `SAP_SYSTEMS_FILE` aponta para um arquivo inexistente (no Windows, procure por `systems.json.txt`).
  - `is not valid JSON`: uma vírgula perdida, ou um caminho Windows escrito com barras invertidas simples.
- **Nenhuma janela de navegador, ou o SSO falha.** Um navegador Chromium precisa estar instalado; `SAP_BROWSER_PATH` aponta para ele quando a detecção automática falha. Para sair completamente de um tenant, apague a pasta `sso/<host>` dentro de `.abap-adt-mcp` na sua pasta pessoal (`C:\Users\<voce>` no Windows). Em uma máquina sem tela (um runner de CI, um contêiner) o login recusa de imediato e indica `oauth` ou `sso2`.
- **O login funciona, depois tudo é "not authorized" ou "not found".** A sessão SSO aterrissou em outro mandante que não o de `client`: defina `client` como o mandante de logon do tenant.
- **`kind: "sessionExpired"` continua voltando.** O servidor já reautenticou e repetiu uma vez; peça ao modelo para chamar `login` naquele destino. Handles de bloqueio da sessão antiga são inválidos: bloqueie de novo.
- **`kind: "locked"` por outra sessão.** `listLocks` mostra os bloqueios do próprio servidor; se o objeto não está lá, o bloqueio pertence a outra sessão (Eclipse ou outro usuário) e só aquela sessão ou a `SM12` o libera.
- **`kind: "policyDenied"`.** A `policy` do destino proíbe a chamada e a mensagem nomeia a barreira: a salvaguarda está funcionando. `tableContents` e `runQuery` são recusados em todo destino que não os abriu, inclusive um destino sem `policy`; a mensagem nomeia a chave a definir.
- **Ferramenta recusada como não disponível ou não habilitada.** "Not available on destination": o tenant não tem aquela coleção ADT (`systemProfile` mostra). "Belongs to toolset ... which is not enabled": acrescente o toolset a `MCP_TOOLSETS` ou use `MCP_TOOLSETS=all`.
- **Erros de certificado on-premise (`kind: "tlsCertificate"`).** A dica nomeia o destino e a correção: `tls.ca` para um emissor desconhecido (a dica traz a linha `openssl`), `tls.servername` para nome divergente, renovação na `STRUST` para certificado expirado.
- **`editObjectSource` reporta 0 ocorrências, ou várias.** Nada foi gravado. A âncora precisa ser o texto atual exato no SAP, indentação incluída; para várias ocorrências inclua mais linhas ao redor.
- **`runQuery` falha em uma tabela que o usuário consegue exibir.** A pré-visualização de dados recusa tabelas com `dataMaintenance` restrito; use `tableContents`.

Mais casos, com as mensagens exatas, em [docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md) (em inglês).

## Testes e contribuição

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
npm test
```

- As suítes Jest cobrem handlers, dicas de erro, dimensionamento de respostas, toolsets e o contrato do catálogo; o CI as executa em Node 22 e 24 e constrói a imagem de contêiner.
- Após mudar uma ferramenta, rode `npm run tools:docs` e faça commit do `docs/TOOLS.md` regenerado, do snapshot e do catálogo do README (os READMEs traduzidos incluídos).
- `npm run docs:check` é a barreira da documentação: sem identificadores de clientes, sem travessões, sem links quebrados, toda variável de ambiente declarada em `server.json`.
- Os releases são guiados por tag: npm via trusted publishing com proveniência, a imagem GHCR e a entrada no registro MCP.
- Faça fork, crie um branch, abra um pull request; [CONTRIBUTING.md](../../.github/CONTRIBUTING.md) traz os detalhes. Relatórios de sessão para [docs/FIELD-NOTES.md](../../docs/FIELD-NOTES.md) são bem-vindos, sem nomes de clientes, tenants ou números de ordem de transporte.

O README em inglês é a referência para as versões em [português](README.pt-BR.md) e [alemão](README.de.md). O roteiro está em [docs/ROADMAP.md](../../docs/ROADMAP.md) e cada release em [CHANGELOG.md](../../CHANGELOG.md).

## Créditos

Este servidor cresce com quem o roda em paisagens reais e devolve o que encontrou.

- [João Gementi](https://github.com/JoaoVTGementi) contribuiu o modo `sso2` sem navegador (um usuário nomeado on-premise que já se autentica por SNC conecta sem navegador e sem senha armazenada) e endureceu o cliente de cookies, que agora recusa qualquer requisição que levaria a sessão SAP para fora da origem configurada.
- [Alexandre Leite](https://github.com/Dregus) relatou o cenário do Secure Login Client que abriu o marco 2.1.0 e testou os caminhos de autenticação on-premise.
- O servidor original `mcp-abap-abap-adt-api` de [mario-andreschak](https://github.com/mario-andreschak) é onde este projeto começou.

Achou algo, corrigiu algo ou rodou um modo em uma paisagem que ninguém aqui tem? Abra uma issue ou um pull request, e veja [CONTRIBUTING.md](../../.github/CONTRIBUTING.md).

## Licença

[MIT](../../LICENSE). Construído sobre [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) de Marcello Urbani. Se o projeto economiza o seu tempo, você pode [patrocinar o autor](https://github.com/sponsors/williansaez).
