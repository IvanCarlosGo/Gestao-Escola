const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const {
  PERFIS_WEB, verificarPalavraPasse, criarSessao, terminarSessao, bloqueado, registarFalha, limparFalhas
} = require('../config/auth');

// Só aceita destinos internos depois do login (evita redirecionar para outro site)
const destinoSeguro = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/');

router.get('/login', (req, res) => {
  if (req.utilizador) return res.redirect('/');
  res.render('login', { pageTitle: 'Entrar', email: '', next: destinoSeguro(req.query.next), error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const palavraPasse = String(req.body.palavra_passe || '');
    const destino = destinoSeguro(req.body.next);
    const chave = `${req.ip}|${email}`;
    const voltar = (error) => res.status(401).render('login', { pageTitle: 'Entrar', email, next: destino, error });

    const minutos = bloqueado(chave);
    if (minutos) return voltar(`Demasiadas tentativas falhadas. Tente novamente dentro de ${minutos} min.`);

    const [[utilizador]] = await pool.query(
      `SELECT u.id, u.palavra_passe, u.perfil, e.ativo AS escola_ativa
       FROM utilizadores u JOIN escolas e ON e.id = u.escola_id
       WHERE u.email = ? AND u.ativo = 1`, [email]
    );

    if (!utilizador || !verificarPalavraPasse(palavraPasse, utilizador.palavra_passe)) {
      registarFalha(chave);
      return voltar('Email ou palavra-passe incorretos.');
    }
    // Só depois de a palavra-passe estar certa, para não revelar que contas existem
    if (!utilizador.escola_ativa) return voltar('O acesso da sua escola está suspenso. Contacte o administrador da plataforma.');
    if (!PERFIS_WEB.includes(utilizador.perfil)) {
      return voltar('As contas de Contínuo usam apenas a aplicação móvel para registar faltas.');
    }

    limparFalhas(chave);
    criarSessao(res, utilizador.id);
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
