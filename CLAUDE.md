# CLAUDE.md — Monitor-de-Opcoes-B3 (LEIA PRIMEIRO)

> ⚙️ PROTOCOLO OBRIGATÓRIO — antes de diagnosticar ou codar nesta base, leia `ENGINEERING_LOOP.md` e opere por ele.
> Toda tarefa roda como loop (Orientar → Planejar → Executar → Verificar → Registrar → Decidir), com os três freios e os checkpoints humanos. O estado vive em `TAREFA_ATUAL.md`.

## Regras Mestras (sempre ativas)
1. **pt-BR** em tudo (respostas, comentários, commits, docs).
2. **Formatação BR:** dinheiro `R$ 1.234,56`; datas `DD/MM/AAAA`; tudo no fuso `America/Sao_Paulo`.
3. **UX padrão-ouro:** tooltips em tudo; micro-interações (hover/loading/disabled); drag-and-drop em listas/dashboards.
4. **Anti-preguiça:** código completo (sem placeholder); `try/catch` + feedback visual; 1 parágrafo de arquitetura antes de codar.
5. **Memória:** registrar no `AI_MASTER_LOG.md` ao fim de cada passo importante.

Skill global: `engineering-loop` (Claude Code lê `~/.claude/skills/`; Claude Desktop/Cowork instala o `.skill`).
