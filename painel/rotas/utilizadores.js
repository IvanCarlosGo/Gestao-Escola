// Utilizadores de todas as escolas (administradores, secretarias e contínuos)
const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');
const { PERFIS, hashPalavraPasse } = require('../../config/auth');
const { validarConta, normalizarConta, criarConta } = require('../contas');

const voltar = (res, destino, chave, msg) => res.redirect(`${destino}${destino.includes('?') ? '&' : '?'}${chave}=${encodeURIComponent(msg)}`);
const naoEncontrado = (res) => res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: 'utilizadores' });

// Para onde voltar depois de guardar: a página da escola, se veio de lá
const destinoDepois = (body, escolaId) => (body.voltar === 'escola' ? `/escolas/${escolaId}` : '/utilizadores');

async function listaEscolas() {
  const [escolas] = await pool.query('SELECT id, nome, sigla, ativo FROM escolas ORDER BY nome');
  return escolas;
}

async function renderForm(res, conta, error) {
  res.render('utilizadores/form', {
    pageTitle: conta.id ? 'Editar utilizador' : 'Novo utilizador',
    activePage: 'utilizadores',
    conta,
    escolas: await listaEscolas(),
    error
  });
}

router.get('/', async (req, res, next) => {
  try {
    const { escola_id, perfil, q } = req.query;
    let sql = `
      SELECT u.id, u.nome, u.email, u.perfil, u.ativo, u.criado_em, u.escola_id,
        e.nome AS escola_nome, e.sigla AS escola_sigla, e.ativo AS escola_ativa
      FROM utilizadores u JOIN escolas e ON e.id = u.escola_id WHERE 1 = 1`;
    const params = [];
    if (escola_id) { sql += ' AND u.escola_id = ?'; params.push(escola_id); }
    if (perfil && PERFIS[perfil]) { sql += ' AND u.perfil = ?'; params.push(perfil); }
    if (q) { sql += ' AND (u.nome LIKE ? OR u.email LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += " ORDER BY e.nome, FIELD(u.perfil, 'admin', 'secretaria', 'continuo'), u.nome";

    const [contas] = await pool.query(sql, params);
    res.render('utilizadores/list', {
      pageTitle: 'Utilizadores',
      activePage: 'utilizadores',
      contas,
      escolas: await listaEscolas(),
      filtros: { escola_id: escola_id || '', perfil: perfil || '', q: q || '' },
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

router.get('/novo', async (req, res, next) => {
  try {
    await renderForm(res, {
      escola_id: req.query.escola_id || '',
      perfil: PERFIS[req.query.perfil] ? req.query.perfil : 'admin',
      ativo: 1,
      voltar: req.query.escola_id ? 'escola' : ''
    }, null);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const conta = normalizarConta(req.body);
  try {
    const [[escola]] = await pool.query('SELECT id FROM escolas WHERE id = ?', [conta.escola_id || 0]);
    if (!escola) return renderForm(res, conta, 'Escolha a escola.');
    const erro = validarConta(conta, { criar: true });
    if (erro) return renderForm(res, conta, erro);

    await criarConta(escola.id, conta);
    voltar(res, destinoDepois(req.body, escola.id), 'success', `${PERFIS[conta.perfil]} ${conta.nome} criado.`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(res, conta, 'Já existe uma conta com esse email.');
    next(err);
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const [[conta]] = await pool.query('SELECT id, escola_id, nome, email, perfil, ativo FROM utilizadores WHERE id = ?', [req.params.id]);
    if (!conta) return naoEncontrado(res);
    await renderForm(res, { ...conta, voltar: req.query.voltar === 'escola' ? 'escola' : '' }, null);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  const conta = { ...normalizarConta(req.body), id: Number(req.params.id) };
  try {
    const [[existente]] = await pool.query('SELECT id FROM utilizadores WHERE id = ?', [conta.id]);
    if (!existente) return naoEncontrado(res);
    const [[escola]] = await pool.query('SELECT id FROM escolas WHERE id = ?', [conta.escola_id || 0]);
    if (!escola) return renderForm(res, conta, 'Escolha a escola.');
    const erro = validarConta(conta, { criar: false });
    if (erro) return renderForm(res, conta, erro);

    await pool.query(
      'UPDATE utilizadores SET escola_id = ?, nome = ?, email = ?, perfil = ?, ativo = ? WHERE id = ?',
      [escola.id, conta.nome, conta.email, conta.perfil, conta.ativo, conta.id]
    );
    if (conta.palavra_passe) {
      await pool.query('UPDATE utilizadores SET palavra_passe = ? WHERE id = ?', [hashPalavraPasse(conta.palavra_passe), conta.id]);
    }
    voltar(res, destinoDepois(req.body, escola.id), 'success', `Conta de ${conta.nome} atualizada.`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return renderForm(res, conta, 'Já existe uma conta com esse email.');
    next(err);
  }
});

// ATIVAR / DESATIVAR (ação rápida)
router.post('/:id/estado', async (req, res, next) => {
  try {
    const [[conta]] = await pool.query('SELECT id, nome, ativo, escola_id FROM utilizadores WHERE id = ?', [req.params.id]);
    if (!conta) return naoEncontrado(res);
    await pool.query('UPDATE utilizadores SET ativo = ? WHERE id = ?', [conta.ativo ? 0 : 1, conta.id]);
    voltar(res, destinoDepois(req.body, conta.escola_id), 'success', `${conta.nome}: conta ${conta.ativo ? 'desativada' : 'ativada'}.`);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [[conta]] = await pool.query('SELECT id, nome, escola_id FROM utilizadores WHERE id = ?', [req.params.id]);
    if (!conta) return naoEncontrado(res);
    await pool.query('DELETE FROM utilizadores WHERE id = ?', [conta.id]);
    voltar(res, destinoDepois(req.body, conta.escola_id), 'success', `Conta de ${conta.nome} eliminada.`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
