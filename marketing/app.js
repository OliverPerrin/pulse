const header = document.querySelector('#site-header');
const updateHeader = () => header.classList.toggle('is-condensed', window.scrollY > 24);
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();
