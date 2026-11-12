// API JSON para a aplicação móvel (registo de faltas). Documentação: docs/API.md
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { DIAS_SEMANA, SLOTS, labelDia } = require('../config/horarioSlots');
const { MOTIVOS_FALTA } = require('../config/ui');
const { aulasAgora, calcularProgresso } = require('../config/aulas');
const {
  PERFIS, SQL_UTILIZADOR_ATIVO, verificarPalavraPasse, criarTokenApi, idDoTokenApi, bloqueado, registarFalha, limparFalhas
} = require('../config/auth');
const { COR_PADRAO, validarCor } = require('../config/cores');

// Dados do utilizador devolvidos pela API (inclui a escola e a sua identidade: logótipo e cor)
const dadosUtilizador = (u) => ({
  id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, perfil_nome: PERFIS[u.perfil],
  escola: {
    id: u.escola_id,
    nome: u.escola_nome,
    sigla: u.escola_sigla,
    logo: u.escola_logo || null, // caminho relativo ao servidor (ex: /img/escolas/1-….png)
    cor: u.escola_cor && !validarCor(u.escola_cor) ? u.escola_cor.toUpperCase() : COR_PADRAO
  }
});

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const hhmm = (h) => (h ? String(h).slice(0, 5) : null);

function erro(res, status, mensagem, extra = {}) {
  return res.status(status).json({ erro: mensagem, ...extra });
}

function dataValida(texto) {
  if (!DATA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('sv-SE') === texto;
}

const formatarFalta = (f) => ({
  id: f.id,
  professor_id: f.professor_id,
  professor_nome: f.professor_nome,
  horario_id: f.horario_id,
  data_falta: f.data_falta,
  hora_inicio: hhmm(f.hora_inicio),
  hora_fim: hhmm(f.hora_fim),
  tipo: f.tipo,
  motivo: f.motivo,
  justificada: Boolean(f.justificada),
  observacoes: f.observacoes,
  criado_em: f.criado_em
});

// ---------- Autenticação ----------

// POST /api/login  { email, palavra_passe }  ->  { token, expira_em, utilizador }
router.post('/login', async (req, res, next) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const palavraPasse = String((req.body && req.body.palavra_passe) || '');
    const chave = `api|${req.ip}|${email}`;

    const minutos = bloqueado(chave);
    if (minutos) return erro(res, 429, `Demasiadas tentativas falhadas. Tente novamente dentro de ${minutos} min.`);

    const [[credenciais]] = await pool.query(
      'SELECT id, palavra_passe FROM utilizadores WHERE email = ? AND ativo = 1', [email]
    );
    if (!credenciais || !verificarPalavraPasse(palavraPasse, credenciais.palavra_passe)) {
      registarFalha(chave);
      return erro(res, 401, 'Email ou palavra-passe incorretos.');
    }
    // A escola tem de estar ativa
    const [[conta]] = await pool.query(SQL_UTILIZADOR_ATIVO, [credenciais.id]);
    if (!conta) return erro(res, 403, 'O acesso da sua escola está suspenso. Contacte o administrador da plataforma.');

    limparFalhas(chave);
    const { token, expira } = criarTokenApi(conta.id);
    res.json({ token, expira_em: expira.toISOString(), utilizador: dadosUtilizador(conta) });
  } catch (err) {
    next(err);
  }
});

// Todas as outras rotas exigem "Authorization: Bearer <token>"
router.use(async (req, res, next) => {
  try {
    const [tipo, token] = String(req.headers.authorization || '').split(' ');
    const id = tipo === 'Bearer' ? idDoTokenApi(token) : null;
    if (!id) return erro(res, 401, 'Token em falta, inválido ou expirado. Faça login em POST /api/login.');

    const [[conta]] = await pool.query(SQL_UTILIZADOR_ATIVO, [id]);
    if (!conta) return erro(res, 401, 'Conta desativada, inexistente ou escola suspensa.');
    req.utilizador = conta;
    req.escolaId = conta.escola_id;
    next();
  } catch (err) {
    next(err);
  }
});

// GET /api/eu
router.get('/eu', (req, res) => res.json(dadosUtilizador(req.utilizador)));

// ---------- Consulta ----------

// GET /api/aulas-agora  -> professores com aula a decorrer neste momento
router.get('/aulas-agora', async (req, res, next) => {
  try {
    const agora = new Date();
    const { aulas, proximaAula, diaKey, hoje, hora } = await aulasAgora(req.escolaId, agora);
    calcularProgresso(aulas, agora);
    res.json({
      data: hoje,
      hora: hhmm(hora),
      dia_semana: diaKey,
      dia_semana_nome: diaKey ? labelDia(diaKey) : null,
      proxima_aula: proximaAula ? hhmm(proximaAula.hora_inicio) : null,
      aulas: aulas.map((a) => ({
        horario_id: a.horario_id,
        professor_id: a.professor_id,
        professor_nome: a.professor_nome,
        disciplina_id: a.disciplina_id,
        disciplina_nome: a.disciplina_nome,
        turma_id: a.turma_id,
        turma_nome: a.turma_nome,
        sala: a.sala,
        hora_inicio: hhmm(a.hora_inicio),
        hora_fim: hhmm(a.hora_fim),
        minutos_restantes: a.minutosRestantes,
        tem_falta_hoje: Boolean(a.tem_falta)
      }))
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/professores  -> professores ativos
router.get('/professores', async (req, res, next) => {
  try {
    const [professores] = await pool.query(
      `SELECT p.id, p.nome,
        (SELECT GROUP_CONCAT(d.nome ORDER BY d.nome SEPARATOR ', ')
           FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
           WHERE pd.professor_id = p.id) AS disciplinas
       FROM professores p WHERE p.escola_id = ? AND p.ativo = 1 ORDER BY p.nome ASC`,
      [req.escolaId]
    );
    res.json(professores.map((p) => ({ id: p.id, nome: p.nome, disciplinas: p.disciplinas ? p.disciplinas.split(', ') : [] })));
  } catch (err) {
    next(err);
  }
});

// GET /api/horarios?professor_id=&turma_id=&dia_semana=
router.get('/horarios', async (req, res, next) => {
  try {
    const { professor_id, turma_id, dia_semana } = req.query;
    if (dia_semana && !DIAS_SEMANA.some((d) => d.key === dia_semana)) {
      return erro(res, 400, `dia_semana inválido. Use: ${DIAS_SEMANA.map((d) => d.key).join(', ')}.`);
    }
    let sql = `
      SELECT h.id, h.dia_semana, h.hora_inicio, h.hora_fim, h.sala,
        p.id AS professor_id, p.nome AS professor_nome,
        d.id AS disciplina_id, d.nome AS disciplina_nome,
        t.id AS turma_id, t.nome AS turma_nome
      FROM horarios h
      JOIN professores p ON p.id = h.professor_id
      JOIN disciplinas d ON d.id = h.disciplina_id
      JOIN turmas t ON t.id = h.turma_id
      WHERE h.escola_id = ?`;
    const params = [req.escolaId];
    if (professor_id) { sql += ' AND h.professor_id = ?'; params.push(professor_id); }
    if (turma_id) { sql += ' AND h.turma_id = ?'; params.push(turma_id); }
    if (dia_semana) { sql += ' AND h.dia_semana = ?'; params.push(dia_semana); }
    sql += " ORDER BY FIELD(h.dia_semana, 'segunda','terca','quarta','quinta','sexta'), h.hora_inicio, t.nome";

    const [horarios] = await pool.query(sql, params);
    res.json(horarios.map((h) => ({ ...h, hora_inicio: hhmm(h.hora_inicio), hora_fim: hhmm(h.hora_fim) })));
  } catch (err) {
    next(err);
  }
});

// GET /api/tempos  -> blocos do horário diário (tempos letivos e intervalos)
router.get('/tempos', (req, res) => {
  let numero = 0;
  res.json(SLOTS.map((s) => ({
    numero: s.intervalo ? null : ++numero,
    hora_inicio: s.inicio,
    hora_fim: s.fim,
    intervalo: Boolean(s.intervalo)
  })));
});

// GET /api/motivos  -> lista sugerida de motivos
router.get('/motivos', (req, res) => res.json(MOTIVOS_FALTA));

// GET /api/faltas?data=YYYY-MM-DD&professor_id=   (por omissão: hoje)
// GET /api/faltas?de=YYYY-MM-DD&ate=YYYY-MM-DD      (intervalo, no máximo 31 dias)
router.get('/faltas', async (req, res, next) => {
  try {
    const hoje = new Date().toLocaleDateString('sv-SE');
    const intervalo = Boolean(req.query.de || req.query.ate);
    const de = intervalo ? String(req.query.de || '') : String(req.query.data || hoje);
    const ate = intervalo ? String(req.query.ate || '') : de;
    if (!dataValida(de) || !dataValida(ate)) {
      return erro(res, 400, intervalo ? 'de e ate são obrigatórios no formato AAAA-MM-DD.' : 'data inválida. Use o formato AAAA-MM-DD.');
    }
    const dias = (new Date(`${ate}T00:00:00`) - new Date(`${de}T00:00:00`)) / 86400000;
    if (dias < 0) return erro(res, 400, 'ate tem de ser igual ou posterior a de.');
    if (dias > 31) return erro(res, 400, 'O intervalo pode ter no máximo 31 dias.');

    let sql = `SELECT f.*, p.nome AS professor_nome FROM faltas f JOIN professores p ON p.id = f.professor_id
               WHERE f.escola_id = ? AND f.data_falta BETWEEN ? AND ?`;
    const params = [req.escolaId, de, ate];
    if (req.query.professor_id) { sql += ' AND f.professor_id = ?'; params.push(req.query.professor_id); }
    sql += ' ORDER BY f.data_falta, p.nome, f.hora_inicio';

    const [faltas] = await pool.query(sql, params);
    res.json(faltas.map(formatarFalta));
  } catch (err) {
    next(err);
  }
});

// ---------- Registo ----------

// POST /api/faltas
// { professor_id, horario_id?, data_falta?, hora_inicio?, hora_fim?, tipo?, motivo?, justificada?, observacoes? }
router.post('/faltas', async (req, res, next) => {
  try {
    const body = req.body || {};
    const professorId = Number(body.professor_id);
    const horarioId = body.horario_id ? Number(body.horario_id) : null;
    const data = body.data_falta || new Date().toLocaleDateString('sv-SE');
    const tipo = body.tipo || 'falta';
    let horaInicio = body.hora_inicio || null;
    let horaFim = body.hora_fim || null;

    const erros = [];
    if (!Number.isInteger(professorId) || professorId <= 0) erros.push('professor_id é obrigatório.');
    if (!dataValida(data)) erros.push('data_falta inválida (AAAA-MM-DD).');
    if (!['falta', 'atraso'].includes(tipo)) erros.push("tipo deve ser 'falta' ou 'atraso'.");
    if (horaInicio && !HORA.test(horaInicio)) erros.push('hora_inicio inválida (HH:MM).');
    if (horaFim && !HORA.test(horaFim)) erros.push('hora_fim inválida (HH:MM).');
    if (body.motivo && String(body.motivo).length > 255) erros.push('motivo tem no máximo 255 caracteres.');
    if (erros.length) return erro(res, 400, 'Dados inválidos.', { detalhes: erros });

    const [[professor]] = await pool.query(
      'SELECT id, nome FROM professores WHERE id = ? AND escola_id = ? AND ativo = 1', [professorId, req.escolaId]
    );
    if (!professor) return erro(res, 404, 'Professor não encontrado ou inativo.');

    // Com horario_id, a falta fica ligada a essa aula e herda as horas
    if (horarioId) {
      const [[aula]] = await pool.query(
        'SELECT professor_id, dia_semana, hora_inicio, hora_fim FROM horarios WHERE id = ? AND escola_id = ?', [horarioId, req.escolaId]
      );
      if (!aula) return erro(res, 404, 'Aula (horario_id) não encontrada.');
      if (aula.professor_id !== professorId) return erro(res, 400, 'Essa aula não pertence a este professor.');
      horaInicio = horaInicio || aula.hora_inicio;
      horaFim = horaFim || aula.hora_fim;
    }
    if (horaInicio && horaFim && hhmm(horaFim) <= hhmm(horaInicio)) {
      return erro(res, 400, 'hora_fim tem de ser depois de hora_inicio.');
    }

    // Evita registos repetidos (o telemóvel pode reenviar o mesmo pedido)
    const [[repetida]] = await pool.query(
      `SELECT id FROM faltas
       WHERE professor_id = ? AND data_falta = ?
         AND ((? IS NOT NULL AND horario_id = ?) OR (? IS NULL AND horario_id IS NULL AND hora_inicio <=> ?))`,
      [professorId, data, horarioId, horarioId, horarioId, horaInicio]
    );
    if (repetida) return erro(res, 409, 'Esta falta já está registada.', { falta_id: repetida.id });

    const [resultado] = await pool.query(
      `INSERT INTO faltas (escola_id, professor_id, horario_id, data_falta, hora_inicio, hora_fim, tipo, motivo, justificada, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.escolaId, professorId, horarioId, data, horaInicio, horaFim, tipo,
        body.motivo ? String(body.motivo).trim() : null,
        body.justificada ? 1 : 0,
        body.observacoes ? String(body.observacoes).slice(0, 2000) : null
      ]
    );

    const [[falta]] = await pool.query(
      'SELECT f.*, p.nome AS professor_nome FROM faltas f JOIN professores p ON p.id = f.professor_id WHERE f.id = ?',
      [resultado.insertId]
    );
    res.status(201).json(formatarFalta(falta));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/faltas/:id  -> anula uma falta registada por engano (o "Desfazer" da aplicação).
// Só faltas dos últimos 7 dias e ainda não justificadas; as restantes gerem-se no site da escola.
router.delete('/faltas/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return erro(res, 404, 'Falta não encontrada.');

    const [[falta]] = await pool.query(
      `SELECT id, justificada, data_falta >= CURDATE() - INTERVAL 7 DAY AS recente
       FROM faltas WHERE id = ? AND escola_id = ?`, [id, req.escolaId]
    );
    if (!falta) return erro(res, 404, 'Falta não encontrada.');
    if (falta.justificada) return erro(res, 409, 'Esta falta já foi justificada pela secretaria; só pode ser alterada no site da escola.');
    if (!falta.recente) return erro(res, 409, 'Só é possível anular faltas dos últimos 7 dias; as mais antigas gerem-se no site da escola.');

    await pool.query('DELETE FROM faltas WHERE id = ? AND escola_id = ?', [id, req.escolaId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.use((req, res) => erro(res, 404, 'Endpoint não encontrado.'));

// Erros da API em JSON (montado em server.js depois do express.json, para apanhar também JSON mal formado)
// eslint-disable-next-line no-unused-vars
function errosApi(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return erro(res, 400, 'JSON inválido no corpo do pedido.');
  if (err.type === 'entity.too.large') return erro(res, 413, 'Pedido demasiado grande.');
  console.error(err);
  return erro(res, 500, 'Erro interno do servidor.');
}

module.exports = { router, errosApi };
