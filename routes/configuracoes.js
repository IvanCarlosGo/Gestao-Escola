const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { verificarPalavraPasse, hashPalavraPasse, validarNovaPalavraPasse } = require('../config/auth');

function renderDefinicoes(res, extra = {}) {
  res.render('configuracoes', {
    pageTitle: 'Definições',
    activePage: 'configuracoes',
    fusoHorario: process.env.TZ || 'UTC',
    success: null,
    error: null,
    ...extra
  });
}

router.get('/', (req, res) => {
  renderDefinicoes(res, { success: req.query.success || null });
});

// ALTERAR A PRÓPRIA PALAVRA-PASSE
router.post('/palavra-passe', async (req, res, next) => {
  try {
    const { atual, nova, confirmar } = req.body;
    const [[conta]] = await pool.query('SELECT palavra_passe FROM utilizadores WHERE id = ?', [req.utilizador.id]);

    if (!conta || !verificarPalavraPasse(atual, conta.palavra_passe)) {
      return renderDefinicoes(res.status(400), { error: 'A palavra-passe atual está incorreta.' });
    }
    const erro = validarNovaPalavraPasse(nova) || (nova !== confirmar ? 'A confirmação não coincide com a nova palavra-passe.' : null);
    if (erro) return renderDefinicoes(res.status(400), { error: erro });

    await pool.query('UPDATE utilizadores SET palavra_passe = ? WHERE id = ?', [hashPalavraPasse(nova), req.utilizador.id]);
    res.redirect(`/configuracoes?success=${encodeURIComponent('Palavra-passe alterada com sucesso.')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
