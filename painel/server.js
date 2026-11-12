// Painel da plataforma (porta 8080): escolas, utilizadores de todas as escolas e administradores da plataforma.
require('dotenv').config();

const express = require('express');
const path = require('path');
const methodOverride = require('method-override');

const { waitForDatabase } = require('../config/db');
const { migrar } = require('../config/migracoes');
const { iniciais, avatarCor, dataCurta } = require('../config/ui');
const { PERFIS } = require('../config/auth');
const { MARCA } = require('../config/marca');
const { carregarAdmin, exigirAdmin } = require('./auth');
const { seedAdmin } = require('./seeder');

const app = express();
const PORT = process.env.PAINEL_PORT || 8080;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Limite maior por causa do upload do logótipo das escolas (enviado como data URL)
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.iniciais = iniciais;
  res.locals.avatarCor = avatarCor;
  res.locals.dataCurta = dataCurta;
  res.locals.perfis = PERFIS;
  res.locals.marca = MARCA;
  next();
});

app.use(carregarAdmin);
app.use('/', require('./rotas/auth'));
app.use(exigirAdmin);

app.use('/', require('./rotas/visao-geral'));
app.use('/escolas', require('./rotas/escolas'));
app.use('/utilizadores', require('./rotas/utilizadores'));
app.use('/admins', require('./rotas/admins'));

app.use((req, res) => res.status(404).render('404', { pageTitle: 'Página não encontrada', activePage: '' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const msg = String(err.message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  res.status(500).send(`<div style="font-family: sans-serif; padding: 40px;"><h1>Ocorreu um erro</h1><pre>${msg}</pre></div>`);
});

async function start() {
  try {
    await waitForDatabase();
    await migrar();
    await seedAdmin();
    app.listen(PORT, () => console.log(`Painel da plataforma em http://localhost:${PORT}`));
  } catch (err) {
    console.error('Falha ao iniciar o painel:', err.message);
    process.exit(1);
  }
}

start();
