const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { DIAS_SEMANA, montarGrelha, temposDaEscola } = require('../config/horarioSlots');
const { diasUteisMes } = require('../config/ui');

// Todas as consultas são da escola de quem tem sessão iniciada (req.escolaId)

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function getCatalogo(escolaId) {
  const [disciplinas] = await pool.query('SELECT id, nome FROM disciplinas WHERE escola_id = ? ORDER BY nome ASC', [escolaId]);
  const [turmas] = await pool.query('SELECT id, nome FROM turmas WHERE escola_id = ? ORDER BY nome ASC', [escolaId]);
  return { disciplinas, turmas };
}

async function professorDaEscola(id, escolaId) {
  const [[professor]] = await pool.query('SELECT * FROM professores WHERE id = ? AND escola_id = ?', [id, escolaId]);
  return professor || null;
}

// Mantém só os ids que pertencem à escola (evita ligar disciplinas/turmas de outra escola)
async function idsDaEscola(tabela, ids, escolaId) {
  if (!ids.length) return [];
  const [linhas] = await pool.query(`SELECT id FROM ${tabela} WHERE escola_id = ? AND id IN (?)`, [escolaId, ids]);
  return linhas.map((l) => l.id);
}

async function syncRelacoes(escolaId, professorId, disciplinaIds, turmaIds) {
  const disciplinas = await idsDaEscola('disciplinas', disciplinaIds, escolaId);
  const turmas = await idsDaEscola('turmas', turmaIds, escolaId);

  await pool.query('DELETE FROM professor_disciplinas WHERE professor_id = ?', [professorId]);
  await pool.query('DELETE FROM professor_turmas WHERE professor_id = ?', [professorId]);

  if (disciplinas.length) {
    await pool.query('INSERT INTO professor_disciplinas (professor_id, disciplina_id) VALUES ?', [disciplinas.map((id) => [professorId, id])]);
  }
  if (turmas.length) {
    await pool.query('INSERT INTO professor_turmas (professor_id, turma_id) VALUES ?', [turmas.map((id) => [professorId, id])]);
  }
}

async function renderForm(req, res, professor, selecionadas, error) {
  const catalogo = await getCatalogo(req.escolaId);
  res.render('professores/form', {
    pageTitle: professor.id ? 'Editar Professor' : 'Novo Professor',
    activePage: 'professores',
    professor,
    selecionadas,
    ...catalogo,
    error
  });
}

const naoEncontrado = (res) => res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });

// LISTAR + PESQUISAR
router.get('/', async (req, res, next) => {
  try {
    const termo = (req.query.q || '').trim();

    let sql = `
      SELECT p.*,
        (SELECT COUNT(*) FROM faltas f WHERE f.professor_id = p.id) AS total_faltas,
        (SELECT COUNT(*) FROM faltas f WHERE f.professor_id = p.id
           AND MONTH(f.data_falta) = MONTH(CURDATE()) AND YEAR(f.data_falta) = YEAR(CURDATE())) AS faltas_mes,
        (SELECT GROUP_CONCAT(d.nome ORDER BY d.nome SEPARATOR ', ')
           FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
           WHERE pd.professor_id = p.id) AS disciplinas,
        (SELECT GROUP_CONCAT(t.nome ORDER BY t.nome SEPARATOR ', ')
           FROM professor_turmas pt JOIN turmas t ON t.id = pt.turma_id
           WHERE pt.professor_id = p.id) AS turmas
      FROM professores p
      WHERE p.escola_id = ?
    `;
    const params = [req.escolaId];

    if (termo) {
      sql += ` AND (p.nome LIKE ? OR p.email LIKE ?
                OR EXISTS (SELECT 1 FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
                           WHERE pd.professor_id = p.id AND d.nome LIKE ?)) `;
      params.push(`%${termo}%`, `%${termo}%`, `%${termo}%`);
    }

    sql += ' ORDER BY p.nome ASC';

    const [todos] = await pool.query(sql, params);

    // Assiduidade do mês: 1 - faltas / dias úteis do mês
    const diasUteis = diasUteisMes();
    todos.forEach((p) => {
      p.assiduidade = Math.max(0, Math.round((1 - p.faltas_mes / diasUteis) * 100));
    });

    const POR_PAGINA = 8;
    const totalPaginas = Math.max(1, Math.ceil(todos.length / POR_PAGINA));
    const pagina = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), totalPaginas);
    const inicio = (pagina - 1) * POR_PAGINA;
    const professores = todos.slice(inicio, inicio + POR_PAGINA);

    res.render('professores/list', {
      pageTitle: 'Professores',
      activePage: 'professores',
      professores,
      paginacao: {
        pagina,
        totalPaginas,
        total: todos.length,
        de: todos.length ? inicio + 1 : 0,
        ate: inicio + professores.length
      },
      termo,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

// FORMULÁRIO NOVO
router.get('/novo', async (req, res, next) => {
  try {
    await renderForm(req, res, {}, { disciplinas: [], turmas: [] }, null);
  } catch (err) {
    next(err);
  }
});

// CRIAR
router.post('/', async (req, res, next) => {
  const { nome, email, telefone, data_admissao, ativo } = req.body;
  const disciplinaIds = toArray(req.body.disciplinas).map(Number);
  const turmaIds = toArray(req.body.turmas).map(Number);
  const selecionadas = { disciplinas: disciplinaIds, turmas: turmaIds };
  try {
    if (!nome || disciplinaIds.length === 0) {
      return renderForm(req, res, req.body, selecionadas, 'Nome e pelo menos uma disciplina são obrigatórios.');
    }

    const [result] = await pool.query(
      `INSERT INTO professores (escola_id, nome, email, telefone, data_admissao, ativo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.escolaId, nome, email || null, telefone || null, data_admissao || null, ativo ? 1 : 0]
    );

    await syncRelacoes(req.escolaId, result.insertId, disciplinaIds, turmaIds);

    // Segue logo para a grelha do horário do novo professor
    res.redirect(`/professores/${result.insertId}?tab=horario&success=${encodeURIComponent('Professor criado. Clique nos blocos da grelha para atribuir o horário.')}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(req, res, req.body, selecionadas, 'Já existe um professor com esse email.');
    next(err);
  }
});

// PERFIL DO PROFESSOR (com separadores)
router.get('/:id', async (req, res, next) => {
  try {
    const professor = await professorDaEscola(req.params.id, req.escolaId);
    if (!professor) return naoEncontrado(res);

    const [disciplinas] = await pool.query(
      `SELECT d.* FROM disciplinas d
       JOIN professor_disciplinas pd ON pd.disciplina_id = d.id
       WHERE pd.professor_id = ? ORDER BY d.nome`,
      [professor.id]
    );
    const [turmas] = await pool.query(
      `SELECT t.* FROM turmas t
       JOIN professor_turmas pt ON pt.turma_id = t.id
       WHERE pt.professor_id = ? ORDER BY t.nome`,
      [professor.id]
    );
    const [faltas] = await pool.query(
      'SELECT * FROM faltas WHERE professor_id = ? ORDER BY data_falta DESC, id DESC',
      [professor.id]
    );
    const [horarios] = await pool.query(
      `SELECT h.*, d.nome AS disciplina_nome, t.nome AS turma_nome
       FROM horarios h
       JOIN disciplinas d ON d.id = h.disciplina_id
       JOIN turmas t ON t.id = h.turma_id
       WHERE h.professor_id = ?`,
      [professor.id]
    );

    const totalFaltas = faltas.length;
    const totalJustificadas = faltas.filter((f) => f.justificada).length;

    const tempos = await temposDaEscola(req.escolaId);
    const { grelha, blocosOcupados, totalBlocos } = montarGrelha(horarios, tempos);

    // Opções do modal da grelha: as turmas e disciplinas do professor aparecem primeiro
    const catalogo = await getCatalogo(req.escolaId);
    const idsTurmas = turmas.map((t) => t.id);
    const idsDisciplinas = disciplinas.map((d) => d.id);
    const opcoesHorario = {
      turmas: catalogo.turmas.map((t) => ({ id: t.id, nome: t.nome, principal: idsTurmas.includes(t.id) })),
      disciplinas: catalogo.disciplinas.map((d) => ({ id: d.id, nome: d.nome, principal: idsDisciplinas.includes(d.id) }))
    };

    const tabsValidas = ['resumo', 'horario', 'faltas', 'disciplinas', 'turmas'];
    const tab = tabsValidas.includes(req.query.tab) ? req.query.tab : 'resumo';

    res.render('professores/show', {
      pageTitle: professor.nome,
      activePage: 'professores',
      professor,
      disciplinas,
      turmas,
      faltas,
      horarios,
      grelha,
      resumoHorario: { blocosOcupados, totalBlocos },
      opcoesHorario,
      diasSemana: DIAS_SEMANA,
      slots: tempos,
      totalFaltas,
      totalJustificadas,
      tab,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

// FORMULÁRIO EDITAR
router.get('/:id/editar', async (req, res, next) => {
  try {
    const professor = await professorDaEscola(req.params.id, req.escolaId);
    if (!professor) return naoEncontrado(res);

    const [disciplinasSel] = await pool.query('SELECT disciplina_id FROM professor_disciplinas WHERE professor_id = ?', [professor.id]);
    const [turmasSel] = await pool.query('SELECT turma_id FROM professor_turmas WHERE professor_id = ?', [professor.id]);

    await renderForm(req, res, professor, {
      disciplinas: disciplinasSel.map((r) => r.disciplina_id),
      turmas: turmasSel.map((r) => r.turma_id)
    }, null);
  } catch (err) {
    next(err);
  }
});

// ATUALIZAR
router.put('/:id', async (req, res, next) => {
  const { nome, email, telefone, data_admissao, ativo } = req.body;
  const disciplinaIds = toArray(req.body.disciplinas).map(Number);
  const turmaIds = toArray(req.body.turmas).map(Number);
  const selecionadas = { disciplinas: disciplinaIds, turmas: turmaIds };
  const professorForm = { ...req.body, id: req.params.id };
  try {
    const professor = await professorDaEscola(req.params.id, req.escolaId);
    if (!professor) return naoEncontrado(res);

    if (!nome || disciplinaIds.length === 0) {
      return renderForm(req, res, professorForm, selecionadas, 'Nome e pelo menos uma disciplina são obrigatórios.');
    }

    await pool.query(
      `UPDATE professores SET nome = ?, email = ?, telefone = ?, data_admissao = ?, ativo = ?
       WHERE id = ? AND escola_id = ?`,
      [nome, email || null, telefone || null, data_admissao || null, ativo ? 1 : 0, professor.id, req.escolaId]
    );

    await syncRelacoes(req.escolaId, professor.id, disciplinaIds, turmaIds);

    res.redirect(`/professores/${professor.id}?success=Dados atualizados com sucesso.`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(req, res, professorForm, selecionadas, 'Já existe um professor com esse email.');
    next(err);
  }
});

// ELIMINAR
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM professores WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    res.redirect('/professores?success=Professor eliminado.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
