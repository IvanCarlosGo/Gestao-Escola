const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { DIAS_SEMANA, SLOTS, labelDia, montarGrelha } = require('../config/horarioSlots');
const { partesTurma } = require('../config/ui');

const hhmm = (hora) => String(hora || '').slice(0, 5);

// Volta à grelha de onde veio o pedido: a da turma (/horarios) ou a do perfil do professor (campo "redirect")
function redirectGrelha(req, res, turmaId, chave, mensagem) {
  const destino = req.body && typeof req.body.redirect === 'string' && /^\/(?!\/)/.test(req.body.redirect)
    ? req.body.redirect
    : null;
  const [caminho, qs] = (destino || '/horarios').split('?');
  const query = new URLSearchParams(qs || '');
  if (!destino && turmaId) query.set('turma_id', turmaId);
  query.set(chave, mensagem);
  res.redirect(`${caminho}?${query.toString()}`);
}

// Devolve uma mensagem de erro se a aula colidir com outra da turma, do professor ou da sala
async function verificarConflitos(escolaId, { id, turma_id, professor_id, dia_semana, hora_inicio, hora_fim, sala }) {
  const [sobrepostas] = await pool.query(
    `SELECT h.*, p.nome AS professor_nome, d.nome AS disciplina_nome, t.nome AS turma_nome
     FROM horarios h
     JOIN professores p ON p.id = h.professor_id
     JOIN disciplinas d ON d.id = h.disciplina_id
     JOIN turmas t ON t.id = h.turma_id
     WHERE h.escola_id = ? AND h.dia_semana = ? AND h.hora_inicio < ? AND h.hora_fim > ? AND h.id <> ?`,
    [escolaId, dia_semana, hora_fim, hora_inicio, id || 0]
  );

  const intervalo = (h) => `${hhmm(h.hora_inicio)}–${hhmm(h.hora_fim)}`;

  const daTurma = sobrepostas.find((h) => String(h.turma_id) === String(turma_id));
  if (daTurma) {
    return `O ${daTurma.turma_nome} já tem ${daTurma.disciplina_nome} (${daTurma.professor_nome}) das ${intervalo(daTurma)}.`;
  }

  const doProfessor = sobrepostas.find((h) => String(h.professor_id) === String(professor_id));
  if (doProfessor) {
    return `${doProfessor.professor_nome} já tem aula no ${doProfessor.turma_nome} das ${intervalo(doProfessor)}.`;
  }

  const salaNorm = String(sala || '').trim().toLowerCase();
  if (salaNorm) {
    const daSala = sobrepostas.find((h) => String(h.sala || '').trim().toLowerCase() === salaNorm);
    if (daSala) {
      return `A ${daSala.sala} já está ocupada pelo ${daSala.turma_nome} das ${intervalo(daSala)}.`;
    }
  }

  return null;
}

// Professor, disciplina e turma têm de pertencer à escola de quem guarda a aula
async function daEscola(escolaId, { professor_id, disciplina_id, turma_id }) {
  const [[r]] = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM professores WHERE id = ? AND escola_id = ?) AS p,
      (SELECT COUNT(*) FROM disciplinas WHERE id = ? AND escola_id = ?) AS d,
      (SELECT COUNT(*) FROM turmas WHERE id = ? AND escola_id = ?) AS t`,
    [professor_id, escolaId, disciplina_id, escolaId, turma_id, escolaId]
  );
  return r.p > 0 && r.d > 0 && r.t > 0;
}

function validarAula(body) {
  const { professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim } = body;
  if (!professor_id || !disciplina_id || !turma_id || !dia_semana || !hora_inicio || !hora_fim) {
    return 'Preencha a disciplina, o professor e o horário da aula.';
  }
  if (!DIAS_SEMANA.some((d) => d.key === dia_semana)) return 'Dia da semana inválido.';
  if (hhmm(hora_fim) <= hhmm(hora_inicio)) return 'A hora de fim tem de ser depois da hora de início.';
  return null;
}

// GRELHA SEMANAL DA TURMA
router.get('/', async (req, res, next) => {
  try {
    const [turmas] = await pool.query(
      `SELECT t.id, t.nome, t.ano_letivo,
        (SELECT COUNT(*) FROM horarios h WHERE h.turma_id = t.id) AS total_aulas
       FROM turmas t WHERE t.escola_id = ? ORDER BY t.nome ASC`,
      [req.escolaId]
    );

    // Seletor em dois passos: Ano -> Turma (turmas com nome fora do formato ficam em "Outras")
    turmas.forEach((t) => {
      const { ano, letra } = partesTurma(t.nome);
      t.ano = ano || 'outras';
      t.letra = letra || t.nome;
    });
    turmas.sort((a, b) => (Number(a.ano) || 99) - (Number(b.ano) || 99) || a.letra.localeCompare(b.letra));
    const anos = [...new Set(turmas.map((t) => t.ano))];

    const turma = turmas.find((t) => String(t.id) === String(req.query.turma_id)) || turmas[0] || null;

    let aulas = [];
    let professoresTurma = [];
    if (turma) {
      [aulas] = await pool.query(
        `SELECT h.*, p.nome AS professor_nome, d.nome AS disciplina_nome
         FROM horarios h
         JOIN professores p ON p.id = h.professor_id
         JOIN disciplinas d ON d.id = h.disciplina_id
         WHERE h.turma_id = ?
         ORDER BY h.hora_inicio ASC`,
        [turma.id]
      );

      [professoresTurma] = await pool.query(
        `SELECT p.id, p.nome,
          (SELECT GROUP_CONCAT(d.nome ORDER BY d.nome SEPARATOR ', ')
             FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
             WHERE pd.professor_id = p.id) AS disciplinas,
          (SELECT COUNT(*) FROM horarios h WHERE h.professor_id = p.id AND h.turma_id = ?) AS aulas_turma
         FROM professores p
         JOIN professor_turmas pt ON pt.professor_id = p.id AND pt.turma_id = ?
         WHERE p.ativo = 1
         ORDER BY p.nome ASC`,
        [turma.id, turma.id]
      );
    }

    const { grelha, blocosOcupados, totalBlocos } = montarGrelha(aulas);

    // Disciplinas e professores para o modal: quem dá cada disciplina, e quem está ligado à turma
    const [disciplinas] = await pool.query('SELECT id, nome FROM disciplinas WHERE escola_id = ? ORDER BY nome ASC', [req.escolaId]);
    const [professores] = await pool.query('SELECT id, nome FROM professores WHERE escola_id = ? AND ativo = 1 ORDER BY nome ASC', [req.escolaId]);
    const [ligacoes] = await pool.query(
      `SELECT pd.disciplina_id, pd.professor_id
       FROM professor_disciplinas pd JOIN professores p ON p.id = pd.professor_id AND p.ativo = 1
       WHERE p.escola_id = ?`,
      [req.escolaId]
    );
    const idsTurma = professoresTurma.map((p) => p.id);

    const opcoes = {
      disciplinas: disciplinas.map((d) => {
        const profs = ligacoes.filter((l) => l.disciplina_id === d.id).map((l) => l.professor_id);
        return {
          id: d.id,
          nome: d.nome,
          professores: profs,
          principal: profs.some((id) => idsTurma.includes(id))
        };
      }),
      professores,
      professoresTurma: idsTurma
    };

    res.render('horarios/list', {
      pageTitle: 'Horários',
      activePage: 'horarios',
      turmas,
      anos,
      turma,
      grelha,
      slots: SLOTS,
      diasSemana: DIAS_SEMANA,
      professoresTurma,
      resumo: { totalAulas: aulas.length, blocosOcupados, totalBlocos },
      opcoes,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

// CRIAR AULA
router.post('/', async (req, res, next) => {
  try {
    const { professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala } = req.body;

    const invalido = validarAula(req.body);
    if (invalido) return redirectGrelha(req, res, turma_id, 'error', invalido);


    if (!(await daEscola(req.escolaId, req.body))) {
      return redirectGrelha(req, res, turma_id, 'error', 'Professor, disciplina ou turma inválidos.');
    }

    const conflito = await verificarConflitos(req.escolaId, req.body);
    if (conflito) return redirectGrelha(req, res, turma_id, 'error', `Não foi possível guardar: ${conflito}`);

    await pool.query(
      `INSERT INTO horarios (escola_id, professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.escolaId, professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala ? sala.trim() : null]
    );

    redirectGrelha(req, res, turma_id, 'success', `Aula adicionada: ${labelDia(dia_semana)}, ${hhmm(hora_inicio)}–${hhmm(hora_fim)}.`);
  } catch (err) {
    next(err);
  }
});

// ATUALIZAR AULA
router.put('/:id', async (req, res, next) => {
  try {
    const { professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala } = req.body;

    const invalido = validarAula(req.body);
    if (invalido) return redirectGrelha(req, res, turma_id, 'error', invalido);


    if (!(await daEscola(req.escolaId, req.body))) {
      return redirectGrelha(req, res, turma_id, 'error', 'Professor, disciplina ou turma inválidos.');
    }

    const conflito = await verificarConflitos(req.escolaId, { ...req.body, id: req.params.id });
    if (conflito) return redirectGrelha(req, res, turma_id, 'error', `Não foi possível guardar: ${conflito}`);

    await pool.query(
      `UPDATE horarios SET professor_id = ?, disciplina_id = ?, turma_id = ?, dia_semana = ?,
        hora_inicio = ?, hora_fim = ?, sala = ? WHERE id = ? AND escola_id = ?`,
      [professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala ? sala.trim() : null, req.params.id, req.escolaId]
    );

    redirectGrelha(req, res, turma_id, 'success', 'Aula atualizada.');
  } catch (err) {
    next(err);
  }
});

// ELIMINAR AULA
router.delete('/:id', async (req, res, next) => {
  try {
    const [[aula]] = await pool.query('SELECT turma_id FROM horarios WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    await pool.query('DELETE FROM horarios WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    redirectGrelha(req, res, aula && aula.turma_id, 'success', 'Aula eliminada.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
