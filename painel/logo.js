// Logótipo das escolas: chega como data URL (FileReader no browser) e é guardado em public/img/escolas/
const fs = require('fs/promises');
const path = require('path');

const PASTA = path.join(__dirname, '..', 'public', 'img', 'escolas');
const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_BYTES = 1024 * 1024; // 1 MB

// Devolve { caminho } com o URL público, ou { erro } se o ficheiro não for válido
async function guardarLogo(escolaId, dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { erro: 'O logótipo tem de ser uma imagem PNG, JPG ou WEBP.' };

  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_BYTES) return { erro: 'O logótipo pode ter no máximo 1 MB.' };

  // Confirma pelo conteúdo que é mesmo uma imagem do tipo indicado
  const assinaturas = {
    'image/png': (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/webp': (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'
  };
  if (!assinaturas[m[1]](bytes)) return { erro: 'O ficheiro não é uma imagem válida.' };

  await fs.mkdir(PASTA, { recursive: true });
  const nome = `${Number(escolaId)}-${Date.now()}.${TIPOS[m[1]]}`;
  await fs.writeFile(path.join(PASTA, nome), bytes);
  return { caminho: `/img/escolas/${nome}` };
}

// Apaga um logótipo antigo, só se estiver na pasta dos logótipos carregados
async function apagarLogo(caminho) {
  if (!caminho || !/^\/img\/escolas\/[\w.-]+$/.test(caminho)) return;
  await fs.unlink(path.join(PASTA, path.basename(caminho))).catch(() => {});
}

module.exports = { guardarLogo, apagarLogo };
