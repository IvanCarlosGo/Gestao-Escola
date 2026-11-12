const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { verificarPalavraPasse, hashPalavraPasse, validarNovaPalavraPasse } = require('../config/auth');
const {
  MODELOS_HORARIO, MODELO_PADRAO, TEMPOS_PADRAO, INICIO_TARDE, modeloDosTempos, validarTempos, temposDaEscola, aulasForaDosTempos
} = require('../config/horarioSlots');

async function renderDefinicoes(req, res, extra = {}) {
  const tempos = await temposDaEscola(req.escolaId);
  res.render('configuracoes', {
    pageTitle: 'Definições',
    activePage: 'configuracoes',
    fusoHorario: process.env.TZ || 'UTC',
    tempos,
    // Modelo em uso (praia, geral) ou null quando os tempos foram personalizados
    modeloAtual: extra.temposEnviados ? null : modeloDosTempos(tempos),
    modelosHorario: MODELOS_HORARIO,
    modeloPadrao: MODELO_PADRAO,
    inicioTarde: INICIO_TARDE,
    success: null,
    error: null,
    ...extra
  });
}

router.get('/', async (req, res, next) => {
  try {
    await renderDefinicoes(req, res, { success: req.query.success || null, aviso: req.query.aviso || null });
  } catch (err) {
    next(err);
  }
});

// TEMPOS DO HORÁRIO DA ESCOLA (só Administrador: ver config/auth.js)
// Campos repetidos inicio[], fim[], tipo[] (aula|intervalo); "repor" volta ao horário padrão
router.post('/tempos', async (req, res, next) => {
  try {
    const lista = (v) => (v === undefined ? [] : [].concat(v));
    let tempos = null;
    if (!req.body.repor) {
      const inicios = lista(req.body.inicio);
      const fins = lista(req.body.fim);
      const tipos = lista(req.body.tipo);
      const linhas = inicios
        .map((inicio, i) => ({ inicio, fim: fins[i], intervalo: tipos[i] === 'intervalo' }))
        .filter((t) => String(t.inicio || '').trim() || String(t.fim || '').trim()); // linhas vazias ignoradas
      const validacao = validarTempos(linhas);
      if (validacao.erro) {
        return await renderDefinicoes(req, res.status(400), { error: `Horário não guardado: ${validacao.erro}`, temposEnviados: linhas });
      }
      tempos = validacao.tempos;
    }

    await pool.query('UPDATE escolas SET tempos = ? WHERE id = ?', [tempos ? JSON.stringify(tempos) : null, req.escolaId]);

    // Aulas já registadas que deixam de coincidir com os tempos
    const [aulas] = await pool.query('SELECT hora_inicio, hora_fim FROM horarios WHERE escola_id = ?', [req.escolaId]);
    const fora = aulasForaDosTempos(aulas, tempos || TEMPOS_PADRAO).length;
    const modelo = modeloDosTempos(tempos || TEMPOS_PADRAO);
    const query = new URLSearchParams({
      success: `Horário da escola guardado: ${modelo ? MODELOS_HORARIO[modelo].nome : 'personalizado'}.`
    });
    if (fora) {
      query.set('aviso', `${fora} ${fora === 1 ? 'aula do horário não coincide' : 'aulas do horário não coincidem'} com estes tempos e podem não aparecer na grelha. Ajuste-as em Horários.`);
    }
    res.redirect(`/configuracoes?${query}#horario-escola`);
  } catch (err) {
    next(err);
  }
});

// ALTERAR A PRÓPRIA PALAVRA-PASSE
router.post('/palavra-passe', async (req, res, next) => {
  try {
    const { atual, nova, confirmar } = req.body;
    const [[conta]] = await pool.query('SELECT palavra_passe FROM utilizadores WHERE id = ?', [req.utilizador.id]);

    if (!conta || !verificarPalavraPasse(atual, conta.palavra_passe)) {
      return renderDefinicoes(req, res.status(400), { error: 'A palavra-passe atual está incorreta.' });
    }
    const erro = validarNovaPalavraPasse(nova) || (nova !== confirmar ? 'A confirmação não coincide com a nova palavra-passe.' : null);
    if (erro) return renderDefinicoes(req, res.status(400), { error: erro });

    await pool.query('UPDATE utilizadores SET palavra_passe = ? WHERE id = ?', [hashPalavraPasse(nova), req.utilizador.id]);
    res.redirect(`/configuracoes?success=${encodeURIComponent('Palavra-passe alterada com sucesso.')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
