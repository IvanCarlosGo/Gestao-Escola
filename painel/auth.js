// Autenticação do painel da plataforma: contas próprias (plataforma_admins), cookie e assinatura próprios,
// para que uma sessão de escola nunca sirva aqui (e vice-versa).
const { pool } = require('../config/db');
const { definirCookieAssinado, lerCookieAssinado } = require('../config/auth');

const COOKIE = 'painel_sessao';
const PREFIXO = 'painel:';

function criarSessao(res, adminId) {
  definirCookieAssinado(res, COOKIE, adminId, PREFIXO);
}

function terminarSessao(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

async function carregarAdmin(req, res, next) {
  try {
    const id = lerCookieAssinado(req, COOKIE, PREFIXO);
    if (id) {
      const [[admin]] = await pool.query('SELECT id, nome, email FROM plataforma_admins WHERE id = ? AND ativo = 1', [id]);
      if (admin) {
        req.admin = admin;
        res.locals.admin = admin;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function exigirAdmin(req, res, next) {
  if (req.admin) return next();
  if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.status(401).send('Sessão expirada. Inicie sessão novamente.');
}

module.exports = { criarSessao, terminarSessao, carregarAdmin, exigirAdmin };
