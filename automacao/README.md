# Automação local da enquete G-Click

Programa de linha de comando para a conta `empId=6581`. Roda em Node.js e Google Chrome locais, sem Codex, ChatGPT ou API de IA. A sessão do navegador fica no próprio computador em `~/.local/share/gclick-enquete/browser-profile` e a senha é digitada somente na página de login.

## Escopo e regra atual

A regra padrão em `regras.json` associa somente `DAS - Mensal` e `DAS - Mensal - Sem Movimento` à pergunta `01.02`, resposta `01.02.04 — 04 - Simples` (`value=9`). `DAS - Mensal - CDB` fica excluída. A comparação é pelo nome **exato** da Obrigação / Tarefa; o nome da empresa não participa do filtro.

Cada execução exige uma lista explícita de CNPJs. Antes de qualquer gravação, o programa valida CNPJ, EmpID, tarefa, linha única no G-Click, resposta atual e conjunto exato do diálogo de confirmação. Respostas divergentes bloqueiam o lote. Respostas já corretas são puladas. Depois de salvar, a página é recarregada e cada CNPJ é conferido de novo. O arquivo de auditoria fica em `runs/`.

## Requisitos

- Linux com Node.js 22 ou superior e Google Chrome instalado.
- Pacotes Playwright incluídos em `node_modules/` nesta entrega. Se mover o projeto para outra máquina, execute `npm install` para instalar a versão fixada em `package.json`.
- Acesso à conta G-Click 6581. Para ler diretamente uma planilha privada por link, é preciso uma conta de serviço Google com a API Sheets habilitada e acesso de Leitor à planilha.
- Ninguém deve editar o perfil dos clientes simultaneamente nesta conta enquanto a automação estiver em execução.

## Interface gráfica local

Na pasta `automacao`, execute:

```bash
node server.mjs
```

Abra `http://127.0.0.1:8766` no navegador integrado do Codex para aproveitar a sessão do Google já aberta. Não abra `ui/index.html` ou uma cópia em `/tmp` como `file://`: esse arquivo depende do servidor para carregar CSS, JavaScript e dados. Se for aberto diretamente, a página mostra um aviso com o link correto. O G-Click usa outra janela do Chrome, iniciada pelo botão **Abrir janela de login**. Nessa janela, entre, selecione a conta indicada na interface e abra a Enquete antes de clicar em **Validar acesso**. O programa confirma o acesso e mantém essa janela aberta enquanto faz a prévia ou gravação, pois a sessão do G-Click expira quando o Chrome fecha. O servidor escuta somente em `127.0.0.1`; encerre com `Ctrl+C`. A interface permite:

- Abrir uma janela própria do Chrome na página `https://appp.gclick.com.br/autenticacao` para entrar no G-Click. A sessão do navegador integrado pode baixar o CSV da planilha privada.
- Enviar um `.csv` ou `.xlsx` (com nome da aba opcional), informar o link da aba para download no navegador integrado ou usar o link público/API.
- Editar a conta, categoria, pergunta, referência, resposta, tarefas permitidas/excluídas e o escopo.
- Analisar a planilha sem acessar o G-Click, ou gerar prévia consultando a enquete.
- Ver um painel separado com CNPJs da planilha **não localizados na enquete**, além de CNPJs inválidos na fonte, respostas divergentes e respostas já corretas.
- Baixar o resultado em CSV ou JSON. Os JSONs também ficam em `runs/`.

A gravação na interface exige uma prévia sem bloqueios e a frase `APLICAR N`, onde N é o número de CNPJs do escopo. O programa relê a enquete antes de gravar. Na abertura da pergunta, confere na aba Enquete se referência, texto e valor interno da resposta correspondem à regra. Se o CSV selecionado mudar após a prévia, a interface exige uma nova prévia; para arquivos de `Downloads`, o servidor também confere o conteúdo antes de gravar. Se um CNPJ não aparecer na tabela carregada da pergunta, ele é marcado como “Não localizado” e o lote não pode ser gravado. Confira paginação e filtros do G-Click antes de concluir que o cliente não existe na conta.

### Fonte atualizada

Para gravar, envie um arquivo exportado nas últimas 24 horas ou use o link do Google Sheets. Arquivos antigos podem ser usados para planejar ou gerar prévia, mas a interface não habilita a gravação.

## Execução pela linha de comando

Execute `preview` ou `apply` diretamente com as opções descritas abaixo. O Chrome da automação permanece aberto durante o comando. Se a sessão estiver expirada, o próprio comando abre `https://appp.gclick.com.br/autenticacao` e aguarda você entrar no G-Click, selecionar a conta `6581` e abrir a Enquete. Pressione Enter no terminal depois que a Enquete aparecer. O painel inicial sozinho não estabelece a sessão da enquete. O navegador usado pelo robô é próprio da automação; ele não usa a aba do Codex. Para planilhas privadas use uma exportação CSV/XLSX ou a credencial de conta de serviço abaixo.

Crie um arquivo de lote com um CNPJ por linha. `lote-exemplo.txt` contém apenas os sete CNPJs do piloto anterior; revise o arquivo antes de qualquer novo lote.

### Usar a sessão já aberta no navegador integrado

O navegador integrado do Codex já está autenticado no Google, mas o servidor Node local não recebe os cookies desse navegador. Para usar essa sessão sem criar conta de serviço e sem selecionar arquivo para upload:

1. Abra a interface local no navegador integrado do Codex e escolha **Navegador integrado**. Cole o link da aba desejada, incluindo `gid`, e clique em **Baixar CSV da aba**. O download usa a sessão Google desse navegador e salva o CSV em `~/Downloads`.
2. Clique em **Atualizar downloads** se a lista ainda não mostrar o arquivo novo. Se o botão de download direto falhar, abra a planilha e use **Arquivo → Baixar → Valores separados por vírgulas (.csv)**.
3. Confirme o nome completo e o horário do CSV exibidos. Então clique em **Analisar planilha** ou **Gerar prévia na enquete**.

Esse fluxo exige um clique de download a cada atualização; a leitura e o filtro do arquivo baixado são automáticos. Em teste com a aba `gid=150007372`, a exportação trouxe 2.515 linhas e a regra DAS atual selecionou 202 CNPJs. A fonte escolhida é registrada no relatório. O botão de download funciona na sessão autenticada do navegador integrado; em outro navegador, será necessário entrar no Google naquele navegador.

### Planilha privada por link

A tela de login do Google rejeitou o Chrome separado da automação nesta máquina. Se for necessária a atualização por link sem clicar no download a cada execução:

1. Em um projeto do Google Cloud sob seu controle, habilite a **Google Sheets API** e crie uma **conta de serviço**.
2. Gere uma chave JSON dessa conta. Guarde-a em local seguro; ela concede acesso aos arquivos compartilhados com a conta.
3. Compartilhe a planilha com o `client_email` da chave JSON, na permissão **Leitor**.
4. Na interface, selecione **Link do Google Sheets**, mantenha o link da aba e envie o JSON em **Credencial de conta de serviço**. A chave não é copiada para `runs/` nem para os arquivos da automação; é usada somente na requisição local.

Se não houver autorização para criar uma conta de serviço, exporte a aba em CSV/XLSX e envie o arquivo. Não torne a planilha pública só para contornar o 401. Consulte a [documentação de credenciais do Google Workspace](https://developers.google.com/workspace/guides/create-credentials) e a [documentação de chaves de conta de serviço](https://docs.cloud.google.com/iam/docs/keys-create-delete).

## Planejar sem acessar o G-Click

```bash
node cli.mjs plan --csv "/caminho/para/exportacao-atual.csv" --cnpjs lote-exemplo.txt
```

Esse comando só analisa a fonte e produz um relatório. Para usar uma planilha pública pela linha de comando, substitua `--csv ...` por:

```bash
--sheet-url "https://docs.google.com/spreadsheets/d/1fxVpJ6WMWFdsQmmquaJK-_7IFTeIBepVGoBPUSHED5g/edit?gid=150007372#gid=150007372"
```

## Prévia na enquete

```bash
node cli.mjs preview --csv "/caminho/para/exportacao-atual.csv" --cnpjs lote-exemplo.txt
```

Lê o estado atual na enquete e classifica cada CNPJ como `vazio`, `ja_correto`, `divergente` ou `bloqueado`. Não clica em respostas nem grava.

## Gravar lote revisado

Use somente depois de revisar o relatório da prévia e verificar que a fonte está atualizada:

```bash
node cli.mjs apply --csv "/caminho/para/exportacao-atual.csv" --cnpjs lote-exemplo.txt --apply
```

Para `apply`, um CSV local com mais de 24 horas é recusado. A leitura direta do Google Sheets obtém um CSV novo a cada execução. Não rode `apply` durante a edição manual na conta.

Se houver erro depois da confirmação, confira o G-Click e o arquivo de auditoria antes de repetir. A confirmação pode ter sido parcialmente processada. A automação não desfaz mudanças. O G-Click avisa que a alteração do perfil pode afetar a lista de obrigações; confira também essas obrigações antes de ampliar o lote.

## Ajuste para outras obrigações

A interface oferece os exemplos DAS / Simples e DeSTDA. O exemplo DeSTDA está em `regras-destda.json`: a tarefa exata `DeSTDA - Declaração mensal` ou `DeSTDA` aponta para a pergunta `02.02`, resposta `02.02.01` (valor interno `409`), apresentada como caixa de seleção. O catálogo lido da aba Enquete está preservado em `enquete-catalogo.json` e não é uma regra executável.

Crie uma cópia de `regras.json` e passe `--rules /caminho/para/outras-regras.json` em `plan`, `preview` e `apply`. O programa usa `inputType` (`radio` ou `checkbox`), `questionRef` e `answerValue` para localizar a resposta; antes de entrar em Respondendo Enquete, confere `questionRef`, `answerRef`, `answerValue`, pergunta e texto da resposta na aba Enquete. No exemplo, `01.02.04` é a referência, `9` é o valor interno e `Simples` é o texto. Faça isso somente após mapear a nova obrigação e sua resposta. Uma obrigação desconhecida não deve ser inferida pelo prefixo. A versão atual executa **uma regra por vez**. Para caixas de seleção, “sem resposta” na prévia significa que a opção específica ainda não está marcada, mesmo que outras opções da pergunta estejam marcadas. Outra pergunta exige uma prévia e teste controlado para confirmar a estrutura da tela, diálogo e salvamento.

## Estado de validação

A seleção das sete empresas do exemplo foi validada com o CSV disponível; os testes automatizados de leitura e filtro passaram. A interface foi testada com upload CSV/XLSX, análise local e um resultado simulado de CNPJ ausente. O robô de navegador foi implementado, mas **não foi executado para gravar no G-Click** nesta entrega. O piloto anterior foi feito pelo agente com cliques controlados, não por este programa. O primeiro uso deve ser `preview` com CSV atualizado, seguido de um lote mínimo acompanhado pelo operador.

## Catálogo automático da Enquete

Após abrir a janela de login, entrar e acessar a Enquete da conta, a interface detecta a sessão e lê automaticamente todas as linhas de configuração. O botão **Repetir captura** permite tentar novamente. A interface monta a lista de perguntas e respostas com referência, categoria e código interno. A seleção de uma resposta preenche esses dados; o tipo de controle (rádio ou caixa de seleção) é confirmado automaticamente na prévia. O catálogo fica em memória enquanto o servidor estiver aberto e é relido no próximo login. Nenhuma resposta de cliente é alterada nessa captura.

A interface lê os nomes distintos da coluna **Obrigação / Tarefa** da fonte selecionada. Para uma associação já conhecida (DAS / Simples ou DeSTDA), usa a lista exata salva. Para uma resposta nova, sugere somente tarefa com o mesmo nome da resposta ou nome seguido de ` - ...`; cabe revisar as tarefas antes da prévia. Quando não há correspondência clara, a lista fica vazia. A captura de perguntas não estabelece por si só a relação de negócio entre uma obrigação e uma resposta, como `DAS - Mensal` → `Simples`.

### Fila de mapeamentos

A tela principal lista cada nome distinto da planilha, quantidade de linhas e CNPJs válidos. Esses nomes vêm da planilha; a presença de uma tarefa na fila não significa que ela foi localizada na Enquete. O arquivo `enquete-catalogo.json`, capturado anteriormente, permite preparar associações mesmo sem uma sessão ativa. Elas aparecem como **associadas no catálogo anterior**, pois a pergunta e a resposta ainda precisam ser conferidas na conta atual. O botão **Mapear** abre as perguntas e respostas desse catálogo. Quando a sessão está disponível, o programa captura novamente a Enquete e marca as associações compatíveis como **verificadas na conta**. Associações pelo nome são apenas sugestões. Associações salvas na interface ficam em `mapeamentos.json` e são revalidadas contra o catálogo no próximo acesso. A tarefa `DAS - Mensal - CDB` permanece excluída pela regra salva.

Abra o filtro **Associadas** e marque **Incluir nesta prévia** nas tarefas desejadas. Sem sessão ativa, é possível selecionar tarefas e revisar mapeamentos, mas o botão **Gerar prévia das tarefas selecionadas** fica desabilitado até a captura atual da Enquete. A prévia consulta a Enquete e gera relatório por tarefa e CNPJ, inclusive CNPJs não localizados; não grava nenhuma resposta. Os dois itens no **Modo legado de DAS e DeSTDA** são exemplos de regras antigas, não o catálogo de tarefas disponíveis. A gravação existente continua disponível somente nesse modo, após sua própria prévia e confirmação. O CSV do relatório inclui a coluna `Mapeamento`.

### Conferência automática ao conectar a conta

Quando a planilha já estiver selecionada e a Enquete da conta for capturada, a interface inicia uma conferência **somente de leitura**. A mesma conferência começa se a conta já estiver conectada quando a planilha for carregada. A seção **Conexão** mostra todas as perguntas e respostas da captura atual, com busca por referência ou texto. A interface acompanha o progresso por tarefa e mostra o resultado para cada par CNPJ/tarefa mapeado: sem marcação, já correto, divergente, bloqueado ou não localizado na pergunta. A tabela mostra 50 linhas por página; os totais e os arquivos CSV/JSON continuam cobrindo o relatório inteiro.

O relatório também lista todos os pares CNPJ/tarefa da planilha que ainda não têm associação com uma resposta da Enquete como **Sem mapeamento**, além das tarefas excluídas pela regra e das que falharam durante a leitura. Para tarefas sem associação, o programa **não declara** que a obrigação foi respondida ou não: esse estado depende de identificar primeiro a resposta correspondente. Salvar uma associação local dispara nova conferência quando a sessão da Enquete está ativa. O relatório JSON/CSV fica disponível em `runs/`; nenhuma resposta é marcada nessa etapa.
