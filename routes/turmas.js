const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ANOS_ESCOLARES, LETRAS_TURMA, NOME_TURMA_VALIDO, partesTurma, nomeTurma } = require('../config/ui');

// Formulário com dois dropdowns (Ano + Turma); o nome "10ºA" é montado a partir deles.
// Na Turma há a opção "Outro nome", para turmas como "10º ASIBD1".
function renderForm(res, turma, error) {
  const partes = turma.ano || turma.letra ? { ano: turma.ano, letra: turma.turmaEscolhida } : partesTurma(turma.nome);
  res.render('turmas/form', {
    pageTitle: turma.id ? 'Editar Turma' : 'Nova Turma',
    activePage: 'turmas',
    turma,
    partes,
    anos: ANOS_ESCOLARES,
    letras: LETRAS_TURMA,
    error
  });
}

function dadosDoForm(body) {
  const personalizado = body.letra === 'outro';
  const turmaEscolhida = personalizado ? String(body.nome_personalizado || '').trim() : body.letra;

  let erro = null;
  if (!body.ano || !turmaEscolhida) {
    erro = personalizado ? 'Escreva o nome da turma.' : 'Escolha o ano e a turma.';
  } else if (personalizado && !NOME_TURMA_VALIDO.test(turmaEscolhida)) {
    erro = 'O nome da turma só pode ter letras, números, espaços e hífens (até 20 caracteres).';
  }

  return { ...body, turmaEscolhida, nome: erro ? '' : nomeTurma(body.ano, turmaEscolhida), erro };
}

// LISTAR
router.get('/', async (req, res, next) => {
  try {
    const [turmas] = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM professor_turmas pt WHERE pt.turma_id = t.id) AS total_professores,
        (SELECT COUNT(*) FROM horarios h WHERE h.turma_id = t.id) AS total_aulas
      FROM turmas t
      WHERE t.escola_id = ?
      ORDER BY t.nome ASC
    `, [req.escolaId]);

    res.render('turmas/list', {
      pageTitle: 'Turmas',
      activePage: 'turmas',
      turmas,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

// FORMULÁRIO NOVA
router.get('/novo', (req, res) => {
  renderForm(res, {}, null);
});

// CRIAR
router.post('/', async (req, res, next) => {
  const turma = dadosDoForm(req.body);
  try {
    if (turma.erro) return renderForm(res, turma, turma.erro);
    await pool.query('INSERT INTO turmas (escola_id, nome, ano_letivo) VALUES (?, ?, ?)', [req.escolaId, turma.nome, turma.ano_letivo || '2025/2026']);
    res.redirect(`/turmas?success=${encodeURIComponent(`Turma ${turma.nome} criada com sucesso.`)}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(res, turma, `Já existe a turma ${turma.nome}.`);
    next(err);
  }
});

// FORMULÁRIO EDITAR
router.get('/:id/editar', async (req, res, next) => {
  try {
    const [[turma]] = await pool.query('SELECT * FROM turmas WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    if (!turma) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    renderForm(res, turma, null);
  } catch (err) {
    next(err);
  }
});

// ATUALIZAR
router.put('/:id', async (req, res, next) => {
  const turma = { ...dadosDoForm(req.body), id: req.params.id };
  try {
    if (turma.erro) return renderForm(res, turma, turma.erro);
    await pool.query('UPDATE turmas SET nome = ?, ano_letivo = ? WHERE id = ? AND escola_id = ?', [turma.nome, turma.ano_letivo || '2025/2026', req.params.id, req.escolaId]);
    res.redirect(`/turmas?success=${encodeURIComponent(`Turma ${turma.nome} atualizada com sucesso.`)}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(res, turma, `Já existe a turma ${turma.nome}.`);
    next(err);
  }
});

// ELIMINAR
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM turmas WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]);
    res.redirect('/turmas?success=Turma eliminada.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
