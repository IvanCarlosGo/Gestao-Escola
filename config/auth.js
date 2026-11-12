// Autenticação: palavras-passe (scrypt), sessão em cookie assinado (HMAC) e permissões por perfil.
const crypto = require('crypto');
const { pool } = require('./db');
const { temaDaCor } = require('./cores');

const COOKIE = 'sessao';
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas
const PERFIS = { admin: 'Administrador', secretaria: 'Secretaria', continuo: 'Contínuo' };
// Perfis que entram no site de gestão (o Contínuo usa só a aplicação móvel)
const PERFIS_WEB = ['admin', 'secretaria'];

// Utilizador ativo de uma escola ativa (usado pelo site e pela API)
const SQL_UTILIZADOR_ATIVO = `
  SELECT u.id, u.nome, u.email, u.perfil, u.escola_id,
    e.nome AS escola_nome, e.sigla AS escola_sigla, e.logo AS escola_logo, e.cor AS escola_cor
  FROM utilizadores u JOIN escolas e ON e.id = u.escola_id AND e.ativo = 1
  WHERE u.id = ? AND u.ativo = 1`;

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

function definirCookieAssinado(res, nome, id, prefixo) {
  const valor = `${id}.${Date.now() + DURACAO_SESSAO_MS}`;
  res.cookie(nome, `${valor}.${assinatura(prefixo + valor)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: DURACAO_SESSAO_MS,
    path: '/'
  });
}

function lerCookieAssinado(req, nome, prefixo) {
  const bruto = lerCookies(req.headers.cookie)[nome];
  if (!bruto) return null;
  const [id, expira, sig] = bruto.split('.');
  if (!id || !expira || !sig) return null;
  const esperado = Buffer.from(assinatura(`${prefixo}${id}.${expira}`));
  const recebido = Buffer.from(sig);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  if (Number(expira) < Date.now()) return null;
  return Number(id);
}

function criarSessao(res, utilizadorId) {
  definirCookieAssinado(res, COOKIE, utilizadorId, '');
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
  return lerCookieAssinado(req, COOKIE, '');
}

// Carrega o utilizador da sessão em cada pedido (assim, desativar alguém tem efeito imediato)
async function carregarUtilizador(req, res, next) {
  try {
    const id = idDaSessao(req);
    if (id) {
      const [[utilizador]] = await pool.query(SQL_UTILIZADOR_ATIVO, [id]);
      if (utilizador && PERFIS_WEB.includes(utilizador.perfil)) {
        req.utilizador = utilizador;
        req.escolaId = utilizador.escola_id;
        res.locals.escola = {
          id: utilizador.escola_id,
          nome: utilizador.escola_nome,
          sigla: utilizador.escola_sigla,
          logo: utilizador.escola_logo,
          cor: utilizador.escola_cor
        };
        res.locals.temaEscola = temaDaCor(utilizador.escola_cor);
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

// ---------- Tokens da API (aplicação móvel) ----------
// Formato "<id>.<expira>.<assinatura>"; a assinatura usa o prefixo "api:" para não servir como cookie e vice-versa.

const DURACAO_TOKEN_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function criarTokenApi(utilizadorId) {
  const expira = Date.now() + DURACAO_TOKEN_MS;
  const valor = `${utilizadorId}.${expira}`;
  return { token: `${valor}.${assinatura(`api:${valor}`)}`, expira: new Date(expira) };
}

function idDoTokenApi(token) {
  const [id, expira, sig] = String(token || '').split('.');
  if (!id || !expira || !sig) return null;
  const esperado = Buffer.from(assinatura(`api:${id}.${expira}`));
  const recebido = Buffer.from(sig);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  if (Number(expira) < Date.now()) return null;
  return Number(id);
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
  const soAdmin = caminho.startsWith('/utilizadores') || caminho.startsWith('/importar');
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
  // A tabela é criada em config/migracoes.js
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM utilizadores');
  if (total > 0) return;
  // Sem escolas ainda: os administradores das escolas criam-se no painel da plataforma (porta 8080)
  const [[{ escolas }]] = await pool.query('SELECT COUNT(*) AS escolas FROM escolas');
  if (escolas === 0) {
    console.log('Ainda não há escolas: crie-as, e aos seus administradores, no painel da plataforma.');
    return;
  }

  // Primeiro arranque: cria o administrador. Sem ADMIN_PASSWORD definido, gera uma palavra-passe aleatória.
  const email = (process.env.ADMIN_EMAIL || 'admin@escola.cv').trim().toLowerCase();
  const nome = process.env.ADMIN_NOME || 'Administrador';
  const gerada = !process.env.ADMIN_PASSWORD;
  const palavraPasse = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');

  await pool.query(
    "INSERT INTO utilizadores (escola_id, nome, email, palavra_passe, perfil) VALUES ((SELECT MIN(id) FROM escolas), ?, ?, ?, 'admin')",
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
  PERFIS_WEB,
  SQL_UTILIZADOR_ATIVO,
  definirCookieAssinado,
  lerCookieAssinado,
  hashPalavraPasse,
  verificarPalavraPasse,
  validarNovaPalavraPasse,
  criarSessao,
  terminarSessao,
  criarTokenApi,
  idDoTokenApi,
  carregarUtilizador,
  exigirLogin,
  verificarPermissao,
  bloqueado,
  registarFalha,
  limparFalhas,
  prepararUtilizadores
};
