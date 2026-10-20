# Automação local da Enquete G-Click

Ferramenta do consultor que atende escritórios contábeis usuários do G-Click. Lê a planilha de clientes × obrigações/tarefas de um escritório e marca, na Enquete desse escritório, as respostas correspondentes, eliminando o preenchimento manual pergunta a pergunta, cliente a cliente.

Roda em Node.js e Google Chrome locais, sem API de IA. A sessão do navegador fica em `~/.local/share/gclick-enquete/browser-profile`; a senha é digitada somente na página de login do G-Click.

## Requisitos

- Linux com Node.js 22 ou superior e Google Chrome instalado.
- `npm install` para instalar o Playwright na versão fixada em `package.json`.
- Um usuário G-Click com acesso aos escritórios atendidos.
- Ninguém deve editar o perfil dos clientes do escritório enquanto a automação grava.

## Uso

Na pasta `automacao`, execute `npm start` e abra `http://127.0.0.1:8766`. O servidor escuta somente em `127.0.0.1`; encerre com `Ctrl+C`.

1. **Conta.** Informe o `empId` do escritório no campo **Conta G-Click**. A lista sugere os escritórios já atendidos; a última conta usada é lembrada neste navegador.
2. **Login.** Clique em **Abrir janela de login** e entre no G-Click na janela do Chrome que abrir. Não é preciso navegar: assim que o login é detectado, o robô abre a Enquete da conta pelo endereço `Listar.do?obj=enqueteopen&empId=<conta>` e captura o catálogo de perguntas e respostas. Se o usuário não tiver acesso ao escritório, a tela avisa e tenta de novo a cada 20 s. Mantenha a janela aberta: a sessão do G-Click expira quando o Chrome fecha.
3. **Planilha.** Cole o link da aba do Google Sheets do escritório; ele fica salvo para a conta. Baixe o CSV pelo botão **Baixar CSV da aba** e selecione o arquivo. Também é possível enviar `.csv`/`.xlsx` ou ler por conta de serviço (ver abaixo). A planilha precisa das colunas `Obrigação / Tarefa`, `Empresa`, `EmpID` e `CNPJ`.
4. **Mapeamentos.** A fila lista cada tarefa distinta da planilha. Para cada uma, escolha a pergunta e a resposta da Enquete que ela exige (**Mapear**) ou marque **Excluir tarefa** quando ela não gera resposta. Sugestões aparecem quando o nome da tarefa coincide com o texto de uma resposta, ou quando outro escritório já mapeou a mesma tarefa para uma pergunta e resposta de texto idêntico nesta Enquete. Sugestão nunca é aplicada sem confirmação.
5. **Conferência.** Com a Enquete conectada e a planilha carregada, a conferência automática (somente leitura) classifica cada par cliente/tarefa: sem marcação, já correto, divergente, bloqueado, não localizado, sem mapeamento ou não verificado. Os relatórios ficam em `runs/` e podem ser baixados em CSV/JSON.
6. **Gravação.** Após uma conferência completa, clique em **Marcar N resposta(s) no G-Click**. O robô abre cada pergunta, marca as respostas de todos os CNPJs pendentes daquela pergunta e clica em **Alterar**. Na janela do G-Click aparece uma faixa do robô: confira o diálogo e clique em **Confirmar** (ou feche o diálogo para cancelar aquela pergunta). A tela local mostra em que pergunta o robô está e o que ele espera de você.

## Garantias da gravação

- O robô nunca clica em Confirmar: a gravação de cada pergunta é decisão do operador no diálogo do G-Click.
- Só marca a partir de uma conferência **completa**, com menos de 2 horas, sobre a mesma Enquete, o mesmo catálogo e o mesmo CSV (conferido por hash). CSV com mais de 24 horas gera aviso, não bloqueio.
- Grava por pergunta (todas as respostas e clientes dela de uma vez, em lotes de até 100 clientes). Antes de marcar, relê cada cliente e só marca quem continua sem marcação; numa pergunta de escolha única, duas respostas diferentes para o mesmo cliente são recusadas.
- Nunca sobrescreve resposta divergente: divergentes, bloqueados e não localizados ficam de fora e aparecem no relatório.
- Confere que pergunta, resposta e código interno da regra existem na aba Enquete da conta; código diferente bloqueia.
- Antes de pedir a confirmação, compara a lista do diálogo do G-Click com os clientes esperados; se não bater, fecha o diálogo e descarta as marcações sem gravar. Depois da confirmação, confere cada resposta recarregando a página. Se o operador fechar o diálogo, as marcações daquela pergunta são descartadas.
- Interrompe no primeiro erro e registra tudo em `runs/`. A automação não desfaz mudanças: em caso de erro, confira a Enquete e o relatório antes de repetir.
- Se a sessão cair durante a conferência, ela fica **incompleta**: os pares afetados e as tarefas seguintes aparecem como “Não verificado” e a gravação é bloqueada.
- Se mais da metade dos CNPJs mapeados não aparece na Enquete, a planilha provavelmente é de outro escritório: o relatório avisa e a gravação é bloqueada.
- Respostas sem código interno no catálogo são localizadas como coluna da grade da pergunta: o cabeçalho precisa ser idêntico ao texto da resposta e único, e todas as caixas da coluna precisam ter o mesmo código.

O G-Click avisa que alterar o perfil pode afetar a lista de obrigações do cliente; confira essas obrigações depois dos primeiros lotes.

## Dados por escritório

| Arquivo | Conteúdo |
|---|---|
| `catalogos/<empId>.json` | Catálogo da Enquete capturado na última conexão com a conta |
| `mapeamentos.json` | Tarefa → resposta (com os textos da pergunta e da resposta) e tarefas excluídas, por conta |
| `contas.json` | Link da planilha de cada conta |
| `runs/` | Relatórios de conferência e gravação (fora do git) |

## Planilha privada sem download manual

Para ler a planilha por link sem baixar o CSV a cada execução:

1. Em um projeto do Google Cloud sob seu controle, habilite a **Google Sheets API** e crie uma **conta de serviço** com chave JSON.
2. Compartilhe a planilha com o `client_email` da chave, como **Leitor**.
3. Na interface, escolha **Link público / API** e envie o JSON em **Credencial de conta de serviço**. A chave é usada só na leitura e não é gravada em disco.

Não torne a planilha pública para contornar o erro 401.

## Linha de comando

Para uma regra pontual (uma tarefa → uma resposta), sem a interface. Exemplos de regra e de lote em `exemplos/` (referências da conta 6581).

```bash
node cli.mjs plan    --account 6581 --rules exemplos/regra-das-simples-6581.json --cnpjs exemplos/lote-6581.txt --csv exportacao.csv
node cli.mjs preview --account 6581 --rules exemplos/regra-das-simples-6581.json --cnpjs exemplos/lote-6581.txt --csv exportacao.csv
node cli.mjs apply   --account 6581 --rules exemplos/regra-das-simples-6581.json --cnpjs exemplos/lote-6581.txt --csv exportacao.csv --apply
```

`plan` só lê a planilha; `preview` consulta a Enquete sem gravar; `apply` exige CSV com menos de 24 horas, bloqueia o lote inteiro se houver divergência, bloqueio ou cliente não localizado, e espera a sua confirmação no diálogo do G-Click. Se a sessão estiver expirada, o comando abre o login e, depois que você entra, abre a Enquete sozinho. A CLI e o servidor não rodam ao mesmo tempo (trava em `automation.lock`).

## Testes

```bash
npm test
```

Os testes de interface usam páginas simuladas do G-Click. A gravação real só foi exercitada no piloto manual de 2026-10-17; o primeiro uso em cada escritório deve ser uma conferência seguida de um lote pequeno acompanhado pelo operador.
