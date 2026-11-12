// Identidade da plataforma (o produto). Cada escola tem a sua própria identidade (nome, sigla,
// logótipo e cor — ver config/cores.js); a marca da plataforma aparece onde ainda não há escola
// (login, painel da plataforma) e como assinatura discreta dentro do site de cada escola.
// Para mudar o nome do produto basta alterar aqui (e em lib/config/marca.dart na app móvel).
const MARCA = {
  nome: 'Assídua',
  slogan: 'Cada aula conta.',
  descricao: 'Gestão da assiduidade dos professores',

  // Símbolo: uma pessoa de braços no ar a dizer "presente!", desenhada com um visto
  simbolo: '/img/marca/simbolo.svg',
  simboloPng: '/img/marca/simbolo-180.png',

  cores: {
    azul: '#1B4BC2', // Azul Atlântico — cor principal
    tinta: '#0E1F4D', // Azul-tinta — fundos escuros e texto de destaque
    sol: '#F6B900', // Amarelo Sol — acento (as estrelas da bandeira de Cabo Verde)
    nevoa: '#E8EEFB' // Fundo suave
  }
};

module.exports = { MARCA };
