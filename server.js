require('dotenv').config();

const express = require('express');
const path = require('path');
const methodOverride = require('method-override');

const { waitForDatabase } = require('./config/db');
const { iniciais, avatarCor, MOTIVOS_FALTA, dataCurta } = require('./config/ui');

const indexRoutes = require('./routes/index');
const professoresRoutes = require('./routes/professores');
const faltasRoutes = require('./routes/faltas');
const turmasRoutes = require('./routes/turmas');
const disciplinasRoutes = require('./routes/disciplinas');
const horariosRoutes = require('./routes/horarios');
const relatoriosRoutes = require('./routes/relatorios');
const configuracoesRoutes = require('./routes/configuracoes');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Disponibiliza o ano atual e o path atual em todas as views
app.use((req, res, next) => {
  res.locals.anoAtual = new Date().getFullYear();
  res.locals.currentPath = req.path;
  res.locals.iniciais = iniciais;
  res.locals.avatarCor = avatarCor;
  res.locals.motivosFalta = MOTIVOS_FALTA;
  res.locals.dataCurta = dataCurta;
  next();
});

// Rotas
app.use('/', indexRoutes);
app.use('/professores', professoresRoutes);
app.use('/faltas', faltasRoutes);
app.use('/turmas', turmasRoutes);
app.use('/disciplinas', disciplinasRoutes);
app.use('/horarios', horariosRoutes);
app.use('/relatorios', relatoriosRoutes);
app.use('/configuracoes', configuracoesRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('404', { pageTitle: 'Página não encontrada', activePage: '' });
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`
    <div style="font-family: sans-serif; padding: 40px;">
      <h1>Ocorreu um erro</h1>
      <pre>${err.message}</pre>
    </div>
  `);
});

async function start() {
  try {
    await waitForDatabase();
    app.listen(PORT, () => {
      console.log(`Servidor a correr em http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar a aplicação:', err.message);
    process.exit(1);
  }
}

start();
