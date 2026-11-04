// Administradores da plataforma (donos do projeto) e a própria conta
const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');
const { hashPalavraPasse, verificarPalavraPasse, validarNovaPalavraPasse } = require('../../config/auth');

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const voltar = (res, chave, msg) => res.redirect(`/admins?${chave}=${encodeURIComponent(msg)}`);

router.get('/', async (req, res, next) => {
  try {
    const [admins] = await pool.query('SELECT id, nome, email, ativo, criado_em FROM plataforma_admins ORDER BY nome');
    res.render('admins/list', {
      pageTitle: 'Administradores da plataforma',
      activePage: 'admins',
      admins,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!nome || !EMAIL_VALIDO.test(email)) return voltar(res, 'error', 'Indique o nome e um email válido.');
    const erro = validarNovaPalavraPasse(req.body.palavra_passe);
    if (erro) return voltar(res, 'error', erro);

    await pool.query('INSERT INTO plataforma_admins (nome, email, palavra_passe) VALUES (?, ?, ?)',
      [nome, email, hashPalavraPasse(req.body.palavra_passe)]);
    voltar(res, 'success', `${nome} é agora administrador da plataforma.`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return voltar(res, 'error', 'Já existe um administrador com esse email.');
    next(err);
  }
});

// A própria palavra-passe
router.post('/palavra-passe', async (req, res, next) => {
  try {
    const { atual, nova, confirmar } = req.body;
    const [[conta]] = await pool.query('SELECT palavra_passe FROM plataforma_admins WHERE id = ?', [req.admin.id]);
    if (!conta || !verificarPalavraPasse(atual, conta.palavra_passe)) return voltar(res, 'error', 'A palavra-passe atual está incorreta.');
    const erro = validarNovaPalavraPasse(nova) || (nova !== confirmar ? 'A confirmação não coincide com a nova palavra-passe.' : null);
    if (erro) return voltar(res, 'error', erro);

    await pool.query('UPDATE plataforma_admins SET palavra_passe = ? WHERE id = ?', [hashPalavraPasse(nova), req.admin.id]);
    voltar(res, 'success', 'Palavra-passe alterada.');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.admin.id) return voltar(res, 'error', 'Não pode eliminar a sua própria conta.');
    await pool.query('DELETE FROM plataforma_admins WHERE id = ?', [id]);
    voltar(res, 'success', 'Administrador da plataforma removido.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
