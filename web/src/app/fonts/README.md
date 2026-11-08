# Fontes do painel

Arquivos `woff2` (apenas o conjunto latino) guardados aqui para o build **não depender de baixar fontes do Google**
a cada execução (o download falhava de vez em quando no CI). Carregados por `next/font/local` em `../layout.tsx`.

| Arquivo | Fonte | Uso | Licença |
|---|---|---|---|
| `dm-sans-latin-wght-normal.woff2` | DM Sans (variável) | texto geral (`--font-dm-sans`) | `LICENSE-dm-sans.txt` |
| `sora-latin-wght-normal.woff2` | Sora (variável) | títulos (`--font-sora`) | `LICENSE-sora.txt` |
| `jetbrains-mono-latin-500-normal.woff2` | JetBrains Mono 500 | números e código (`--font-jetbrains`) | `LICENSE-jetbrains-mono.txt` |

Todas sob a SIL Open Font License 1.1. Origem: pacotes `@fontsource-variable/dm-sans`, `@fontsource-variable/sora` e
`@fontsource/jetbrains-mono` (versão 5.3.0). Para trocar uma fonte, substitua o arquivo e ajuste o `localFont` do layout.
