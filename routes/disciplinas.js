const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// LISTAR
router.get('/', async (req, res, next) => {
  try {
    const [disciplinas] = await pool.query(`
      SELECT d.*,
        (SELECT COUNT(*) FROM professor_disciplinas pd WHERE pd.disciplina_id = d.id) AS total_professores,
        (SELECT COUNT(*) FROM horarios h WHERE h.disciplina_id = d.id) AS total_aulas
      FROM disciplinas d
      WHERE d.escola_id = ?
      ORDER BY d.nome ASC
    `, [req.escolaId]);

    res.render('disciplinas/list', {
      pageTitle: 'Disciplinas',
      activePage: 'disciplinas',
      disciplinas,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

// FORMULÁRIO NOVA
router.get('/novo', (req, res) => {
  res.render('disciplinas/form', {
    pageTitle: 'Nova Disciplina',
    activePage: 'disciplinas',
    disciplina: {},
    error: null
  });
});

// CRIAR
router.post('/', async (req, res, next) => {
  try {
    const { nome } = req.body;
    if (!nome) {
      return res.render('disciplinas/form', {
        pageTitle: 'Nova Disciplina',
        activePage: 'disciplinas',
        disciplina: req.body,
        error: 'O nome da disciplina é obrigatório.'
      });
    }
    await pool.query('INSERT INTO disciplinas (escola_id, nome) VALUES (?, ?)', [req.escolaId, nome]);
    res.redirect('/disciplinas?success=Disciplina criada com sucesso.');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.render('disciplinas/form', {
        pageTitle: 'Nova Disciplina',
        activePage: 'disciplinas',
        disciplina: req.body,
        error: 'Já existe uma disciplina com esse nome.'
      });
    }
    next(err);
  }
});

// FORMULÁRIO EDITAR
router.get('/:id/editar', async (req, res, next) => {
  try {
    const [[disciplina]] = await pool.query('SELECT * FROM disciplinas WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    if (!disciplina) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    res.render('disciplinas/form', {
      pageTitle: 'Editar Disciplina',
      activePage: 'disciplinas',
      disciplina,
      error: null
    });
  } catch (err) {
    next(err);
  }
});

// ATUALIZAR
router.put('/:id', async (req, res, next) => {
  try {
    const { nome } = req.body;
    if (!nome) {
      return res.render('disciplinas/form', {
        pageTitle: 'Editar Disciplina',
        activePage: 'disciplinas',
        disciplina: { ...req.body, id: req.params.id },
        error: 'O nome da disciplina é obrigatório.'
      });
    }
    await pool.query('UPDATE disciplinas SET nome = ? WHERE id = ? AND escola_id = ?', [nome, req.params.id, req.escolaId]);
    res.redirect('/disciplinas?success=Disciplina atualizada com sucesso.');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.render('disciplinas/form', {
        pageTitle: 'Editar Disciplina',
        activePage: 'disciplinas',
        disciplina: { ...req.body, id: req.params.id },
        error: 'Já existe uma disciplina com esse nome.'
      });
    }
    next(err);
  }
});

// ELIMINAR
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM disciplinas WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    res.redirect('/disciplinas?success=Disciplina eliminada.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
