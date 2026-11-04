const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');
const { verificarPalavraPasse, bloqueado, registarFalha, limparFalhas } = require('../../config/auth');
const { criarSessao, terminarSessao } = require('../auth');

const destinoSeguro = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/');

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/');
  res.render('login', { pageTitle: 'Entrar', email: '', next: destinoSeguro(req.query.next), error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const destino = destinoSeguro(req.body.next);
    const chave = `painel|${req.ip}|${email}`;
    const voltar = (error) => res.status(401).render('login', { pageTitle: 'Entrar', email, next: destino, error });

    const minutos = bloqueado(chave);
    if (minutos) return voltar(`Demasiadas tentativas falhadas. Tente novamente dentro de ${minutos} min.`);

    const [[admin]] = await pool.query('SELECT id, palavra_passe FROM plataforma_admins WHERE email = ? AND ativo = 1', [email]);
    if (!admin || !verificarPalavraPasse(req.body.palavra_passe, admin.palavra_passe)) {
      registarFalha(chave);
      return voltar('Email ou palavra-passe incorretos.');
    }

    limparFalhas(chave);
    criarSessao(res, admin.id);
    res.redirect(destino);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  terminarSessao(res);
  res.redirect('/login');
});

module.exports = router;
