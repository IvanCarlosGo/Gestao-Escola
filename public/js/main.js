// Data atual no topbar (ex: "Seg, 22 Set 2025")
const dataAtualEl = document.getElementById('dataAtual');
if (dataAtualEl) {
  const hoje = new Date();
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  dataAtualEl.textContent = `${dias[hoje.getDay()]}, ${hoje.getDate()} ${meses[hoje.getMonth()]} ${hoje.getFullYear()}`;
}

// Menu mobile (sidebar)
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebarOverlay');
const toggleBtn = document.getElementById('menuToggle');

function toggleSidebar() {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}

if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
if (overlay) overlay.addEventListener('click', toggleSidebar);

// Confirmação antes de eliminar
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    const msg = form.getAttribute('data-confirm') || 'Tem a certeza?';
    if (!confirm(msg)) e.preventDefault();
  });
});

// Contador de caracteres em textareas (data-counter="id do contador")
document.querySelectorAll('textarea[data-counter]').forEach((ta) => {
  const counter = document.getElementById(ta.dataset.counter);
  const max = ta.getAttribute('maxlength') || 500;
  const update = () => { if (counter) counter.textContent = `${ta.value.length}/${max}`; };
  ta.addEventListener('input', update);
  update();
});

// Menus de ações (⋮) — fecha ao clicar fora
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.row-menu[open]').forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});
