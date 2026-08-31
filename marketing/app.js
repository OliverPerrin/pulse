const header = document.querySelector('#site-header');
let lastScroll = window.scrollY;

window.addEventListener('scroll', () => {
  const current = window.scrollY;
  header.classList.toggle('is-condensed', current > 24);
  header.classList.toggle('is-hidden', current > lastScroll && current > 140);
  lastScroll = current;
}, { passive: true });

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  });
}, { threshold: .14, rootMargin: '0px 0px -7% 0px' });

document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));

if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  document.querySelectorAll('.primary-cta, .nav-download').forEach((button) => {
    button.addEventListener('pointermove', (event) => {
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * .08;
      const y = (event.clientY - rect.top - rect.height / 2) * .12;
      button.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
    button.addEventListener('pointerleave', () => { button.style.transform = ''; });
  });
}
