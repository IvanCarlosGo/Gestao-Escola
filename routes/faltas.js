const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

const DISCIPLINAS_SUBQ = `(SELECT GROUP_CONCAT(d.nome ORDER BY d.nome SEPARATOR ', ')
   FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
   WHERE pd.professor_id = p.id) AS disciplinas`;

// LISTAR + FILTROS (Histórico de Faltas)
router.get('/', async (req, res, next) => {
  try {
    const { professor_id, status, tipo, data_inicio, data_fim } = req.query;

    let sql = `
      SELECT f.*, p.nome AS professor_nome, ${DISCIPLINAS_SUBQ}
      FROM faltas f
      JOIN professores p ON p.id = f.professor_id
      WHERE f.escola_id = ?
    `;
    const params = [req.escolaId];

    if (professor_id) {
      sql += ' AND f.professor_id = ? ';
      params.push(professor_id);
    }
    if (status === 'justificada') {
      sql += ' AND f.justificada = 1 ';
    } else if (status === 'injustificada') {
      sql += ' AND f.justificada = 0 ';
    }
    if (tipo) {
      sql += ' AND f.tipo = ? ';
      params.push(tipo);
    }
    if (data_inicio) {
      sql += ' AND f.data_falta >= ? ';
      params.push(data_inicio);
    }
    if (data_fim) {
      sql += ' AND f.data_falta <= ? ';
      params.push(data_fim);
    }

    sql += ' ORDER BY f.data_falta DESC, f.id DESC';

    const [faltas] = await pool.query(sql, params);
    const [professores] = await pool.query('SELECT id, nome FROM professores WHERE escola_id = ? ORDER BY nome ASC', [req.escolaId]);

    res.render('faltas/list', {
      pageTitle: 'Registos de Faltas',
      activePage: 'historico',
      faltas,
      professores,
      filtros: { professor_id, status, tipo, data_inicio, data_fim },
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
    const [[falta]] = await pool.query('SELECT * FROM faltas WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    if (!falta) {
      return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    }
    const [professores] = await pool.query(
      `SELECT p.id, p.nome, ${DISCIPLINAS_SUBQ} FROM professores p WHERE p.escola_id = ? ORDER BY p.nome ASC`,
      [req.escolaId]
    );

    res.render('faltas/form', {
      pageTitle: 'Editar Falta',
      activePage: 'historico',
      falta,
      professores,
      error: null
    });
  } catch (err) {
    next(err);
  }
});

// ATUALIZAR
router.put('/:id', async (req, res, next) => {
  try {
    const {
      professor_id, data_falta, hora_inicio, hora_fim,
      tipo, motivo, justificada, substituto, observacoes
    } = req.body;

    // O professor tem de ser da mesma escola
    const [[professorValido]] = professor_id
      ? await pool.query('SELECT id FROM professores WHERE id = ? AND escola_id = ?', [professor_id, req.escolaId])
      : [[null]];

    if (!professorValido || !data_falta) {
      const [professores] = await pool.query(
        `SELECT p.id, p.nome, ${DISCIPLINAS_SUBQ} FROM professores p WHERE p.escola_id = ? ORDER BY p.nome ASC`,
        [req.escolaId]
      );
      return res.render('faltas/form', {
        pageTitle: 'Editar Falta',
        activePage: 'historico',
        falta: { ...req.body, id: req.params.id },
        professores,
        error: 'Professor e data da falta são obrigatórios.'
      });
    }

    await pool.query(
      `UPDATE faltas SET professor_id = ?, data_falta = ?, hora_inicio = ?, hora_fim = ?,
        tipo = ?, motivo = ?, justificada = ?, substituto = ?, observacoes = ?
       WHERE id = ? AND escola_id = ?`,
      [
        professor_id, data_falta, hora_inicio || null, hora_fim || null,
        tipo || 'falta', motivo || null, justificada ? 1 : 0,
        substituto || null, observacoes || null, req.params.id, req.escolaId
      ]
    );

    res.redirect('/faltas?success=Falta atualizada com sucesso.');
  } catch (err) {
    next(err);
  }
});

// ALTERNAR JUSTIFICADA (ação rápida)
router.post('/:id/justificar', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE faltas SET justificada = NOT justificada WHERE id = ? AND escola_id = ?',
      [req.params.id, req.escolaId]
    );
    res.redirect(req.get('Referrer') || '/faltas');
  } catch (err) {
    next(err);
  }
});

// ELIMINAR
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM faltas WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    res.redirect('/faltas?success=Falta eliminada.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
