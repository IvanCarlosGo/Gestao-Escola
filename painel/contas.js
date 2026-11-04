// Validação e criação de contas das escolas (usado pelas páginas Escolas e Utilizadores do painel)
const { pool } = require('../config/db');
const { PERFIS, hashPalavraPasse, validarNovaPalavraPasse } = require('../config/auth');

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Devolve a mensagem de erro, ou null se estiver tudo certo. A palavra-passe só é obrigatória ao criar.
function validarConta(conta, { criar }) {
  if (!conta.nome || !String(conta.nome).trim()) return 'Indique o nome.';
  if (!EMAIL_VALIDO.test(conta.email || '')) return 'Indique um email válido.';
  if (!PERFIS[conta.perfil]) return 'Escolha um perfil válido.';
  if (criar || conta.palavra_passe) return validarNovaPalavraPasse(conta.palavra_passe);
  return null;
}

function normalizarConta(body) {
  return {
    ...body,
    nome: String(body.nome || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    ativo: body.ativo ? 1 : 0
  };
}

async function criarConta(escolaId, conta) {
  const [r] = await pool.query(
    'INSERT INTO utilizadores (escola_id, nome, email, palavra_passe, perfil, ativo) VALUES (?, ?, ?, ?, ?, ?)',
    [escolaId, conta.nome, conta.email, hashPalavraPasse(conta.palavra_passe), conta.perfil, conta.ativo]
  );
  return r.insertId;
}

module.exports = { validarConta, normalizarConta, criarConta };
