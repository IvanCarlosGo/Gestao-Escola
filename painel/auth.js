// Autenticação do painel da plataforma: contas próprias (plataforma_admins), cookie e assinatura próprios,
// para que uma sessão de escola nunca sirva aqui (e vice-versa).
const crypto = require('crypto');
const { pool } = require('../config/db');
const { hashPalavraPasse, definirCookieAssinado, lerCookieAssinado } = require('../config/auth');

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

// Primeiro arranque: cria a conta do dono da plataforma (palavra-passe gerada se PAINEL_PASSWORD não existir)
async function prepararAdminPlataforma() {
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM plataforma_admins');
  if (total > 0) return;

  const email = (process.env.PAINEL_EMAIL || 'plataforma@escola.cv').trim().toLowerCase();
  const nome = process.env.PAINEL_NOME || 'Dono da plataforma';
  const gerada = !process.env.PAINEL_PASSWORD;
  const palavraPasse = process.env.PAINEL_PASSWORD || crypto.randomBytes(9).toString('base64url');

  await pool.query(
    'INSERT INTO plataforma_admins (nome, email, palavra_passe) VALUES (?, ?, ?)',
    [nome, email, hashPalavraPasse(palavraPasse)]
  );

  console.log('==============================================================');
  console.log(' Painel da plataforma: conta criada');
  console.log(`   Email:        ${email}`);
  console.log(`   Palavra-passe: ${gerada ? palavraPasse : '(a definida em PAINEL_PASSWORD)'}`);
  console.log(' Altere a palavra-passe em "A minha conta" depois de entrar.');
  console.log('==============================================================');
}

module.exports = { criarSessao, terminarSessao, carregarAdmin, exigirAdmin, prepararAdminPlataforma };
