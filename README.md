<p align="center"><img src="public/img/marca/simbolo.svg" width="72" alt=""></p>

# Assídua — Gestão da assiduidade dos professores

> *Cada aula conta.*

Plataforma para gerir professores, turmas, disciplinas, horários e faltas de várias escolas, com dashboard, aplicação móvel e design moderno.

## Identidade

**Assídua** é a marca da plataforma; **cada escola tem a sua própria identidade** (nome, sigla, logótipo e cor), definida no painel da plataforma.

| Onde | Identidade |
|---|---|
| Login do site e da app, painel da plataforma, ícone da app | Assídua |
| Site da escola depois do login (barra lateral, cor, ícone do separador) e app móvel depois do login | A escola |
| Rodapé da barra lateral | Assinatura discreta "com Assídua" |

- **Símbolo:** uma pessoa de braços no ar a dizer *"presente!"*, desenhada com um visto — [`public/img/marca/simbolo.svg`](public/img/marca/simbolo.svg) (versão de uma cor: `simbolo-mono.svg`)
- **Cores:** Azul Atlântico `#1B4BC2` (principal) · Azul-tinta `#0E1F4D` (fundos escuros) · Amarelo Sol `#F6B900` (acento, das estrelas da bandeira de Cabo Verde) · Névoa `#E8EEFB`
- **Letra:** Plus Jakarta Sans ExtraBold no nome da marca; Inter na interface web
- **Onde mudar:** [`config/marca.js`](config/marca.js) (web) e `lib/config/marca.dart` (app móvel)

**Stack:** Node.js + Express · EJS · MySQL 8 (Docker) · Chart.js

## Funcionalidades

- **Início (Dashboard)** — estatísticas do mês, ranking de professores com mais faltas, gráfico mensal, faltas recentes
- **Professores** — criar, editar, eliminar, pesquisar; cada professor tem disciplina(s) e turma(s) atribuídas
- **Perfil do professor** — separadores: Resumo, Horário Semanal (grelha), Faltas, Disciplinas, Turmas
- **Turmas** e **Disciplinas** — gestão completa (CRUD) independente
- **Registo de faltas** — feito pela aplicação móvel através da [API](docs/API.md); esta aplicação web consulta, gere e exporta os registos
- **Horários** — grelha semanal clicável por turma (e por professor no perfil), com deteção de conflitos
- **Horário da escola** — em **Definições** cada escola escolhe um modelo e pode ajustá-lo (aulas de 50 min; a tarde começa às 13:00); a grelha, a importação e a aplicação móvel usam estes tempos:
  - *Horário da Cidade da Praia* — 07:30–12:20 (intervalo 10:20–10:40) e 13:00–17:50 (intervalo 15:50–16:10)
  - *Horário geral* (padrão) — 08:00–12:50 e 13:00–17:50
- **Histórico de Faltas** — lista individual de faltas/atrasos com filtros, justificação com um clique
- **Relatórios** — estatísticas agregadas e exportação em PDF ou CSV, com filtros
- **Importar de Excel/CSV** — professores e horários de uma só vez, a partir de modelos já com as listas da escola, com pré-visualização e verificação de erros e conflitos antes de gravar; também é possível colar uma lista de professores
- **Várias escolas** — cada escola só vê os seus professores, turmas, horários, faltas e contas
- **Login e perfis** — Administrador da escola, Secretaria (consulta, edita e justifica faltas) e Contínuo (só a aplicação móvel)
- **Painel da plataforma** (porta 8080) — o dono do projeto cria escolas, administradores, secretarias e contínuos, suspende escolas e acompanha os números de todas
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
├── db/init.sql                # Schema completo, sem dados (auto-executado pelo MySQL)
├── db/migrate_v2.sql          # Migração aplicada a uma instalação já existente (turmas/disciplinas/horários)
├── docker-compose.yml         # Serviços: app, db (MySQL), adminer
└── Dockerfile
```

## Como correr com Docker (recomendado)

Requer [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e a correr.

```bash
docker compose up --build
```

- Aplicação das escolas: http://localhost:3000
- Painel da plataforma: http://localhost:8080
- Adminer (gestor visual da BD, só para emergências): http://localhost:8081
  - Sistema: MySQL, Servidor: `db`, Utilizador: `escola_user`, Password: `escola_pass`, Base de dados: `gestao_escolar`

### Primeiro acesso

Uma instalação nova começa **sem dados**: sem escolas, utilizadores, turmas, disciplinas, professores ou horários.

1. Entre no **painel da plataforma** (porta 8080) com a conta criada pelo seeder [painel/seeder.js](painel/seeder.js) (`admin@admin.cv`) e altere a palavra-passe em **Administradores → A minha conta**.
2. Em **Escolas**, crie a escola (nome, sigla, logótipo e cor).
3. Em **Utilizadores**, crie o administrador da escola (e, se quiser, a secretaria e os contínuos).
4. O administrador entra no site da escola (porta 3000) e cria ou importa (**Importar**) as turmas, disciplinas, professores e horários.

Se já existir pelo menos uma escola e nenhum utilizador, o arranque cria um administrador nessa escola (`ADMIN_EMAIL`, por omissão `admin@escola.cv`); sem `ADMIN_PASSWORD`, a palavra-passe é gerada e mostrada nos logs (`docker logs escola_app | grep -A3 "Administrador criado"`).

```bash
npm run seed:admin              # cria a conta se não existir
npm run seed:admin -- --repor   # repõe a palavra-passe por omissão
```

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
| ADMIN_EMAIL | Email do administrador criado no arranque, se já houver escola e nenhum utilizador | admin@escola.cv |
| ADMIN_PASSWORD | Palavra-passe desse administrador | — (gerada e mostrada nos logs) |
| COOKIE_SECURE | `1` quando a aplicação estiver em HTTPS | 0 |
| PAINEL_EMAIL | Email da conta do painel (substitui a do seeder) | admin@admin.cv |
| PAINEL_PASSWORD | Palavra-passe dessa conta (substitui a do seeder) | a do seeder |

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
