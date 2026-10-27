# Diretrizes e Regras do Projeto (G-Click Automação)

## Regra Principal: Evitar Ações, Funções e Fluxos Redundantes

1. **Responsabilidade Única e Fluxo Previsível:**
   - Cada botão, módulo e ação deve ter um papel claro e delimitado.
   - Não criar atalhos automáticos ou disparos em cascata que executem ações de outros módulos de forma redundante (ex.: disparar abertura de login dentro de botões de busca/conferência).

2. **Validação de Pré-condições:**
   - Quando uma pré-condição não for atendida (ex.: sessão do G-Click desconectada), o sistema deve informar com clareza a pendência e orientar o operador a executar a etapa no módulo responsável, em vez de assumir e disparar a ação automaticamente.

3. **Sustentabilidade e Simplicidade Arquitetural:**
   - Manter a interface e o backend previsíveis, evitando sobreposição de fluxos que gerem dívida técnica, duplicação de comportamentos ou efeitos colaterais difíceis de manter.

## Melhores Práticas de Desenvolvimento e Arquitetura de Software

1. **Padrões e Princípios de Design (SOLID & Clean Code):**
   - Seguir princípios SOLID, separação de responsabilidades (SoC) e baixo acoplamento.
   - Escrever código legível, modular e de fácil manutenção, evitando complexidade acidental.

2. **Qualidade, Resiliência e Testabilidade:**
   - Manter e expandir a cobertura de testes automatizados para todas as regras de negócio e fluxos críticos.
   - Tratar erros e falhas de forma graciosa, previsível e com mensagens claras para o operador.

3. **Segurança e Isolamento (Multi-Tenancy & RBAC):**
   - Garantir a integridade dos dados, isolamento rigoroso entre contas e conformidade com o controle de permissões.
   - Preservar a segurança de credenciais, sessões e chaves de acesso.
