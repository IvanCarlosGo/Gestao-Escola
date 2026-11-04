# API — Aplicação móvel de registo de faltas

API JSON usada pela aplicação móvel para registar as faltas dos professores.
A aplicação web consulta, gere e exporta estes registos.

- **Base:** `http://<servidor>:3000/api`
- **Formato:** JSON em UTF-8 (`Content-Type: application/json`)
- **Datas:** `AAAA-MM-DD` · **Horas:** `HH:MM` · **Fuso horário:** o da escola (`TZ`, por omissão `Atlantic/Cape_Verde`)

## Autenticação

1. Faça login com o email e a palavra-passe de um utilizador criado em **Utilizadores** (aplicação web).
2. Guarde o `token` devolvido e envie-o em todos os pedidos:

```
Authorization: Bearer <token>
```

O token é válido durante **30 dias**. Quando expira, ou se a conta for desativada, a API responde `401` e a aplicação deve pedir login outra vez.
Depois de 5 tentativas de login falhadas, o email fica bloqueado durante 10 minutos (`429`).

### `POST /api/login`

```json
{ "email": "secretaria@escola.cv", "palavra_passe": "••••••••" }
```

Resposta `200`:

```json
{
  "token": "3.1796425778513.Yk1…",
  "expira_em": "2026-12-04T23:09:38.513Z",
  "utilizador": { "id": 3, "nome": "Maria Lopes", "email": "secretaria@escola.cv", "perfil": "secretaria", "perfil_nome": "Secretaria" }
}
```

### `GET /api/eu`

Devolve o utilizador do token. Útil para validar um token guardado ao abrir a aplicação.

## Consulta

### `GET /api/aulas-agora`

Professores com aula a decorrer neste momento, segundo o horário. É o ecrã principal da aplicação.

```json
{
  "data": "2026-11-05",
  "hora": "08:32",
  "dia_semana": "quinta",
  "dia_semana_nome": "Quinta-feira",
  "proxima_aula": null,
  "aulas": [
    {
      "horario_id": 85,
      "professor_id": 1,
      "professor_nome": "Ana Sofia Martins",
      "disciplina_id": 1,
      "disciplina_nome": "Matemática",
      "turma_id": 1,
      "turma_nome": "10ºA",
      "sala": "Sala 20",
      "hora_inicio": "08:15",
      "hora_fim": "09:00",
      "minutos_restantes": 28,
      "tem_falta_hoje": false
    }
  ]
}
```

Quando não há aulas, `aulas` vem vazio e `proxima_aula` indica a hora da próxima aula do dia (ou `null`).

### `GET /api/professores`

Professores ativos: `[{ "id": 1, "nome": "Ana Sofia Martins", "disciplinas": ["Matemática"] }]`

### `GET /api/horarios`

Aulas do horário semanal. Filtros opcionais: `professor_id`, `turma_id`, `dia_semana` (`segunda`, `terca`, `quarta`, `quinta`, `sexta`).

### `GET /api/motivos`

Lista sugerida de motivos: `["Doença", "Consulta médica", "Motivos pessoais", "Formação", "Assistência familiar", "Outro"]`

### `GET /api/faltas`

Faltas de um dia. Parâmetros opcionais: `data` (por omissão, hoje) e `professor_id`.

## Registo

### `POST /api/faltas`

| Campo | Obrigatório | Descrição |
|---|---|---|
| `professor_id` | sim | Professor ativo |
| `horario_id` | não | Aula do horário (de `/api/aulas-agora`). Liga a falta à aula e preenche as horas |
| `data_falta` | não | Por omissão, hoje |
| `tipo` | não | `falta` (por omissão) ou `atraso` |
| `hora_inicio`, `hora_fim` | não | `HH:MM`. Com `horario_id`, vêm da aula |
| `motivo` | não | Texto até 255 caracteres (ver `/api/motivos`) |
| `justificada` | não | `true` / `false` (por omissão `false`) |
| `observacoes` | não | Texto livre |

Exemplo, ao tocar num professor da lista "aulas agora":

```json
{ "professor_id": 1, "horario_id": 85, "motivo": "Doença" }
```

Resposta `201` com a falta criada:

```json
{
  "id": 42, "professor_id": 1, "professor_nome": "Ana Sofia Martins", "horario_id": 85,
  "data_falta": "2026-11-05", "hora_inicio": "08:15", "hora_fim": "09:00",
  "tipo": "falta", "motivo": "Doença", "justificada": false, "observacoes": null,
  "criado_em": "2026-11-05 08:32:10"
}
```

**Pedidos repetidos são seguros:** se a mesma falta já existir (mesmo professor, data e aula), a API responde `409` com `falta_id` e não cria outra. Assim a aplicação pode reenviar quando a rede falha.

## Erros

Todas as respostas de erro têm o formato `{ "erro": "mensagem" }` (às vezes com `detalhes`).

| Código | Quando |
|---|---|
| `400` | Dados inválidos ou JSON mal formado (`detalhes` lista os problemas) |
| `401` | Sem token, token inválido/expirado ou conta desativada |
| `404` | Professor, aula ou endpoint inexistente |
| `409` | Falta já registada |
| `429` | Demasiadas tentativas de login |
| `500` | Erro interno |

## Teste rápido (curl)

```bash
TOKEN=$(curl -s -H 'Content-Type: application/json' \
  -d '{"email":"admin@escola.cv","palavra_passe":"…"}' \
  http://localhost:3000/api/login | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/aulas-agora

curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"professor_id":1,"horario_id":85,"motivo":"Doença"}' \
  http://localhost:3000/api/faltas
```
