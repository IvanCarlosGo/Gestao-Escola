# Gestão Escolar — Sistema de Faltas de Professores

Aplicação web para gerir professores, turmas, disciplinas, horários e faltas de uma escola, com dashboard e design moderno.

**Stack:** Node.js + Express · EJS · MySQL 8 (Docker) · Chart.js

## Funcionalidades

- **Início (Dashboard)** — estatísticas do mês, ranking de professores com mais faltas, gráfico mensal, faltas recentes
- **Professores** — criar, editar, eliminar, pesquisar; cada professor tem disciplina(s) e turma(s) atribuídas
- **Perfil do professor** — separadores: Resumo, Horário Semanal (grelha), Faltas, Disciplinas, Turmas
- **Turmas** e **Disciplinas** — gestão completa (CRUD) independente
- **Registo de faltas** — feito pela aplicação móvel; esta aplicação web consulta, gere e exporta os registos
- **Horários** — grelha semanal clicável por turma (e por professor no perfil), com deteção de conflitos
- **Histórico de Faltas** — lista individual de faltas/atrasos com filtros, justificação com um clique
- **Relatórios** — estatísticas agregadas e exportação em PDF ou CSV, com filtros
- **Login e perfis** — Administrador (acesso total e gestão de utilizadores) e Secretaria (consulta, edita e justifica faltas)
- Interface responsiva (desktop e telemóvel)

## Estrutura

```
gestao-escolar/
├── server.js                  # Ponto de entrada da aplicação
├── config/db.js               # Ligação ao MySQL (pool + retry)
├── config/horarioSlots.js     # Dias da semana e blocos horários fixos
├── routes/                    # index, professores, faltas, turmas, disciplinas, horarios, relatorios, configuracoes
├── views/                     # Templates EJS
├── public/                    # CSS e JS estáticos
├── db/init.sql                # Schema completo + dados de exemplo (auto-executado pelo MySQL)
├── db/migrate_v2.sql          # Migração aplicada a uma instalação já existente (turmas/disciplinas/horários)
├── docker-compose.yml         # Serviços: app, db (MySQL), adminer
└── Dockerfile
```

## Como correr com Docker (recomendado)

Requer [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e a correr.

```bash
docker compose up --build
```

- Aplicação: http://localhost:3000
- Adminer (gestor visual da BD): http://localhost:8080
  - Sistema: MySQL, Servidor: `db`, Utilizador: `escola_user`, Password: `escola_pass`, Base de dados: `gestao_escolar`

### Primeiro acesso

No primeiro arranque é criado automaticamente um administrador (`ADMIN_EMAIL`, por omissão `admin@escola.cv`).
Se `ADMIN_PASSWORD` não estiver definido, é gerada uma palavra-passe aleatória e mostrada nos logs:

```bash
docker logs escola_app | grep -A3 "Administrador criado"
```

Depois de entrar, altere a palavra-passe em **Definições** e crie as restantes contas em **Utilizadores**.

Os dados ficam persistidos no volume `db-data`. Para recomeçar do zero:

```bash
docker compose down -v
docker compose up --build
```

## Como correr localmente sem Docker para a app (apenas a BD em Docker)

```bash
docker compose up -d db
npm install
npm run dev   # ou: npm start
```

Ajusta o `.env` se necessário (por defeito `DB_HOST=db`, muda para `localhost` se a app não estiver em Docker).

## Variáveis de ambiente (`.env`)

| Variável | Descrição | Default |
|---|---|---|
| PORT | Porta da aplicação | 3000 |
| DB_HOST | Host do MySQL | db |
| DB_PORT | Porta do MySQL (dentro do Docker) | 3306 |
| DB_USER | Utilizador da BD | escola_user |
| DB_PASSWORD | Password da BD | escola_pass |
| DB_NAME | Nome da BD | gestao_escolar |
| DB_ROOT_PASSWORD | Password root do MySQL | root_pass |
| TZ | Fuso horário da escola (app e MySQL) | Atlantic/Cape_Verde |
| SESSION_SECRET | Chave secreta das sessões (longa e aleatória) | — (gerada a cada arranque) |
| ADMIN_EMAIL | Email do administrador criado no primeiro arranque | admin@escola.cv |
| ADMIN_PASSWORD | Palavra-passe desse administrador | — (gerada e mostrada nos logs) |
| COOKIE_SECURE | `1` quando a aplicação estiver em HTTPS | 0 |

> Nota: a porta do MySQL exposta ao Windows é **3307** (`docker-compose.yml`), porque a 3306 pode já estar ocupada por outra instalação local de MySQL. Isto não afeta a app, que liga sempre internamente à porta 3306 dentro da rede Docker.

## Modelo de dados

- **professores** — nome, email, telefone, data_admissao, ativo
- **disciplinas** — nome
- **turmas** — nome, ano_letivo
- **professor_disciplinas** / **professor_turmas** — relações N:N
- **horarios** — professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala
- **faltas** — professor_id, horario_id (opcional), data_falta, hora_inicio, hora_fim, tipo (`falta`/`atraso`), motivo, justificada, substituto, observacoes

## Simplificações assumidas

- Não existe autenticação/login — é um sistema de administração único.
- Os avatares dos professores são iniciais coloridas, não fotos.
- "Configurações" é uma pré-visualização visual (as preferências ainda não são guardadas na BD).
- O "Horário Semanal" é recorrente (por dia da semana), não específico de uma data/semana concreta.
