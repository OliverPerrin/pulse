const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('#motion-toggle');
let paused = reducedMotion.matches;
let sculptureController;

function updateMotion() {
  document.documentElement.classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Play motion' : 'Pause motion';
  sculptureController?.refresh();
}
motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; updateMotion(); });

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    panel.hidden = !selected;
    panel.classList.toggle('is-entering', selected && !paused);
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(tabs[next], true);
  });
}

const demo = document.querySelector('#demo-perspective');
const demoWindow = document.querySelector('#demo-window');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
demo.addEventListener('pointermove', event => {
  if (paused || !finePointer.matches || innerWidth <= 800) return;
  const rect = demo.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - .5;
  const y = (event.clientY - rect.top) / rect.height - .5;
  demoWindow.style.transform = `rotateX(${3 - y * 3}deg) rotateY(${x * 3}deg)`;
});
demo.addEventListener('pointerleave', () => { demoWindow.style.transform = ''; });

// Use the actual app icon as a shallow 3D object. Movement is bounded, and
// CSS handles the slow float without a JavaScript render loop.
function createSculpture() {
  const host = document.querySelector('#sculpture');
  const icon = document.querySelector('#app-icon');
  let visible = true;
  function refresh() {
    host.classList.toggle('scene-idle', !visible || document.hidden || paused);
    if (paused) { icon.style.transform = ''; demoWindow.style.transform = ''; }
  }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); }, { rootMargin: '40px' }).observe(host);
  document.addEventListener('visibilitychange', refresh);
  host.addEventListener('pointermove', event => {
    if (paused || !finePointer.matches) return;
    const rect = host.getBoundingClientRect();
    const x = Math.max(-.5, Math.min(.5, (event.clientX - rect.left) / rect.width - .5));
    const y = Math.max(-.5, Math.min(.5, (event.clientY - rect.top) / rect.height - .5));
    icon.style.transform = `rotateX(${12 - y * 5}deg) rotateY(${-18 + x * 7}deg) rotateZ(-6deg)`;
    icon.style.setProperty('--reflection-x', `${35 + x * 30}%`);
    icon.style.setProperty('--reflection-y', `${15 + y * 25}%`);
  });
  host.addEventListener('pointerleave', () => {
    icon.style.transform = '';
    icon.style.removeProperty('--reflection-x');
    icon.style.removeProperty('--reflection-y');
  });
  refresh();
  return { refresh };
}
sculptureController = createSculpture();
updateMotion();
