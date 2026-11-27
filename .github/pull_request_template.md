## O que muda?

## Checklist
- [ ] `npm test` passa (só dados sintéticos, sem rede externa)
- [ ] Revisei o diff completo, `git ls-files`, **cada commit novo** (`git log -p origin/main..HEAD`, mensagens incluídas)
      e o texto final desta PR: nenhum dado real — consultas estratégicas, exportações do Search Console, inventários
      internos de URLs, saídas de coleta ou credenciais (guarde-os em `dados-locais/`, fora do Git)
- [ ] Textos de interface em `pt`, `en` e `tr` (`web/js/i18n.js`)
- [ ] Se um provedor mudou: teste de parser com resposta sintética e `docs/ENDPOINTS.md` atualizado
      (não cole aqui saídas de coleta ao vivo)
