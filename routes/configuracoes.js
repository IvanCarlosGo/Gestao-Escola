const express = require('express');
const router = express.Router();

// Página de configurações (placeholder informativo — sem persistência por agora)
router.get('/', (req, res) => {
  res.render('configuracoes', {
    pageTitle: 'Definições',
    activePage: 'configuracoes'
  });
});

module.exports = router;
