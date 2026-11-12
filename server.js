require('dotenv').config();

const express = require('express');
const path = require('path');
const methodOverride = require('method-override');

const { waitForDatabase } = require('./config/db');
const { iniciais, avatarCor, MOTIVOS_FALTA, dataCurta, dataNumerica } = require('./config/ui');
const { carregarUtilizador, exigirLogin, verificarPermissao, prepararUtilizadores } = require('./config/auth');
const { migrar } = require('./config/migracoes');
const { MARCA } = require('./config/marca');

const indexRoutes = require('./routes/index');
const professoresRoutes = require('./routes/professores');
const faltasRoutes = require('./routes/faltas');
const turmasRoutes = require('./routes/turmas');
const disciplinasRoutes = require('./routes/disciplinas');
const horariosRoutes = require('./routes/horarios');
const relatoriosRoutes = require('./routes/relatorios');
const configuracoesRoutes = require('./routes/configuracoes');
const authRoutes = require('./routes/auth');
const utilizadoresRoutes = require('./routes/utilizadores');
const { router: apiRoutes, errosApi } = require('./routes/api');
const importarRoutes = require('./routes/importar');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// API da aplicação móvel: JSON + autenticação por token (independente da sessão por cookie).
// CORS aberto: a API não usa cookies (só "Authorization: Bearer"), por isso a versão web da app
// pode chamá-la a partir de outro endereço sem expor as sessões do site.
app.use('/api', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400'
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api', express.json({ limit: '100kb' }), apiRoutes, errosApi);

// Middlewares
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json());
app.use(methodOverride('_method'));
// Imagens públicas (logótipos das escolas, marca) com CORS, para a versão web da app as mostrar
app.use('/img', (req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });
app.use(express.static(path.join(__dirname, 'public')));

// Disponibiliza o ano atual e o path atual em todas as views
app.use((req, res, next) => {
  res.locals.anoAtual = new Date().getFullYear();
  res.locals.currentPath = req.path;
  res.locals.iniciais = iniciais;
  res.locals.avatarCor = avatarCor;
  res.locals.motivosFalta = MOTIVOS_FALTA;
  res.locals.dataCurta = dataCurta;
  res.locals.dataNumerica = dataNumerica;
  res.locals.marca = MARCA;
  next();
});

// Sessão: identifica o utilizador; /login e /logout são públicos, o resto exige sessão e permissão
app.use(carregarUtilizador);
app.use('/', authRoutes);
app.use(exigirLogin);
app.use(verificarPermissao);

// Rotas
app.use('/', indexRoutes);
app.use('/professores', professoresRoutes);
app.use('/faltas', faltasRoutes);
app.use('/turmas', turmasRoutes);
app.use('/disciplinas', disciplinasRoutes);
app.use('/horarios', horariosRoutes);
app.use('/relatorios', relatoriosRoutes);
app.use('/configuracoes', configuracoesRoutes);
app.use('/utilizadores', utilizadoresRoutes);
app.use('/importar', importarRoutes);

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
      <pre>${String(err.message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>
    </div>
  `);
});

async function start() {
  try {
    await waitForDatabase();
    await migrar();
    await prepararUtilizadores();
    app.listen(PORT, () => {
      console.log(`Servidor a correr em http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar a aplicação:', err.message);
    process.exit(1);
  }
}

start();
