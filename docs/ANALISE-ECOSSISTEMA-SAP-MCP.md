# Análise do ecossistema SAP MCP: o que melhorar no abap-adt-mcp

Documento de síntese produzido a partir de dez relatórios de pesquisa (um por agrupamento de projetos) e de uma ronda de debate entre os dez agentes. Cada lacuna foi fundida com as suas duplicadas, pontuada (média das notas de 1 a 5 atribuídas pelos dez votantes) e verificada por mim no repositório em `/Users/williansaez/GitHub/MCP/abap-adt-mcp` (ramo `main`, 0.3.1 mais alterações não lançadas) antes de entrar na classificação.

Nota de verificação: nenhuma das dez melhorias principais estava já implementada. Dois itens propostos foram removidos ou reduzidos por já existirem em parte: (1) "execuções ATC por pacote ou transporte" (agente AWS) foi reduzido a "documentar o `mainUrl` e acrescentar um resumo por prioridade", porque `abap-adt-api` coloca o `mainUrl` diretamente num `adtcore:objectReference` do conjunto de objetos ATC, o que já aceita URIs de pacote (`node_modules/abap-adt-api/build/api/atc.js:214-224`); (2) "lista de bloqueio de tabelas sensíveis" e "lista de permissões de ferramentas via configuração" foram fundidas na política por destino em vez de ficarem como itens autónomos.

## Resumo executivo

- **A maior lacuna é de segurança no servidor, não de ferramentas.** Os dez agentes deram nota 5 à política por destino: `SystemConfig` em `src/lib/systems.ts` não tem nenhum campo de política e o despachante `CallTool` em `src/index.ts:440-470` executa qualquer ferramenta aprovada pelo anfitrião. Um destino PRD tem hoje a mesma superfície de escrita de 143 ferramentas que o DEV; apenas as anotações `readOnlyHint`/`destructiveHint` protegem, e vários anfitriões ignoram-nas.
- **A distribuição está partida.** `npm view abap-adt-mcp` devolve 404 apesar de `package.json` declarar `bin` e de `server.json` apontar para esse pacote; não existe pasta `.github`, os três conjuntos de testes Jest (194 linhas) nunca correm em CI, e o `Dockerfile` faz `COPY . .` sem `.dockerignore` enquanto um `systems.json` com credenciais está na árvore de trabalho.
- **O ciclo de escrita custa cinco chamadas aprovadas e um `lockHandle` transportado à mão.** `setObjectSource` e `editObjectSource` exigem `lockHandle` (`src/handlers/ObjectSourceHandlers.ts:67,97`), a edição é por intervalo de linhas e não existe registo servidor dos bloqueios detidos. Oito dos dez agentes convergiram numa ideia nova no debate: um registo de bloqueios por destino é pré-requisito tanto da escrita com bloqueio automático como da recuperação de sessão.
- **Há capacidade já paga e não exposta.** Nove métodos de `abap-adt-api` 8.4.1 (`typeHierarchy`, `getTextElements`/`setTextElements`, `getDomainProperties`/`setDomainProperties`, `getDataElementProperties`/`setDataElementProperties`, `objectEnhancements`, `atcDocumentation`, `changePackagePreview`/`Execute`, `objectStructureElements`) não são referenciados em `src/`, e o esquema de `getObjectSource` declara `options` como `string` quando a biblioteca espera `ObjectSourceOptions {version,...}`, o que torna impossível ler a versão inativa.
- **Onde já estamos à frente:** multidestino num só processo, SSO de navegador com perfil persistente e OAuth2 para S/4HANA Cloud, 143 ferramentas com anotações, paginação com orçamento de 40 mil caracteres, e zero instalação no lado ABAP. As melhorias abaixo foram escolhidas para reforçar esta posição, não para copiar arquiteturas BTP que a contrariam.

## Top 10 melhorias

| # | Melhoria | Categoria | Evidência (URL) | O que falta hoje | Esforço | Impacto | Votos média/n |
|---|---|---|---|---|---|---|---|
| 1 | Política de segurança por destino no servidor (`readOnly`, `allowedPackages`, `denyTools`, `allowFreeSql`/`denyTables`, `allowedTransports`) | auth/security | https://docs.arc-1-mcp.com/authorization/ ; https://github.com/babamba2/abap-mcp-adt-powerup ; https://raw.githubusercontent.com/oisee/vibing-steampunk/main/docs/cli-agents/codex.md | `SystemConfig` sem campos de política; despachante sem verificação; `READ_ONLY_TOOLS` existe só para anotações | médio | alto | 5,0/10 |
| 2 | Filtro de conjuntos de ferramentas (`MCP_TOOLSETS` com os 19 domínios de `docs/TOOLS.md`, predefinição `focused`) | agent-ergonomics | https://github.com/oisee/vibing-steampunk ; https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/README.md ; https://github.com/DataZooDE/erpl-adt/blob/main/docs/cli-usage.md | `ListTools` devolve sempre 143 esquemas; `grep -i toolset src/` vazio | pequeno | alto | 5,0/10 |
| 3 | Publicação no npm, CI com teste de contrato de `tools/list`, higiene do Docker (`.dockerignore`, `npm ci`, utilizador não root) | distribution/packaging, testing/CI | https://github.com/marianfoo/mcp-sap-docs/tree/main/.github/workflows ; https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/docs_parity_test.go ; https://skills.cloud.sap/ | npm 404; sem `.github`; sem `.dockerignore`; `Dockerfile` copia `systems.json` | pequeno | alto | 5,0/10 |
| 4 | Escrita com bloqueio automático e registo de bloqueios por destino (`lockHandle` opcional, `activate`, `listLocks`, libertação em erro) | agent-ergonomics, architecture | https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/lock_scope.go ; https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/lock.go ; https://raw.githubusercontent.com/marcellourbani/vscode_abap_remote_fs/master/modules/abapfs/src/lockManager.ts | `lockHandle` obrigatório; `dropSession` só limpa cache local; o servidor não sabe que bloqueios detém | médio | alto | 4,6/10 (+ ideia nova de 8 agentes) |
| 5 | Edição ancorada em texto (`oldText`/`newText`, correspondência única) e leitura/escrita por método (`getMethodSource`/`setMethodSource`) | agent-ergonomics, performance/response-size | https://raw.githubusercontent.com/marcellourbani/vscode_abap_remote_fs/master/client/src/services/lm-tools/mcpReplaceStringTool.ts ; https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_source.go ; https://git.epod.dev/erhan/epod-adt-mcp-updatesite | `editObjectSource` só por `startLine`/`endLine`; `classComponents` não dá intervalos utilizáveis | pequeno + médio | alto | 4,3/10 e 4,0/10 |
| 6 | Expor métodos já existentes na biblioteca e corrigir esquemas (`options` de `getObjectSource`, enum de `debuggerStep`), atualizar para `abap-adt-api` 8.4.3 | tooling | https://raw.githubusercontent.com/marcellourbani/abap-adt-api/master/src/AdtClient.ts ; https://github.com/fr0ster/mcp-abap-adt/blob/main/docs/user-guide/AVAILABLE_TOOLS_HIGH.md | 9 métodos sem invólucro; `options: { type: 'string' }` em `ObjectSourceHandlers.ts:41` | pequeno | alto | 4,1/10 (+ ideia nova de 5 agentes) |
| 7 | Pesquisa de texto no código fonte (`textsearch` ADT em on-prem, `grepPackage` no cliente como alternativa Cloud) | tooling | https://github.com/chandrashekhar-mahajan/abap-mcp-server/blob/master/src/tools/search.ts ; https://raw.githubusercontent.com/oisee/vibing-steampunk/main/README_TOOLS.md | `searchObject` só por nome; `usageReferences` exige posição; biblioteca sem `textsearch` | médio | alto | 4,1/10 |
| 8 | Recuperação de sessão (re-login silencioso e uma repetição) e erros com sugestão da próxima ferramenta | agent-ergonomics | https://raw.githubusercontent.com/arc-mcp/arc-1-lsp/main/docs/adt-ls-reference.md ; https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/errors.go | `ensureLogin` só verifica um booleano e só para SSO; `cookieHttpClient.ts` sem repetição; `adtErrorFormatting.ts` não classifica | pequeno | alto | 4,0/10 e 3,9/10 |
| 9 | Prontidão Cloud: `systemProfile` por destino e `apiReleaseState` (estado Clean Core e sucessor) | cloud-readiness | https://github.com/workskong/mcp-abap-adt/blob/main/src/handlers/handle_API_Releases.ts ; https://github.com/ClementRingot/ROSA/blob/main/src/tools/register-tools.ts ; https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_system.go | `healthcheck`/`listSystems` só ecoam configuração; nenhuma ferramenta toca em `apireleases`; TESTPLAN regista 8 ferramentas a falhar no inquilino Cloud | pequeno + médio | alto | 4,0/10 e 4,0/10 |
| 10 | Pacote instalável de competências (`skills/*/SKILL.md`, manifesto `.claude-plugin`), renomear a chave `abap-adt` no README e aliases opcionais com os nomes oficiais SAP | distribution/packaging, agent-ergonomics | https://github.com/matt1as/claude-abap-skills/blob/main/abap-cloud-rap/CLAUDE.md ; https://github.com/SAP/ai-skills-library ; https://docs.arc-1-mcp.com/skills/ | Sem `skills/` nem `.claude-plugin`; `README.md:43,69` regista a chave `abap-adt`, a mesma que o ecossistema reserva ao servidor oficial da SAP | médio | alto | 4,0/10 (+ ideia nova de 3 agentes) |

## Detalhe das 10

### 1. Política de segurança por destino no servidor

**O que os outros fazem.** ARC-1 arranca só de leitura e exige opt-in positivo por classe de mutação (`SAP_ALLOW_WRITES`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_FREE_SQL`, `SAP_ALLOWED_PACKAGES` verificado contra o pacote real do objeto, `SAP_DENY_ACTIONS`). vibing-steampunk aplica `SAP_READ_ONLY`, `SAP_ALLOWED_OPS=RSQ`, `SAP_ALLOWED_PACKAGES`, `SAP_ALLOWED_TRANSPORTS` e `read_only: true` por sistema dentro do cliente ADT, independentemente do anfitrião. powerup usa `SAP_TIER=DEV|QA|PRD` com `ERR_READONLY_TIER` e uma lista de bloqueio de tabelas com dados pessoais (`SC4SAP_POLICY`). epod expõe um interruptor "só leitura" por sistema que bloqueia nove ferramentas de escrita e reporta o modo em `sap_list_systems`.

**O que temos.** Verifiquei: `src/lib/systems.ts` define `SystemConfig` com url, client, authType, credenciais, `insecureTls`, `gitUser`/`gitPassword` e `default`; nada de política. O despachante em `src/index.ts:440-470` só resolve o destino, garante o login SSO e chama `dest.handlers[handlerKey].handle`. `READ_ONLY_TOOLS` (linha 153) e `DESTRUCTIVE_TOOLS` (linha 190) existem apenas para emitir anotações. As únicas variáveis de ambiente lidas são `MCP_HTTP_PORT`, `MCP_HTTP_TOKEN`, `MCP_MAX_RESPONSE_CHARS`, `SAP_BROWSER_*` e `NODE_TLS_REJECT_UNAUTHORIZED`.

**Proposta concreta.**
- Acrescentar a `SystemConfig` um bloco opcional `policy`: `{ readOnly?: boolean, allowedPackages?: string[], deniedTools?: string[], allowFreeSql?: boolean, deniedTables?: string[], allowedTransports?: string[] }`, com padrões glob (`Z*`, `$*`, `DEVK*`). Aceitar também `MCP_READ_ONLY=1` global.
- Criar `src/lib/policy.ts` com `assertAllowed(system, toolName, args)`; chamar no despachante antes de `ensureLogin`. Ferramentas não em `READ_ONLY_TOOLS` são bloqueadas quando `readOnly`; `runQuery`/`tableContents` respeitam `allowFreeSql`/`deniedTables`; `createObject`, `setObjectSource`, `editObjectSource`, `deleteObject`, `atcApplyQuickfix` resolvem o pacote (parâmetro `package`/`parentName` ou `objectStructure`) e verificam `allowedPackages` em modo fechado; `transportRelease`, `transportDelete`, `setObjectSource(transport)` verificam `allowedTransports`.
- Erros devem nomear o portão e o destino: `"deleteObject bloqueado: destino QAS está readOnly (systems.json policy)"`, para o agente não repetir a chamada.
- `listSystems` passa a devolver `policy` resumida por destino (ideia nova do agente 7: como `tools/list` é global por processo, a única forma de o agente saber antes da chamada é através de `listSystems` e das instruções).
- Teste Jest: `policy.test.ts` cobre os cinco portões com um `systems.json` de fixture.

**Riscos.** A resolução do pacote real custa uma chamada ADT extra por escrita; usar a cache de `sourceCache` e o `parentName` quando presente. Não ocultar ferramentas negadas de `tools/list` por destino (ver item 9 e a nota do agente 9 sobre `tools/list` determinístico).

### 2. Filtro de conjuntos de ferramentas

**O que os outros fazem.** vibing-steampunk tem três modos (1 ferramenta com ~200 tokens, ~100 com ~14 mil, 147 com ~40 mil) e `SAP_DISABLED_GROUPS`; aibap.mcp usa `--tools=source,objects,testing,transport` com o grupo de depuração desligado por omissão; erpl-adt usa `--tools adt,bw,catalog`; a SAP agrupa por prefixo e deixa o anfitrião desligar ferramentas; abapilot filtra com `ABAPILOT_TOOLS`.

**O que temos.** `docs/TOOLS.md` já tem 19 secções por domínio, mas `src/index.ts` regista todos os handlers incondicionalmente e `grep -i "toolset\|MCP_TOOLS" src/` não devolve nada. Os 13 esquemas do depurador e os 9 de traces (indisponíveis no inquilino Cloud, ver `docs/TESTPLAN.md`) chegam a todos os anfitriões em todas as sessões.

**Proposta concreta.**
- Mapear cada handler a um domínio (o nome da secção de `TOOLS.md`, em minúsculas: `source`, `transports`, `atc`, `rap`, `debugger`, `traces`, `git`, `refactoring`, `data`, `services`, ...). Guardar num manifesto `src/toolManifest.ts` exportado (ver item 3, serve também para o teste de contrato).
- `MCP_TOOLSETS=core,transports,atc` (lista) ou `MCP_DISABLED_TOOLSETS=debugger,traces,git`. Predefinição `focused` com ~30 ferramentas (destinos, fonte, bloqueio, ativação, transportes básicos, sintaxe, testes unitários, ATC, pesquisa).
- Aplicar em `ListTools` e recusar em `CallTool` com `MethodNotFound` para ferramentas fora do conjunto ativo. Não copiar o roteador único `SAP()` do vsp: perderia as anotações por ferramenta que são o nosso diferencial.

**Riscos.** As instruções do servidor referem ferramentas por nome; gerar a cadeia de instruções a partir do conjunto ativo.

### 3. Publicação no npm, CI com teste de contrato e higiene do Docker

**O que os outros fazem.** mcp-sap-docs corre `test-pr.yml`, `release-please.yml` e publica imagem no GHCR; vibing-steampunk e aibap.mcp têm testes que falham quando o README diverge de `tools/list`; erpl-adt corre 355 testes com tráfego ADT gravado; ROSA e ui5-mcp-server instalam-se com `npx -y`. O portal skills.cloud.sap lista servidores MCP por um único comando.

**O que temos.** Verifiquei: `npm view abap-adt-mcp version` devolve 404; `server.json` aponta para `abap-adt-mcp@0.3.1` no npm; não existe `.github`; três ficheiros de teste (`ObjectSourceHandlers.test.ts`, `adtErrorFormatting.test.ts`, `responseSizing.test.ts`); `Dockerfile` usa `npm install`, `COPY . .`, corre como root, expõe 3000 enquanto o servidor liga em `127.0.0.1:MCP_HTTP_PORT`; não existe `.dockerignore` e `systems.json` real está na árvore.

**Proposta concreta.**
- `.github/workflows/ci.yml`: matriz Node 18/20/22, `npm ci`, `npm run build`, `npm test`.
- `src/__tests__/toolCatalog.test.ts`: instanciar o servidor sem SAP, chamar o handler de `ListToolsRequestSchema`, validar com `ListToolsResultSchema` do SDK, e afirmar: contagem igual ao instantâneo `docs/tools.snapshot.json`, toda a ferramenta com `readOnlyHint`/`destructiveHint`, todas as propriedades com `type` e `description`, parâmetros enumeráveis com `enum` (apanharia o bug de `validateNewObject` de IMPROVEMENTS #1 e o `options: string` do item 6). Gerar `docs/TOOLS.md` a partir do mesmo instantâneo.
- `.github/workflows/release.yml`: em `v*`, `npm publish --provenance`, `docker build` e push para GHCR, verificação de que `package.json` e `server.json` têm a mesma versão.
- `.dockerignore` com `systems.json`, `.env*`, `node_modules`, `dist`, `docs`, `.git`; `Dockerfile` com `npm ci`, `USER node`, `HEALTHCHECK`, `EXPOSE ${MCP_HTTP_PORT}` documentado; opção `MCP_HTTP_HOST=0.0.0.0` só quando definida explicitamente (mantém o portador).
- README: substituir `node PATH_TO/dist/index.js` por `npx -y abap-adt-mcp` e remover a resolução de problemas de `npx` (linha 238) até a publicação existir.

**Riscos.** Publicar exige decidir o nome final agora; o CHANGELOG já regista a renomeação, por isso o momento é bom.

### 4. Escrita com bloqueio automático e registo de bloqueios por destino

**O que os outros fazem.** vsp `withObjectLock` adquire, muta e liberta na mesma chamada e reporta falhas de desbloqueio em vez de as descartar; epod `sap_push_source` faz lock, write, unlock e activate numa chamada; aibap mantém um `LockMap` por sessão, faz `releaseAutoLock` quando a escrita falha, expõe `list_locks` e `force_unlock`; remote_fs `lockManager.ts` regista handles por caminho e, após re-login, faz `restore()`. As issues vsp #166/#169 e aibap #377 documentam ENQUEUEs órfãos, 423 por handle obsoleto, e escrita sem enqueue em ECC.

**O que temos.** `setObjectSource` e `editObjectSource` exigem `lockHandle` (`ObjectSourceHandlers.ts:67,97`); `lock`/`unLock` devolvem o handle ao modelo e nada no servidor o regista; `dropSession` "clear local session cache" (`AuthHandlers.ts:26`); o estado por destino em `src/index.ts` tem apenas `adtClient`, `cookieClient`, `handlers`, `loggedIn`. O ciclo documentado nas instruções é lock, set, unLock, activateByName, unitTestRun.

**Proposta concreta.**
- `src/lib/lockLedger.ts`: `Map<destination, Map<objectUrl, { lockHandle, accessMode, transport?, acquiredAt }>>`, atualizado pelos handlers `lock`/`unLock`/`deleteObject`.
- Tornar `lockHandle` opcional em `setObjectSource`, `editObjectSource`, `createTestInclude`, `atcApplyQuickfix`: sem handle, o handler bloqueia, escreve, desbloqueia (também em erro, e reporta a falha de desbloqueio) e, com `activate: true`, chama `activateByName` e devolve o resultado da ativação. Com handle explícito, comportamento atual mantém-se (o bloqueio entre chamadas é uma vantagem nossa sobre o vsp).
- Novas ferramentas `listLocks` (só leitura) e `forceUnlock` (destrutiva): libertar todos os handles do registo e, em último recurso, fazer `dropSession` para largar a sessão SAP.
- `logout`/`dropSession` libertam primeiro os bloqueios do registo.
- Mutex assíncrono por destino em torno das ferramentas com estado (ideia nova do agente 5): anfitriões como o Claude Code emitem chamadas em paralelo e um `getObjectSource` intercalado entre `lock` e `setObjectSource` na mesma sessão pode invalidar o handle.
- Este registo é pré-requisito do item 8 (re-login restaura ou invalida handles).

**Riscos.** Em ECC (< 7.50) handles obsoletos escrevem sem enqueue (aibap #377); quando o item 9 fornecer a versão do sistema, voltar a bloquear antes de cada escrita nessas versões.

### 5. Edição ancorada em texto e por método

**O que os outros fazem.** remote_fs `replace_string_in_abap_object` exige exatamente uma ocorrência e falha com "0 matches, read current content first" ou "N occurrences"; vsp `EditSource`, dassian `abap_edit_method` e abapilot `sap_patch_code` usam o mesmo contrato `old_string`/`new_string`; vsp `GetSource(method=...)` devolve só o bloco `METHOD...ENDMETHOD` e `WriteSource(method=...)` substitui-o; epod `sap_object_members` lista os membros de uma classe de 2 000 linhas em ~300 tokens e `sap_push_element` funde um membro no fonte completo.

**O que temos.** `editObjectSource` é só por intervalo de linhas com `expectedText` opcional; após uma edição anterior na mesma sessão os números de linha deslocam-se e o agente tem de reler. `classComponents` devolve metadados ADT sem intervalos de linha reutilizáveis.

**Proposta concreta.**
- Em `editObjectSource`, aceitar em alternativa `replacements: [{ oldText, newText }]`: reler o fonte (já acontece), normalizar CRLF, exigir correspondência única por `oldText` (senão devolver as linhas candidatas), aplicar todas atomicamente, escrever com o mesmo contrato de bloqueio/transporte. Reutiliza `src/lib/sourceCache.ts`.
- Novas ferramentas `getMethodSource(classUrl, methodName, include?)` e `setMethodSource(classUrl, methodName, source, activate?)`: localizar o bloco por varrimento `METHOD <nome>.`/`ENDMETHOD.` no include de implementações (com `classIncludes` para escolher o include), devolver o bloco com `startLine`/`endLine`, e para escrita delegar em `editObjectSource`. Um `listMembers(classUrl)` compacto (nome, tipo, visibilidade, linha) sobre `classComponents` fecha o caso epod.

**Riscos.** Métodos com o mesmo nome em classes locais (`CCIMP`, `CCAU`) exigem o parâmetro `include`; comentários que contenham `ENDMETHOD` exigem varrimento que ignore linhas iniciadas por `*` ou `"`.

### 6. Expor métodos existentes na biblioteca e corrigir esquemas

**O que os outros fazem.** fr0ster expõe `CreateDomain`/`UpdateDomain` com `fixed_values`, `CreateDataElement` com etiquetas, `GetEnhancements`; remote_fs expõe `abapfs_manage_text_elements` e usa `typeHierarchy` para navegação; ARC-1 e fr0ster permitem `version=active|inactive` em todas as leituras.

**O que temos.** Verifiquei em `node_modules/abap-adt-api/build/AdtClient.d.ts` (8.4.1, `package.json` pede `^8.4.1`, última publicada é 8.4.3) que `typeHierarchy`, `objectEnhancements`, `getTextElements`/`setTextElements`, `getDomainProperties`/`setDomainProperties`, `getDataElementProperties`/`setDataElementProperties`, `atcDocumentation`, `changePackagePreview`/`changePackageExecute`, `objectStructureElements` e `rapGenGetUiConfig` existem e nenhum é referenciado em `src/`. `ObjectSourceHandlers.ts:41` declara `options: { type: 'string' }` e passa-o diretamente a `adtclient.getObjectSource(url, args.options)`, que espera `ObjectSourceOptions`; logo `version: 'inactive'` é inalcançável e o passo "verificar antes de ativar" do nosso próprio fluxo lê a versão ativa obsoleta. `debuggerStep.steptype` não tem `enum`.

**Proposta concreta.**
- Substituir `options` por `version: { enum: ['active','inactive'] }` e remover `gitUser`/`gitPassword` do esquema (já vêm da configuração por destino). Um teste Jest com `getObjectSource` simulado.
- Novo `src/handlers/DdicHandlers.ts`: `getDomainProperties`, `setDomainProperties` (com `lockHandle`/`transport`, ou bloqueio automático do item 4), `getDataElementProperties`, `setDataElementProperties`.
- Em `ObjectHandlers.ts` ou novo `NavigationHandlers.ts`: `typeHierarchy(url, line, offset, superTypes)`, `objectEnhancements(sourceMainPath, includeSource)`, `objectStructureElements`, `atcDocumentation(docUri)`, `changePackagePreview`/`changePackageExecute`, `getTextElements`/`setTextElements`.
- Adicionar `enum` a `debuggerStep.steptype` (`stepInto`, `stepOver`, `stepReturn`, `stepContinue`, `stepRunToLine`, `stepJumpToLine`, `terminateDebuggee`, `detach`) e subir para 8.4.3.
- Atualizar `READ_ONLY_TOOLS`/`DESTRUCTIVE_TOOLS` e o instantâneo do item 3 (passa de 143 para ~155 ferramentas).

**Riscos.** Nenhum de arquitetura; é trabalho de invólucro. `setTextElements` só funciona em versões recentes (remote_fs recorre ao SAP GUI nas antigas): documentar.

### 7. Pesquisa de texto no código fonte

**O que os outros fazem.** chandrashekhar `search_abap_object_lines` faz `POST /sap/bc/adt/repository/informationsystem/textsearch` e devolve objeto, linha e excerto; fr0ster `SearchSource` (com máscaras de pacote, `exclude_comments`, `time_budget_ms`) nota que o endpoint indexado é só on-prem; vsp `GrepObjects`/`GrepPackages` corre uma expressão regular sobre fontes obtidos, com linhas de contexto, e documenta ~95% de poupança de tokens face a ler fontes inteiros.

**O que temos.** `searchObject(query, objType, max)` é pesquisa por nome; `usageReferences` precisa de URL e posição de um símbolo conhecido; `nodeContents` lista um nível de pacote. Não existe `textsearch` na biblioteca (`grep -rl textsearch node_modules/abap-adt-api/build` vazio). Localizar uma tabela num `SELECT` ou um id de mensagem custa um `getObjectSource` por candidato.

**Proposta concreta.**
- `sourceTextSearch(query, packages?, objectTypes?, maxResults)`: chamada crua via `adtclient.httpClient.request` (padrão já usado em `ServiceBindingHandlers.ts:162`) ao endpoint `textsearch`; devolver `[{ objectUrl, name, type, line, snippet }]` sob o orçamento de `shrinkToFit`.
- `grepPackage(package, pattern, recursive, contextLines, objectTypes, maxResults)`: caminho cliente para Cloud e para quando o endpoint devolve 404: percorrer `nodeContents` (recursivo, ver segunda linha item 18), obter fontes com concorrência limitada (4 em paralelo), aplicar a expressão regular, reutilizar `sourceCache`. A ferramenta reporta `truncated` e `objectsScanned`.
- Instruções do servidor: "comece por `grepPackage`/`sourceTextSearch` antes de ler fontes inteiros".

**Riscos.** Em pacotes grandes o `grepPackage` cliente é lento e consome quota do inquilino; limitar por `maxObjects` e respeitar a repetição com `Retry-After` do item 8.

### 8. Recuperação de sessão e erros acionáveis

**O que os outros fazem.** arc-1-lsp: "if it expires, transparently re-logs on and retries the call once", deteção de sessão morta por sondagem e keep-alive dependente de atividade; dassian `withSession()` faz re-login e repete; remote_fs `haveToRelogin()` em 4xx faz `dropall`, `login`, `restore()`. aibap `hintByKind` mapeia 412, 423, 409 (nomeando o transporte bloqueador), 405 em ECC e 500 para sugestões "Hint:"; dassian classifica `isSessionTimeout`, `isLocked` (SM12), `isAmbiguous400` ("do NOT loop on reconnecting"); ARC-1 referencia SM12/SU53/SE09.

**O que temos.** `ensureLogin` (`src/index.ts:317-325`) só corre para `authType === 'sso'` e só verifica `dest.loggedIn`; uma sessão IAS expirada surge como erro opaco a meio do fluxo, frequentemente com um objeto bloqueado; `docs/AUTH.md` diz "run login again". `cookieHttpClient.ts` não tem repetição nem trata 429/503. `src/lib/adtErrorFormatting.ts` expõe a exceção SAP com redação de segredos, mas não a classifica.

**Proposta concreta.**
- No despachante: capturar o erro de `handle()`, e se `classifyAdtError()` devolver `sessionExpired` (401, redireção SAML/IAS, `SAP_SESSIONID` rejeitado) fazer `ensureLogin(destination, true)` (para OAuth, renovar o token em `src/lib/oauth.ts`; para basic, `adtClient.login()`), invalidar ou restaurar os handles do registo do item 4, e repetir uma única vez.
- `src/lib/adtErrorHints.ts`: tabela `kind -> hint` acrescentada ao JSON de erro como `hint` e `nextTools`: `locked` (SM12, "chame unLock ou listLocks; se o bloqueio for de outro utilizador, não repita setObjectSource"), `staleLockHandle` (412/423, "chame lock de novo"), `transportRequired` ("chame transportInfo ou createTransport"), `ctsLock` (409, nome do transporte), `authorization` (SU53), `notFound`, `platformUnavailable` (ver item 9), `ambiguous400` ("não repita o login").
- Em `cookieHttpClient.ts`: repetição única com `Retry-After` em 429/503.

**Riscos.** Repetir chamadas destrutivas após re-login só quando a primeira tentativa falhou antes de chegar ao SAP (erro de autenticação), nunca em 5xx de escrita.

### 9. Prontidão Cloud: `systemProfile` e `apiReleaseState`

**O que os outros fazem.** vsp devolve build, autenticação, SID e release numa chamada vazia e `GetFeatures` sonda a matriz de funcionalidades; chandrashekhar `get_sap_system_info` combina `/sap/bc/adt/core/discovery` e `/sap/bc/adt/system/info`; fr0ster declara `available_in` por ferramenta e powerup responde "not supported on this SAP system" em vez de 404; remote_fs devolve cliente, release e S/4HANA vs ECC com cache de 24 h. workskong e buettnerjulian resolvem a URI por `quickSearch` e fazem `GET /sap/bc/adt/apireleases/{uri}`; ROSA devolve estado (`released`, `deprecated`, `classicAPI`, `noAPI`), nível Clean Core A-D e sucessor; claude-abap-skills impõe "verify release state, never recall it"; secondsky mostra a consulta a `I_APIsForCloudDevelopment` e `I_APIsWithCloudDevSuccessor`.

**O que temos.** `healthcheck`/`listSystems` só ecoam a configuração; `adtCoreDiscovery`/`adtDiscovery` devolvem XML cru; `docs/TESTPLAN.md` regista `rapGenIsAvailable=false` e 8 ferramentas a falhar no inquilino por endpoints ausentes. Nenhuma ferramenta toca em `apireleases` e a biblioteca não o embrulha; um agente só descobre que `CL_X` não está liberado depois de escrever e ver o erro de sintaxe.

**Proposta concreta.**
- `systemProfile(destination)`: uma vez por destino (cache no estado do destino), combinar `adtDiscovery` (presença das coleções: debugger, traces, abapgit, atc, rapgen, textsearch, apireleases), `/sap/bc/adt/system/info` quando existir, e uma consulta leve à release; devolver `{ sid, release, platform: 'cloud'|'onprem', abapLanguageVersion, availableToolsets, unavailableTools }`. `listSystems` inclui `platform` e `policy` (item 1).
- Despachante: se a ferramenta pertence a uma coleção ausente no perfil, devolver `isError` uniforme "ferramenta X não disponível no destino Y (S/4HANA Cloud: endpoint ausente)" antes de tocar no SAP; `tools/list` continua estático (compatível com a cache de prompts prevista na revisão 2026-07-28 da especificação).
- `apiReleaseState(names[] | objectUrl, destination)`: tentar `GET /sap/bc/adt/apireleases/{uri}` (on-prem e Cloud recentes), senão `runQuery` sobre `I_APIsForCloudDevelopment`/`I_APIsWithCloudDevSuccessor`, com recurso opcional ao JSON do Cloudification Repository (`SAP/abap-atc-cr-cv-s4hc`) descarregado em cache; devolver estado, nível e sucessor por objeto.
- Seguimento (ideia nova do agente 4): `cloudReadinessCheck(source|objectUrl)` extrai objetos SAP referenciados no fonte e chama `apiReleaseState` em lote antes de `lock`/`setObjectSource`.

**Riscos.** O endpoint `apireleases` não está documentado; validar no inquilino DEV (TESTPLAN camada 3) antes de prometer; `/sap/bc/adt/system/info` pode não existir em todas as releases, por isso o perfil deve ser tolerante a 404.

### 10. Pacote de competências, chave do servidor e aliases SAP

**O que os outros fazem.** ARC-1 envia 23 competências em `skills/<nome>/SKILL.md` e um Agent Plugin instalável com uma linha; sapcli-claude-plugin e superclaude-for-sap instalam-se via `/plugin marketplace add`; o portal skills.cloud.sap regista qualquer repositório público com `skills/<slug>/SKILL.md`, instalável em 75 anfitriões com `npx skills add <owner>/<repo>`; claude-abap-skills encaminha cada capacidade "por presença de ferramenta" para os nomes exatos do servidor oficial SAP (`abap_atc_run`, `abap_activate_objects`, `abap_generators-*`) sob a chave `abap-adt`.

**O que temos.** Verifiquei: não existe `skills/` nem `.claude-plugin/`; `README.md:43` e `:69` registam o servidor com a chave `abap-adt`, a mesma que claude-abap-skills reserva ao servidor SAP, pelo que essas competências chamariam `mcp__abap-adt__abap_atc_run` no nosso processo e concluiriam que o ATC não existe. `docs/agents.template.md` é texto para colar, não algo instalável.

**Proposta concreta.**
- Renomear a chave documentada para `abap-adt-mcp` no README, `server.json` e `docs/agents.template.md`.
- Criar `skills/abap-adt-mcp/SKILL.md` (fluxos de criação/edição com `destination`, regras `$TMP` vs transporte, ATC com `ABAP_CLOUD_DEVELOPMENT_DEFAULT`, ciclo `atcQuickfixProposals`/`atcApplyQuickfix`, RAP `rapGenValidateContent`/`rapGenPreview`/`rapGenGenerate`), `skills/abap-adt-mcp-setup/SKILL.md` (escrever a configuração do anfitrião, verificar `listSystems`/`healthcheck`), e `docs/ROUTING.md` com a tabela de correspondência (SAPRead -> `getObjectSource`, SAPDiagnose action=syntax -> `syntaxCheckCode`, `abap_transport-unifiedDifference` -> `transportUnifiedDiff`, `ActivatePackage` -> `activateObjects`). Registar no SAP/ai-skills-library e abrir PR a claude-abap-skills com uma coluna `abap-adt-mcp`.
- `.claude-plugin/plugin.json` com `mcpServers` a apontar para `npx -y abap-adt-mcp` (depende do item 3). Não incluir hooks `PreToolUse`: a proteção pertence ao servidor (item 1).
- Opcional, `MCP_TOOLSETS=sap-compat`: aliases finos com os nomes oficiais SAP (`abap_activate_objects` -> `activateByName`, `abap_run_unit_tests` -> `unitTestRun`, `abap_transport-create` -> `createTransport`, `abap_generators-generate_objects` -> `rapGenGenerate`, `abap_lists_destinations` -> `listSystems`), claramente descritos como aliases.

**Riscos.** Aliases duplicam entradas em `tools/list`; manter fora da predefinição. As competências devem referir os nomes reais das nossas ferramentas e ser regeneradas quando o instantâneo do item 3 mudar.

## Segunda linha (itens 11 a 25)

| # | Melhoria | Categoria | O que falta / proposta | Esforço | Impacto | Votos média/n |
|---|---|---|---|---|---|---|
| 11 | Detalhe de dump (`dumpDetails(id)` via `/sap/bc/adt/runtime/dump/{id}/formatted`) e filtros `from`/`to`/`user` em `dumps` | tooling | `FeedHandlers.ts` só lista o feed; é o caminho de análise de causa raiz no Cloud, onde o depurador não existe | pequeno | alto | 4,0/10 |
| 12 | Execução de excerto ABAP (`runSnippet`: classe temporária `IF_OO_ADT_CLASSRUN` em `$TMP`, deteção `main` vs `run`, limpeza) | tooling | `runClass` só executa classes existentes; hoje são seis chamadas com lixo em caso de falha; respeitar `allowedPackages` | médio | alto | 4,0/10 |
| 13 | `resolveTransport` determinístico (transporte bloqueador > candidato modificável > nenhum para pacote local > criar se pedido) e pré-verificação de escrita | agent-ergonomics | `transportInfo` devolve LOCKS/TRANSPORTS/DLVUNIT que o agente tem de interpretar; ponto de paragem mais comum nos fluxos de escrita | pequeno | alto | 3,6/10 |
| 14 | Diferença entre revisões (`objectDiff(objectUrl, fromRevision, toRevision)`) | tooling | `revisions` só lista; `TransportHandlers.ts:470-509` já obtém URIs de revisão e embute o motor `diff` | pequeno | médio | 3,5/10 |
| 15 | Endurecimento do transporte HTTP: transportes por sessão com TTL, validação de `Origin`/`Host`, `GET /health` sem token | architecture, auth/security | `src/index.ts:513` cria um único `StreamableHTTPServerTransport`, pelo que um segundo `initialize` falha até reiniciar; sem verificação de `Origin` | médio | médio | 3,5/10 |
| 16 | Indireção de segredos `${env:VAR}` em `systems.json`, validação ansiosa e recusa de ficheiro legível por todos | auth/security | IMPROVEMENTS #12 menciona a indireção mas `src/lib/systems.ts` não a implementa; README mostra senha inline | pequeno | médio | 3,7/10 |
| 17 | `activatePackage`/ativação com dependentes, devolvendo o conjunto ainda inativo | tooling | `inactiveObjects` + `activateObjects` existem mas exigem filtragem manual; pilhas RAP só ativam em conjunto | pequeno | médio | 3,2/10 |
| 18 | Composições por nome: `packageTree` recursivo, `whereUsed(name, type)`, `cdsViewInfo(name)` | agent-ergonomics | `nodeContents` é um nível; `usageReferences` exige URL; `ddicElement` exige caminho DDIC | pequeno | médio | 3,0/10 |
| 19 | Registo de auditoria JSONL por chamada (ferramenta, destino, argumentos redigidos, duração, resultado, `requestId`), via `MCP_AUDIT_FILE` | auth/security | O despachante não regista invocações; `redactSecrets` já existe; dá sentido às negações do item 1 | pequeno | médio | 3,2/10 |
| 20 | Certificado X.509 de cliente e ficheiro CA por destino | auth/security | `AuthType` é `sso|basic|oauth`, só existe `insecureTls`; `createSSLConfig(ca)` e `httpsAgent` já existem em `cookieHttpClient.ts:26,51` | pequeno | médio | 3,1/10 |
| 21 | Prompts MCP para os fluxos canónicos (create-object, safe-edit, review-transport, fix-atc, clean-core-check) | agent-ergonomics | `capabilities: { tools: {} }` em `src/index.ts:217`; o texto já existe nas instruções; complemento das competências do item 10 | pequeno | médio | 3,1/10 |
| 22 | `title` nas ferramentas, `examples` nos parâmetros em forma de URL, `outputSchema`/`structuredContent` nas 15 ferramentas encadeadas | agent-ergonomics | `ToolAnnotations.title` nunca é preenchido; confusão `objectUrl` vs `objectSourceUrl` é o erro mais comum no TESTPLAN; cuidado com as variantes paginadas na validação do SDK 1.29 | pequeno + médio | médio | 3,2/10 e 2,9/10 |
| 23 | Notificações de progresso em `createAtcRun`, `unitTestRun`, `gitPullRepo`, `rapGenGenerate` e na espera do SSO de navegador | performance/response-size | Nenhum tratamento de `progressToken`; o login puppeteer bloqueia em silêncio e os anfitriões expiram | médio | médio | 2,8/10 |
| 24 | Resumo ATC por prioridade/verificação, documentar que `mainUrl` aceita URIs de pacote e transporte, listar resultados ATC históricos (`/sap/bc/adt/atc/results`) | tooling | Reduzido: o âmbito por pacote já funciona pela biblioteca; faltam o resumo e a leitura de execuções centrais | pequeno | médio | 3,0/10 |
| 25 | Exportação de fontes de pacote para ficheiros locais em disposição abapGit (só leitura, sem endpoint auxiliar) e composição `debugSession` com ids derivados | tooling | Alimenta pipelines tipo abap_wiki e o `Grep` local do Claude Code; o depurador com 13 ferramentas e cinco ids inventados é inutilizável por agentes, mas só existe on-prem | médio | médio | 3,0/10 e 3,0/10 |

## Ideias rejeitadas e porquê

| Ideia | Proposto por | Motivo | Quem contestou |
|---|---|---|---|
| Cache de fonte com ETag e revalidação condicional | ARC-1 (agente 1) | `abap-adt-api.getObjectSource` devolve texto sem expor o ETag; um 304 continua a colocar o corpo no contexto do modelo; `editObjectSource` relê de propósito como garantia de concorrência; a variante SQLite contraria a ausência de módulos nativos. Média 2,0 | Agentes 2, 3, 4, 5, 6, 7, 8, 10; o próprio agente 1 cedeu |
| Verificação JWT OIDC/XSUAA com perfis de chave API na HTTP | ARC-1 (agente 1), ROSA (agente 9) | Sem identidade SAP por utilizador cada chamador continua a ser o utilizador técnico; `@arc-mcp/xsuaa-auth` exige Node 22 e Express 5 contra o nosso Node 18; a HTTP é deliberadamente só loopback. Documentar a limitação. Média 1,9 | Agentes 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| Propagação de identidade por utilizador (token exchange, X.509 efémero) | ARC-1 (agente 1), AWS (agente 6) | Exige BTP Destination Service ou uma CA com CERTRULE, contra a vantagem "zero footprint BTP" que todos os relatórios nos atribuem; seria um produto diferente. Média 2,0 | Agentes 4, 7, 9, 10; o agente 6 cedeu |
| Recursos MCP e modelos de URI `abap://` | AWS (agente 6), spec (agente 10) | O próprio mcp-sap-docs desativou recursos por partirem o Cursor; anfitriões não os anexam automaticamente; contornam `ensureLogin` e as anotações; `getObjectSource` já serve o mesmo conteúdo paginado. Média 2,0 | Agentes 1, 2, 3, 5, 7, 9; agentes 6 e 10 cederam |
| Elicitação para confirmações destrutivas e login SSO em modo URL | Hochfrequenz (agente 5), spec (agente 10) | A revisão 2026-07-28 substitui a elicitação iniciada pelo servidor; o suporte nos anfitriões é irregular; a política do item 1 dá um piso independente do anfitrião. O modo URL para SSO é uma afirmação errada: os cookies IAS ficariam no navegador do utilizador, sem chegar ao servidor. Média 2,2 | Agentes 2, 3 (afirmação errada), 6, 8, 9; agentes 5 e 10 cederam |
| Padrão de tarefas assíncronas / MCP Tasks | abap-ai/mcp (agente 6) | O SDK 1.29 não implementa Tasks; `createAtcRun` já sonda internamente; TESTPLAN não regista tempos limite; notificações de progresso resolvem o sintoma. Média 1,7 | Agentes 1, 2, 4, 7, 8, 9, 10; o agente 6 cedeu |
| Prólogo de contratos de dependências (compressão de contexto) | vibing-steampunk (agente 2) | Exige um analisador de dependências ABAP em cinco camadas; `classComponents` já devolve assinaturas públicas a pedido; a leitura por método dá mais com menos código. Média 2,1 | Agentes 1, 3, 4, 6, 8; o agente 2 cedeu |
| Conjunto de ferramentas gCTS | sapcli (agente 8) | Sem suporte na biblioteca, dez ou mais endpoints crus sob `/sap/bc/cts_abapvcs`, inexistente no S/4HANA Public Cloud (alvo de teste), abapGit já cobre o ciclo Git testado. Média 2,4 | Agentes 2, 3, 6, 9, 10; o agente 8 baixou para 3 |
| Modo CLI (`abap-adt-mcp call <tool> --json`) com códigos de saída | erpl-adt (agente 7) | Segunda porta de entrada a manter e a testar; sapcli já ocupa o nicho; o anfitrião MCP e o transporte HTTP já permitem automatização. Média 2,0 | Agentes 1, 3, 6, 10; o agente 7 cedeu |
| Geração de especificação técnica WRICEF a partir de transportes | ABAPDocMCP (agente 7) | Extração por expressões regulares e modelo de 32 secções; o modelo escreve melhor a partir de `transportDetails`, `transportUnifiedDiff` e `getObjectSource`; falha o teste de âmbito. Média 1,4 | Agentes 1, 2, 3, 4, 5, 6, 8, 9, 10; o agente 7 cedeu |
| Pesquisa por termos de negócio com dicionário de abreviaturas | ROSA (agente 9) | O `quickSearch` ADT é por padrão de nome; o dicionário pertence a um servidor de documentação; a consulta de estado de liberação responde à pergunta real. Média 1,0 | Agentes 1, 2, 3, 6, 10; o agente 9 retirou |
| Feeds SM02 e registo de erros do Gateway (`/IWFND/ERROR_LOG`) | fr0ster/powerup (agente 3) | Feeds de operações Basis e OData, fora do âmbito; a parte útil (detalhe de dump) sobrevive no item 11. Média 1,8 | Agentes 1, 4, 7, 8, 10; o agente 3 reduziu |
| Exportação de customizing para SQLite e ZIP abapGit via endpoint auxiliar `Z_ABABGIT_ADT_EXPORT` | Hochfrequenz (agente 5) | Extração em massa de dados de negócio com aviso de política de API SAP; o endpoint exige objetos Z no sistema, impossível no Public Cloud. Só a exportação cliente de fontes sobrevive (item 25). | Agentes 1, 2, 3, 4, 7, 9, 10; o agente 5 cedeu |
| Saída para ficheiro em `runQuery`/`tableContents` (extratos TADIR) | ROSA (agente 9) | Só funciona quando anfitrião e servidor partilham disco; TADIR não é uma vista liberada no Cloud; roça a política de API SAP. Média 2,0 | Agentes 5, 8; o agente 9 baixou |
| Execução com perfil e resumo de traces (`profileRun`) | fr0ster (agente 3) | Os nove primitivos de traces existem; sem dados de trace no inquilino Cloud (TESTPLAN); triagem de desempenho é tarefa secundária. Média 2,0 | Agente 3 cedeu; ninguém subiu |
| Scaffold `init`/`detect` e guias por anfitrião | vibing-steampunk (agente 2), SAP (agente 4) | Varredura de portas e importação do SAP Logon são conveniências on-prem sem retorno ABAP; `healthcheck` já valida alcance; os guias só fazem sentido depois do `npx` existir (item 3). Média 2,1 | Agentes 1, 3, 7, 9; agentes 2 e 4 cederam |
| Composição `checkObject` (sintaxe + ATC + unitário num só resultado) | SAP/epod (agente 4) | Três formatos de resultado num só corpo luta contra o orçamento de 40 mil caracteres e esconde qual passo falhou; o ciclo já se encadeia e uma competência codifica-o. Média 2,6 | Agentes 5, 9; o agente 4 cedeu |
| Registo de ferramentas dependente da plataforma (ocultar em `tools/list`) | fr0ster (agente 3) | Assume um sistema por processo; o nosso catálogo é global e o destino é por chamada; sobrevive como erro normalizado e `systemProfile` (item 9). | Agentes 2, 7, 9 |
| Semáforo de concorrência e limite por chamador (ARC-1 em três camadas) | ARC-1 (agente 1) | Nenhum 429/503 registado no TESTPLAN ao vivo; reduzido a uma repetição única com `Retry-After` dentro do item 8. Média 2,7 | Agentes 2, 3, 6; o agente 1 cedeu |

## Onde já estamos à frente

- **Multidestino num só processo com `destination` em todas as ferramentas.** ARC-1 só tem multialvo experimental e só de leitura, mcp-hub precisa de uma instância por sistema, fr0ster/powerup trocam de perfil por `ReloadProfile`, vsp e sapcli ligam um processo a um sistema, chandrashekhar documenta uma porta por sistema. Fontes: https://docs.arc-1-mcp.com/ (multi-target-setup), https://github.com/arc-mcp/mcp-hub, https://github.com/fr0ster/mcp-abap-adt, https://github.com/jfilak/sapcli-claude-plugin.
- **Autenticação para S/4HANA Public Cloud sem BTP.** SSO de navegador contra IAS com perfil persistente em modo 0700 e fixação de cliente, mais OAuth2 client credentials, verificados ao vivo em `docs/TESTPLAN.md` camada 3. arc-1-lsp diz que o seu `sso` é "local desktop only", AWS "supports only basic authentication" fora do caminho ECS, rap-skills guarda `SAP_PASSWORD` em texto simples, mcp-sap-notes usa `.pfx` e cookies em ficheiro. Fontes: https://github.com/arc-mcp/arc-1-lsp, https://github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer, https://github.com/weiserman/rap-skills.
- **Zero instalação no lado ABAP.** vsp precisa do handler `ZADT_VSP` para AMDP, RFC e relatórios; powerup precisa de `ZMCP_ADT_SRV` ou de um handler `zrfc`; aibap precisa de `Z_ABABGIT_ADT_EXPORT`; abapilot e fgalastri/MCP_ABAP importam transportes inteiros. Nada disso é possível no Public Cloud. Fontes: https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_amdp.go, https://github.com/babamba2/abap-mcp-adt-powerup, https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/export.go.
- **Amplitude da superfície ADT.** 143 ferramentas com depurador (13), traces (9), refactoring rename e extract-method, geradores RAP com validar/pré-visualizar, quickfixes ATC determinísticos, `transportUnifiedDiff`, abapGit com stage/push/branch. O servidor oficial SAP tem ~15 ferramentas sem leitura de fonte, ATC ou where-used; ARC-1 documenta "no debugger"; remote_fs não expõe depurador nem `findDefinition` via MCP; dassian ainda lista testes unitários e quickfixes como plano. Fontes: https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/enabling-adt-mcp-server, https://github.com/arc-mcp/arc-1, https://marcellourbani.github.io/vscode_abap_remote_fs/ai/subagents/, https://github.com/DassianInc/dassian-adt.
- **Anotações de risco em todas as ferramentas e instruções de servidor.** vsp `server.go`, epod (protocolo 2024-11-05), mcp-sap-docs e abapilot não publicam anotações; superclaude classifica por prefixo de nome e admite que não consegue classificar `RuntimeCallDispatch`. Fontes: https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/server.go, https://git.epod.dev/erhan/epod-adt-mcp-updatesite, https://github.com/babamba2/superclaude-for-sap/blob/main/hooks/hooks.json.
- **Disciplina de tamanho de resposta que preserva dados.** Orçamento de 40 mil caracteres com `hasMore`/`startLine`/`startIndex` em fontes, tabelas, referências, testes, ATC e dumps, e `editObjectSource` com `expectedText`. AWS trunca fontes acima de 80 mil caracteres cortando o fim; mcp-sap-docs corta o meio de documentos sem forma de paginar; aibap não tem limite de linhas. Fontes: https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer/main/src/aws_abap_accelerator/utils/response_optimizer.py, https://github.com/marianfoo/mcp-sap-docs/blob/main/src/lib/truncate.ts.
- **Bloqueios que sobrevivem entre chamadas.** Um `ADTClient` com estado por destino permite `lock`, `setObjectSource`, `unLock` como chamadas separadas; as issues #166/#169 do vsp mostram o custo do desenho sem estado. O item 4 mantém esta vantagem e acrescenta o registo que lhe falta. Fonte: https://github.com/oisee/vibing-steampunk/issues/169.
- **Transporte HTTP seguro por omissão.** Ligação só em loopback, portador gerado em ficheiro 0600, comparação em tempo constante e redação de segredos nos erros; erpl-adt arranca sem autenticação, workskong aceita senhas SAP em cabeçalhos por pedido sem autenticação de transporte, mcp-sap-docs usa `cors '*'`. Fontes: https://github.com/DataZooDE/erpl-adt, https://github.com/workskong/mcp-abap-adt, https://github.com/marianfoo/mcp-sap-docs/blob/main/src/streamable-http-server.ts.

## Fontes consultadas

**ARC-1 e família (BTP, seguro por omissão)**
- https://github.com/arc-mcp/arc-1
- https://github.com/arc-mcp/arc-1-lsp
- https://raw.githubusercontent.com/arc-mcp/arc-1-lsp/main/docs/adt-ls-reference.md
- https://github.com/arc-mcp/arc1-adt-abap-mcp-ext
- https://github.com/arc-mcp/adt-ls
- https://github.com/arc-mcp/xsuaa-auth
- https://github.com/arc-mcp/mcp-hub
- https://docs.arc-1-mcp.com/ (authorization, enterprise-auth, security-guide, caching, tools, skills, agent-plugin, mcp-usage)
- https://raw.githubusercontent.com/arc-mcp/arc-1/main/docs/caching.md

**oisee/vibing-steampunk**
- https://github.com/oisee/vibing-steampunk
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/README_TOOLS.md
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_source.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_universal.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/lock_scope.go
- https://github.com/oisee/vibing-steampunk/issues/169
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/docs/cli-agents/codex.md
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/docs/cli-agents/README.md
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/server.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/sweep.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/docs_parity_test.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_dumps.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_system.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_cds.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_context.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/internal/mcp/handlers_amdp.go
- https://raw.githubusercontent.com/oisee/vibing-steampunk/main/CHANGELOG.md
- https://api.github.com/repos/oisee/vibing-steampunk/releases?per_page=3
- https://registry.npmjs.org/abap-adt-mcp

**fr0ster, powerup, superclaude-for-sap**
- https://github.com/fr0ster/mcp-abap-adt
- https://github.com/fr0ster/mcp-abap-adt/blob/main/docs/user-guide/HANDLERS_MANAGEMENT.md
- https://github.com/fr0ster/mcp-abap-adt/blob/main/docs/user-guide/AVAILABLE_TOOLS_COMPACT.md
- https://github.com/fr0ster/mcp-abap-adt/blob/main/docs/user-guide/AVAILABLE_TOOLS_HIGH.md
- https://github.com/fr0ster/mcp-abap-adt/blob/main/docs/user-guide/AVAILABLE_TOOLS_READONLY.md
- https://github.com/fr0ster/mcp-abap-adt/blob/main/docs/user-guide/CLI_OPTIONS.md
- https://github.com/fr0ster/mcp-abap-adt/blob/main/CHANGELOG.md
- https://github.com/babamba2/abap-mcp-adt-powerup
- https://github.com/babamba2/abap-mcp-adt-powerup/blob/main/docs/architecture/STATEFUL_SESSION_GUIDE.md
- https://github.com/babamba2/superclaude-for-sap
- https://github.com/babamba2/superclaude-for-sap/blob/main/hooks/hooks.json
- https://github.com/babamba2/superclaude-for-sap/blob/main/skills/create-program/SKILL.md
- https://github.com/babamba2/superclaude-for-sap/blob/main/.claude-plugin/plugin.json

**Servidor oficial SAP, epod, portal de competências SAP**
- https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/enabling-adt-mcp-server?locale=en-US
- https://git.epod.dev/erhan/epod-adt-mcp-updatesite
- https://skills.cloud.sap/
- https://github.com/SAP/ai-skills-library

**Hochfrequenz/aibap.mcp, dassian-adt, sap-mcp-config**
- https://github.com/Hochfrequenz/aibap.mcp
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/lock.go
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/shortdump.go
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/errors.go
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/readme_test.go
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/export.go
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/tools/messageclass.go
- https://raw.githubusercontent.com/Hochfrequenz/aibap.mcp/main/README.md
- https://github.com/Hochfrequenz/aibap.mcp/issues/377
- https://github.com/Hochfrequenz/aibap.mcp/issues/435
- https://github.com/DassianInc/dassian-adt
- https://raw.githubusercontent.com/DassianInc/dassian-adt/main/src/handlers/RunHandlers.ts
- https://raw.githubusercontent.com/DassianInc/dassian-adt/main/src/handlers/TransportHandlers.ts
- https://raw.githubusercontent.com/DassianInc/dassian-adt/main/src/handlers/BaseHandler.ts
- https://github.com/Hochfrequenz/sap-mcp-config
- https://raw.githubusercontent.com/Hochfrequenz/sap-mcp-config/main/README.md

**AWS Amazon Q accelerator, abap-ai/mcp, abapilot**
- https://github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer
- https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer/main/src/aws_abap_accelerator/sap/class_handler.py
- https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer/main/src/aws_abap_accelerator/src/aws_abap_accelerator/enterprise_main_tools.py
- https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer/main/src/aws_abap_accelerator/auth/principal_propagation.py
- https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer/main/src/aws_abap_accelerator/enterprise/usage_tracker.py
- https://github.com/abap-ai/mcp
- https://raw.githubusercontent.com/abap-ai/mcp/main/docs/Resources.md
- https://raw.githubusercontent.com/abap-ai/mcp/main/docs/Prompts.md
- https://raw.githubusercontent.com/abap-ai/mcp/main/docs/Tools.md
- https://raw.githubusercontent.com/abap-ai/mcp/main/docs/Tasks.md
- https://raw.githubusercontent.com/abap-ai/mcp/main/docs/Overview.md
- https://raw.githubusercontent.com/abap-ai/mcp/main/.github/workflows/downport.yml
- https://github.com/NicoHern/abapilot-mcp
- https://raw.githubusercontent.com/NicoHern/abapilot-mcp/main/connector/index.js
- https://crimsonconsultingsl.com/abapilot-vs-sap-abap-mcp-server/

**Outros servidores comunitários**
- https://github.com/mario-andreschak/mcp-abap-adt
- https://github.com/DataZooDE/erpl-adt
- https://github.com/DataZooDE/erpl-adt/blob/main/src/mcp/mcp_tool_handlers.cpp
- https://github.com/DataZooDE/erpl-adt/blob/main/src/mcp/tool_output_schemas.cpp
- https://github.com/DataZooDE/erpl-adt/blob/main/docs/cli-usage.md
- https://github.com/DataZooDE/erpl-adt/blob/main/docs/architecture.md
- https://github.com/workskong/mcp-abap-adt
- https://github.com/workskong/mcp-abap-adt/blob/main/src/handlers/handle_API_Releases.ts
- https://github.com/workskong/mcp-abap-adt/blob/main/src/handlers/handle_ATC_Result.ts
- https://github.com/workskong/mcp-abap-adt/blob/main/src/handlers/handle_RuntimeDumpDetails.ts
- https://github.com/buettnerjulian/abap-adt-mcp
- https://github.com/buettnerjulian/abap-adt-mcp/blob/main/src/handlers/handleWhereUsed.ts
- https://github.com/chandrashekhar-mahajan/abap-mcp-server
- https://github.com/chandrashekhar-mahajan/abap-mcp-server/blob/master/src/tools/search.ts
- https://github.com/chandrashekhar-mahajan/abap-mcp-server/blob/master/src/tools/analysis.ts
- https://github.com/fgalastri/MCP_ABAP
- https://github.com/SaurabhVC/ABAPDocMCP
- https://github.com/SaurabhVC/ABAPDocMCP/blob/main/pkg/adt/safety.go
- https://github.com/SaurabhVC/ABAPDocMCP/blob/main/internal/techspec/generator.go

**sapcli, vscode_abap_remote_fs, abap-adt-api**
- https://github.com/marcellourbani/abap-adt-api
- https://raw.githubusercontent.com/marcellourbani/abap-adt-api/master/src/AdtClient.ts
- https://github.com/marcellourbani/abap-adt-api/commits/master
- https://github.com/marcellourbani/vscode_abap_remote_fs
- https://raw.githubusercontent.com/marcellourbani/vscode_abap_remote_fs/master/client/src/adt/AdtTransports.ts
- https://raw.githubusercontent.com/marcellourbani/vscode_abap_remote_fs/master/client/src/adt/operations/AdtObjectActivator.ts
- https://raw.githubusercontent.com/marcellourbani/vscode_abap_remote_fs/master/modules/abapfs/src/lockManager.ts
- https://raw.githubusercontent.com/marcellourbani/vscode_abap_remote_fs/master/client/src/services/lm-tools/mcpReplaceStringTool.ts
- https://marcellourbani.github.io/vscode_abap_remote_fs/ai/subagents/
- https://marcellourbani.github.io/vscode_abap_remote_fs/ai/language-model-tools/
- https://github.com/jfilak/sapcli
- https://github.com/jfilak/sapcli/blob/master/doc/commands/gcts.md
- https://github.com/jfilak/sapcli/blob/master/doc/commands/abap.md
- https://github.com/jfilak/sapcli/blob/master/doc/configuration.md
- https://raw.githubusercontent.com/jfilak/sapcli/master/sap/cli/checkin.py
- https://github.com/jfilak/sapcli-claude-plugin

**Camada de conhecimento ABAP Cloud / Clean Core**
- https://github.com/ClementRingot/ROSA
- https://github.com/ClementRingot/ROSA/blob/main/src/tools/register-tools.ts
- https://github.com/ClementRingot/ROSA/blob/main/docs/ARCHITECTURE.md
- https://github.com/matt1as/claude-abap-skills
- https://github.com/matt1as/claude-abap-skills/blob/main/abap-cloud-rap/CLAUDE.md
- https://github.com/matt1as/claude-abap-skills/blob/main/abap-cloud-rap/atc-remediation/SKILL.md
- https://github.com/matt1as/claude-abap-skills/blob/main/abap-cloud-rap/rap-bo-design/SKILL.md
- https://github.com/weiserman/rap-skills
- https://github.com/weiserman/rap-skills/blob/main/rap-troubleshoot/SKILL.md
- https://github.com/Gixsy95/abap_wiki
- https://github.com/Gixsy95/abap_wiki/blob/main/core/docs/14-abap-fs-integration.md
- https://github.com/secondsky/sap-skills

**Servidores de documentação SAP e especificação MCP**
- https://github.com/marianfoo/mcp-sap-docs
- https://github.com/marianfoo/mcp-sap-docs/blob/main/src/lib/BaseServerHandler.ts
- https://github.com/marianfoo/mcp-sap-docs/blob/main/src/streamable-http-server.ts
- https://github.com/marianfoo/mcp-sap-docs/blob/main/docs/LLM-FRIENDLY-IMPROVEMENTS.md
- https://github.com/marianfoo/mcp-sap-docs/tree/main/.github/workflows
- https://github.com/marianfoo/mcp-sap-docs/blob/main/test/prompts.test.ts
- https://github.com/marianfoo/abap-mcp-server
- https://github.com/marianfoo/mcp-sap-notes
- https://modelcontextprotocol.io/specification/2025-06-18
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
- https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress
- https://modelcontextprotocol.io/docs/concepts/resources
- https://modelcontextprotocol.io/docs/concepts/prompts
- https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2025-11-25/changelog.mdx
- https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/changelog.mdx