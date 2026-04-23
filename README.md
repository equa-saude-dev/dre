# Equa — DRE App

Esta é uma aplicação Next.js transformada a partir do modelo financeiro "dre_v18.html".

## Funcionalidades
- **Persistência**: Alterações nas premissas e custos são salvas automaticamente no servidor (`data.json`).
- **Dashboard Interativo**: Gráficos Plotly dinâmicos e cálculos em tempo real.
- **Modo Escuro**: Suporte a temas claro e escuro.
- **Responsivo**: Design otimizado para diferentes tamanhos de tela.

## Como Executar Localmente
Para rodar a aplicação no seu computador:

1. Acesse a pasta: `cd Equa_mkt/DRE/dre-app`
2. Instale as dependências (se necessário): `bun install`
3. Inicie o servidor: `bun dev`
4. Acesse: `http://localhost:3000`

## Como Hospedar (Link Público)

### Opção 1: Vercel (Recomendado para Next.js)
A Vercel é a forma mais rápida de ter um link público.
1. Instale a CLI da Vercel: `npm i -g vercel`
2. No diretório do app, rode: `vercel`
3. Siga as instruções para deploy instantâneo.

### Opção 2: Google Cloud (GCP)
Como você possui o `equa-skill` configurado, você pode tentar adaptar o deploy para o Cloud Run usando a infraestrutura da Equa.

### Opção 3: Link Temporário (Demo agora)
Para gerar um link público agora mesmo a partir da sua máquina:
`bun x localtunnel --port 3000`
*(Certifique-se de que o `bun dev` esteja rodando em outro terminal)*

---
Desenvolvido por Antigravity.
