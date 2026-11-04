// Gestão de utilizadores da escola (só Administrador — garantido por verificarPermissao).
// Cada escola só vê e altera as suas contas (req.escolaId).
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { PERFIS, hashPalavraPasse, validarNovaPalavraPasse } = require('../config/auth');

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function renderForm(res, conta, error) {
  res.render('utilizadores/form', {
    pageTitle: conta.id ? 'Editar Utilizador' : 'Novo Utilizador',
    activePage: 'utilizadores',
    conta,
    perfis: PERFIS,
    error
  });
}

// Impede ficar sem nenhum administrador ativo
async function ultimoAdmin(escolaId, id) {
  const [[{ total }]] = await pool.query(
    "SELECT COUNT(*) AS total FROM utilizadores WHERE escola_id = ? AND perfil = 'admin' AND ativo = 1 AND id <> ?", [escolaId, id]
  );
  return total === 0;
}

router.get('/', async (req, res, next) => {
  try {
    const [contas] = await pool.query(
      'SELECT id, nome, email, perfil, ativo, criado_em FROM utilizadores WHERE escola_id = ? ORDER BY nome ASC', [req.escolaId]
    );
    res.render('utilizadores/list', {
      pageTitle: 'Utilizadores',
      activePage: 'utilizadores',
      contas,
      perfis: PERFIS,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

router.get('/novo', (req, res) => renderForm(res, { perfil: 'secretaria', ativo: 1 }, null));

router.post('/', async (req, res, next) => {
  const conta = { ...req.body, email: String(req.body.email || '').trim().toLowerCase(), ativo: req.body.ativo ? 1 : 0 };
  try {
    if (!conta.nome || !EMAIL_VALIDO.test(conta.email)) return renderForm(res, conta, 'Indique o nome e um email válido.');
    if (!PERFIS[conta.perfil]) return renderForm(res, conta, 'Perfil inválido.');
    const erroPalavraPasse = validarNovaPalavraPasse(conta.palavra_passe);
    if (erroPalavraPasse) return renderForm(res, conta, erroPalavraPasse);

    await pool.query(
      'INSERT INTO utilizadores (escola_id, nome, email, palavra_passe, perfil, ativo) VALUES (?, ?, ?, ?, ?, ?)',
      [req.escolaId, conta.nome.trim(), conta.email, hashPalavraPasse(conta.palavra_passe), conta.perfil, conta.ativo]
    );
    res.redirect(`/utilizadores?success=${encodeURIComponent(`Utilizador ${conta.nome} criado.`)}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(res, conta, 'Já existe um utilizador com esse email.');
    next(err);
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const [[conta]] = await pool.query(
      'SELECT id, nome, email, perfil, ativo FROM utilizadores WHERE id = ? AND escola_id = ?', [req.params.id, req.escolaId]
    );
    if (!conta) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    renderForm(res, conta, null);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const conta = { ...req.body, id, email: String(req.body.email || '').trim().toLowerCase(), ativo: req.body.ativo ? 1 : 0 };
  try {
    const [[existente]] = await pool.query('SELECT id FROM utilizadores WHERE id = ? AND escola_id = ?', [id, req.escolaId]);
    if (!existente) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    if (!conta.nome || !EMAIL_VALIDO.test(conta.email)) return renderForm(res, conta, 'Indique o nome e um email válido.');
    if (!PERFIS[conta.perfil]) return renderForm(res, conta, 'Perfil inválido.');
    if ((conta.perfil !== 'admin' || !conta.ativo) && await ultimoAdmin(req.escolaId, id)) {
      return renderForm(res, conta, 'Tem de existir pelo menos um administrador ativo.');
    }

    // Palavra-passe só muda se for preenchida
    if (conta.palavra_passe) {
      const erroPalavraPasse = validarNovaPalavraPasse(conta.palavra_passe);
      if (erroPalavraPasse) return renderForm(res, conta, erroPalavraPasse);
      await pool.query('UPDATE utilizadores SET palavra_passe = ? WHERE id = ? AND escola_id = ?', [hashPalavraPasse(conta.palavra_passe), id, req.escolaId]);
    }

    await pool.query(
      'UPDATE utilizadores SET nome = ?, email = ?, perfil = ?, ativo = ? WHERE id = ? AND escola_id = ?',
      [conta.nome.trim(), conta.email, conta.perfil, conta.ativo, id, req.escolaId]
    );
    res.redirect(`/utilizadores?success=${encodeURIComponent(`Utilizador ${conta.nome} atualizado.`)}`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(res, conta, 'Já existe um utilizador com esse email.');
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.utilizador.id) return res.redirect(`/utilizadores?error=${encodeURIComponent('Não pode eliminar a sua própria conta.')}`);
    const [[conta]] = await pool.query('SELECT perfil FROM utilizadores WHERE id = ? AND escola_id = ?', [id, req.escolaId]);
    if (conta && conta.perfil === 'admin' && await ultimoAdmin(req.escolaId, id)) {
      return res.redirect(`/utilizadores?error=${encodeURIComponent('Tem de existir pelo menos um administrador ativo.')}`);
    }
    await pool.query('DELETE FROM utilizadores WHERE id = ? AND escola_id = ?', [id, req.escolaId]);
    res.redirect(`/utilizadores?success=${encodeURIComponent('Utilizador eliminado.')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
