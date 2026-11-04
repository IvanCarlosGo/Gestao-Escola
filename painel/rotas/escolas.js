// Escolas da plataforma
const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');
const { SQL_ESCOLAS_RESUMO } = require('./visao-geral');
const { guardarLogo, apagarLogo } = require('../logo');
const { validarConta, normalizarConta, criarConta } = require('../contas');
const { COR_PADRAO, CORES_SUGERIDAS, validarCor } = require('../../config/cores');

const voltar = (res, destino, chave, msg) => res.redirect(`${destino}${destino.includes('?') ? '&' : '?'}${chave}=${encodeURIComponent(msg)}`);
const naoEncontrada = (res) => res.status(404).render('404', { pageTitle: 'Não encontrada', activePage: 'escolas' });

function dadosEscola(body) {
  return {
    nome: String(body.nome || '').trim(),
    sigla: String(body.sigla || '').trim(),
    ativo: body.ativo ? 1 : 0,
    cor: String(body.cor || COR_PADRAO).trim().toUpperCase(),
    logo_dados: body.logo_dados || ''
  };
}

function renderForm(res, escola, error, adminInicial = {}) {
  res.render('escolas/form', {
    pageTitle: escola.id ? `Editar ${escola.nome || 'escola'}` : 'Nova escola',
    activePage: 'escolas',
    escola,
    adminInicial,
    cores: CORES_SUGERIDAS,
    corPadrao: COR_PADRAO,
    error
  });
}

router.get('/', async (req, res, next) => {
  try {
    const [escolas] = await pool.query(`${SQL_ESCOLAS_RESUMO} ORDER BY e.ativo DESC, e.nome ASC`);
    res.render('escolas/list', {
      pageTitle: 'Escolas',
      activePage: 'escolas',
      escolas,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

router.get('/novo', (req, res) => renderForm(res, { ativo: 1 }, null));

// CRIAR (com o primeiro administrador, opcional)
router.post('/', async (req, res, next) => {
  const escola = dadosEscola(req.body);
  const criarAdmin = req.body.criar_admin === '1';
  const admin = normalizarConta({
    nome: req.body.admin_nome, email: req.body.admin_email, palavra_passe: req.body.admin_palavra_passe,
    perfil: 'admin', ativo: 1
  });
  const repetir = (msg) => renderForm(res, escola, msg, { ...admin, criar: criarAdmin });
  try {
    if (!escola.nome) return repetir('Indique o nome da escola.');
    const erroCor = validarCor(escola.cor);
    if (erroCor) return repetir(erroCor);
    if (criarAdmin) {
      const erroAdmin = validarConta(admin, { criar: true });
      if (erroAdmin) return repetir(`Administrador: ${erroAdmin}`);
    }

    const [r] = await pool.query('INSERT INTO escolas (nome, sigla, cor, ativo) VALUES (?, ?, ?, ?)', [escola.nome, escola.sigla || null, escola.cor, escola.ativo]);
    const id = r.insertId;

    if (escola.logo_dados) {
      const logo = await guardarLogo(id, escola.logo_dados);
      if (logo.erro) {
        await pool.query('DELETE FROM escolas WHERE id = ?', [id]);
        return repetir(logo.erro);
      }
      await pool.query('UPDATE escolas SET logo = ? WHERE id = ?', [logo.caminho, id]);
    }

    if (criarAdmin) {
      try {
        await criarConta(id, admin);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        return voltar(res, `/escolas/${id}`, 'error', `Escola criada, mas o email ${admin.email} já está a ser usado: crie o administrador com outro email.`);
      }
    }

    voltar(res, `/escolas/${id}`, 'success', `Escola ${escola.nome} criada${criarAdmin ? ' com o administrador ' + admin.email : ''}.`);
  } catch (err) {
    next(err);
  }
});

// DETALHE: números e contas da escola
router.get('/:id', async (req, res, next) => {
  try {
    const [[escola]] = await pool.query(`${SQL_ESCOLAS_RESUMO} WHERE e.id = ?`, [req.params.id]);
    if (!escola) return naoEncontrada(res);

    const [contas] = await pool.query(
      `SELECT id, nome, email, perfil, ativo, criado_em FROM utilizadores WHERE escola_id = ?
       ORDER BY FIELD(perfil, 'admin', 'secretaria', 'continuo'), nome`, [escola.id]
    );
    const [[dados]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM disciplinas WHERE escola_id = ?) AS disciplinas,
        (SELECT COUNT(*) FROM horarios WHERE escola_id = ?) AS aulas,
        (SELECT COUNT(*) FROM faltas WHERE escola_id = ?) AS faltas_total`,
      [escola.id, escola.id, escola.id]
    );

    res.render('escolas/show', {
      pageTitle: escola.nome,
      activePage: 'escolas',
      escola,
      contas,
      dados,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const [[escola]] = await pool.query('SELECT * FROM escolas WHERE id = ?', [req.params.id]);
    if (!escola) return naoEncontrada(res);
    renderForm(res, escola, null);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const [[atual]] = await pool.query('SELECT * FROM escolas WHERE id = ?', [req.params.id]);
    if (!atual) return naoEncontrada(res);
    const escola = { ...dadosEscola(req.body), id: atual.id, logo: atual.logo };
    if (!escola.nome) return renderForm(res, escola, 'Indique o nome da escola.');
    const erroCor = validarCor(escola.cor);
    if (erroCor) return renderForm(res, escola, erroCor);

    let logo = atual.logo;
    if (escola.logo_dados) {
      const novo = await guardarLogo(atual.id, escola.logo_dados);
      if (novo.erro) return renderForm(res, escola, novo.erro);
      logo = novo.caminho;
    } else if (req.body.remover_logo === '1') {
      logo = null;
    }
    if (logo !== atual.logo) await apagarLogo(atual.logo);

    await pool.query('UPDATE escolas SET nome = ?, sigla = ?, cor = ?, ativo = ?, logo = ? WHERE id = ?',
      [escola.nome, escola.sigla || null, escola.cor, escola.ativo, logo, atual.id]);
    voltar(res, `/escolas/${atual.id}`, 'success', 'Escola atualizada.');
  } catch (err) {
    next(err);
  }
});

// SUSPENDER / REATIVAR (ação rápida)
router.post('/:id/estado', async (req, res, next) => {
  try {
    const [[escola]] = await pool.query('SELECT id, nome, ativo FROM escolas WHERE id = ?', [req.params.id]);
    if (!escola) return naoEncontrada(res);
    await pool.query('UPDATE escolas SET ativo = ? WHERE id = ?', [escola.ativo ? 0 : 1, escola.id]);
    voltar(res, `/escolas/${escola.id}`, 'success',
      escola.ativo ? `Escola suspensa: os utilizadores de ${escola.nome} deixam de conseguir entrar.` : 'Escola reativada.');
  } catch (err) {
    next(err);
  }
});

// ELIMINAR: só escolas sem dados (com dados, suspender é o caminho seguro)
router.delete('/:id', async (req, res, next) => {
  try {
    const [[escola]] = await pool.query('SELECT id, nome, logo FROM escolas WHERE id = ?', [req.params.id]);
    if (!escola) return naoEncontrada(res);
    const [[uso]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM professores WHERE escola_id = ?) + (SELECT COUNT(*) FROM turmas WHERE escola_id = ?)
            + (SELECT COUNT(*) FROM disciplinas WHERE escola_id = ?) + (SELECT COUNT(*) FROM utilizadores WHERE escola_id = ?) AS total`,
      [escola.id, escola.id, escola.id, escola.id]
    );
    if (uso.total > 0) {
      return voltar(res, `/escolas/${escola.id}`, 'error', 'Esta escola tem dados (professores, turmas, disciplinas ou contas). Suspenda-a em vez de a eliminar.');
    }
    await pool.query('DELETE FROM escolas WHERE id = ?', [escola.id]);
    await apagarLogo(escola.logo);
    voltar(res, '/escolas', 'success', `Escola ${escola.nome} eliminada.`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
