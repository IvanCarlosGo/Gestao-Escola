// Visão geral da plataforma: totais e resumo por escola
const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db');

// Contagens por escola, reutilizadas pela lista de escolas
const SQL_ESCOLAS_RESUMO = `
  SELECT e.*,
    (SELECT COUNT(*) FROM professores p WHERE p.escola_id = e.id AND p.ativo = 1) AS professores,
    (SELECT COUNT(*) FROM turmas t WHERE t.escola_id = e.id) AS turmas,
    (SELECT COUNT(*) FROM utilizadores u WHERE u.escola_id = e.id AND u.perfil = 'admin' AND u.ativo = 1) AS admins,
    (SELECT COUNT(*) FROM utilizadores u WHERE u.escola_id = e.id AND u.perfil = 'secretaria' AND u.ativo = 1) AS secretarias,
    (SELECT COUNT(*) FROM utilizadores u WHERE u.escola_id = e.id AND u.perfil = 'continuo' AND u.ativo = 1) AS continuos,
    (SELECT COUNT(*) FROM faltas f WHERE f.escola_id = e.id
       AND MONTH(f.data_falta) = MONTH(CURDATE()) AND YEAR(f.data_falta) = YEAR(CURDATE())) AS faltas_mes,
    (SELECT MAX(f.criado_em) FROM faltas f WHERE f.escola_id = e.id) AS ultima_falta
  FROM escolas e`;

router.get('/', async (req, res, next) => {
  try {
    const [escolas] = await pool.query(`${SQL_ESCOLAS_RESUMO} ORDER BY e.ativo DESC, e.nome ASC`);
    const [[totais]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM escolas) AS escolas,
        (SELECT COUNT(*) FROM escolas WHERE ativo = 1) AS escolasAtivas,
        (SELECT COUNT(*) FROM professores WHERE ativo = 1) AS professores,
        (SELECT COUNT(*) FROM utilizadores WHERE ativo = 1) AS utilizadores,
        (SELECT COUNT(*) FROM utilizadores WHERE ativo = 1 AND perfil = 'continuo') AS continuos,
        (SELECT COUNT(*) FROM faltas WHERE MONTH(data_falta) = MONTH(CURDATE()) AND YEAR(data_falta) = YEAR(CURDATE())) AS faltasMes
    `);

    res.render('visao-geral', {
      pageTitle: 'Visão geral',
      activePage: 'visao-geral',
      escolas,
      totais,
      semAdmin: escolas.filter((e) => e.ativo && !e.admins)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.SQL_ESCOLAS_RESUMO = SQL_ESCOLAS_RESUMO;
