console.log('cgrid-positions: bootstrapping');
// Real grid wiring lands in Task 26.
const host = document.getElementById('grid');
if (host) host.textContent = 'Initializing grid…';

document.getElementById('theme')?.addEventListener('click', () => {
  const h = document.getElementById('grid');
  if (!h) return;
  h.classList.toggle('cg-theme-quartz');
  h.classList.toggle('cg-theme-quartz-dark');
});
