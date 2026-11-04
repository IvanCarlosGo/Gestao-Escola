// Autenticação: palavras-passe (scrypt), sessão em cookie assinado (HMAC) e permissões por perfil.
const crypto = require('crypto');
const { pool } = require('./db');

const COOKIE = 'sessao';
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas
const PERFIS = { admin: 'Administrador', secretaria: 'Secretaria' };

let SEGREDO = process.env.SESSION_SECRET;
if (!SEGREDO || SEGREDO.length < 32) {
  SEGREDO = crypto.randomBytes(48).toString('hex');
  console.warn('[auth] SESSION_SECRET não definido (ou curto): as sessões terminam sempre que o servidor reinicia.');
}

// ---------- Palavras-passe ----------

function hashPalavraPasse(palavraPasse) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(palavraPasse, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function verificarPalavraPasse(palavraPasse, guardado) {
  const [algoritmo, salHex, hashHex] = String(guardado || '').split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = crypto.scryptSync(String(palavraPasse), Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

function validarNovaPalavraPasse(palavraPasse) {
  if (String(palavraPasse || '').length < 8) return 'A palavra-passe tem de ter pelo menos 8 caracteres.';
  return null;
}

// ---------- Sessão (cookie assinado) ----------

function assinatura(valor) {
  return crypto.createHmac('sha256', SEGREDO).update(valor).digest('base64url');
}

function criarSessao(res, utilizadorId) {
  const valor = `${utilizadorId}.${Date.now() + DURACAO_SESSAO_MS}`;
  res.cookie(COOKIE, `${valor}.${assinatura(valor)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: DURACAO_SESSAO_MS,
    path: '/'
  });
}

function terminarSessao(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function lerCookies(cabecalho) {
  return Object.fromEntries(
    String(cabecalho || '').split(';').map((parte) => {
      const i = parte.indexOf('=');
      return i < 0 ? [parte.trim(), ''] : [parte.slice(0, i).trim(), decodeURIComponent(parte.slice(i + 1).trim())];
    })
  );
}

function idDaSessao(req) {
  const bruto = lerCookies(req.headers.cookie)[COOKIE];
  if (!bruto) return null;
  const [id, expira, sig] = bruto.split('.');
  if (!id || !expira || !sig) return null;
  const esperado = Buffer.from(assinatura(`${id}.${expira}`));
  const recebido = Buffer.from(sig);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  if (Number(expira) < Date.now()) return null;
  return Number(id);
}

// Carrega o utilizador da sessão em cada pedido (assim, desativar alguém tem efeito imediato)
async function carregarUtilizador(req, res, next) {
  try {
    const id = idDaSessao(req);
    if (id) {
      const [[utilizador]] = await pool.query(
        'SELECT id, nome, email, perfil FROM utilizadores WHERE id = ? AND ativo = 1', [id]
      );
      if (utilizador) {
        req.utilizador = utilizador;
        res.locals.utilizador = utilizador;
        res.locals.ehAdmin = utilizador.perfil === 'admin';
        res.locals.nomePerfil = PERFIS[utilizador.perfil] || utilizador.perfil;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function exigirLogin(req, res, next) {
  if (req.utilizador) return next();
  if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.status(401).send('Sessão expirada. Inicie sessão novamente.');
}

// ---------- Permissões ----------

// O que a Secretaria pode alterar: editar/justificar faltas e a própria palavra-passe.
// Tudo o resto que escreve dados (e os formulários /novo e /editar) é só para o Administrador.
const PERMITIDO_SECRETARIA = [
  { metodo: 'GET', caminho: /^\/faltas\/\d+\/editar$/ },
  { metodo: 'PUT', caminho: /^\/faltas\/\d+$/ },
  { metodo: 'POST', caminho: /^\/faltas\/\d+\/justificar$/ },
  { metodo: 'POST', caminho: /^\/configuracoes\/palavra-passe$/ }
];

function verificarPermissao(req, res, next) {
  if (req.utilizador.perfil === 'admin') return next();

  const caminho = req.path;
  const soAdmin = caminho.startsWith('/utilizadores');
  const escreve = req.method !== 'GET' || /\/(novo|editar)$/.test(caminho);
  const permitido = PERMITIDO_SECRETARIA.some((r) => r.metodo === req.method && r.caminho.test(caminho));

  if (!soAdmin && (!escreve || permitido)) return next();
  return res.status(403).render('403', { pageTitle: 'Sem permissão', activePage: '' });
}

// ---------- Limite de tentativas de login (em memória) ----------

const tentativas = new Map(); // chave -> { falhas, bloqueadoAte }
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 10 * 60 * 1000;

function bloqueado(chave) {
  const t = tentativas.get(chave);
  return t && t.bloqueadoAte > Date.now() ? Math.ceil((t.bloqueadoAte - Date.now()) / 60000) : 0;
}

function registarFalha(chave) {
  const t = tentativas.get(chave) || { falhas: 0, bloqueadoAte: 0 };
  t.falhas += 1;
  if (t.falhas >= MAX_FALHAS) {
    t.falhas = 0;
    t.bloqueadoAte = Date.now() + BLOQUEIO_MS;
  }
  tentativas.set(chave, t);
}

function limparFalhas(chave) {
  tentativas.delete(chave);
}

// ---------- Tabela e administrador inicial ----------

async function prepararUtilizadores() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilizadores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      palavra_passe VARCHAR(255) NOT NULL,
      perfil ENUM('admin','secretaria') NOT NULL DEFAULT 'secretaria',
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM utilizadores');
  if (total > 0) return;

  // Primeiro arranque: cria o administrador. Sem ADMIN_PASSWORD definido, gera uma palavra-passe aleatória.
  const email = (process.env.ADMIN_EMAIL || 'admin@escola.cv').trim().toLowerCase();
  const nome = process.env.ADMIN_NOME || 'Administrador';
  const gerada = !process.env.ADMIN_PASSWORD;
  const palavraPasse = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');

  await pool.query(
    "INSERT INTO utilizadores (nome, email, palavra_passe, perfil) VALUES (?, ?, ?, 'admin')",
    [nome, email, hashPalavraPasse(palavraPasse)]
  );

  console.log('==============================================================');
  console.log(' Administrador criado');
  console.log(`   Email:        ${email}`);
  console.log(`   Palavra-passe: ${gerada ? palavraPasse : '(a definida em ADMIN_PASSWORD)'}`);
  console.log(' Altere a palavra-passe em Definições depois de entrar.');
  console.log('==============================================================');
}

module.exports = {
  PERFIS,
  hashPalavraPasse,
  verificarPalavraPasse,
  validarNovaPalavraPasse,
  criarSessao,
  terminarSessao,
  carregarUtilizador,
  exigirLogin,
  verificarPermissao,
  bloqueado,
  registarFalha,
  limparFalhas,
  prepararUtilizadores
};
