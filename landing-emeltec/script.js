const form = document.querySelector('#contact-form');
const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('#site-nav');

const closeMenu = () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  nav?.classList.remove('is-open');
};

menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  nav?.classList.toggle('is-open', !isOpen);
});

nav?.addEventListener('click', (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    closeMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenu();
  }
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const subject = encodeURIComponent('Solicitud diagnóstico Emeltec');
  const body = encodeURIComponent(
    [
      `Nombre: ${data.get('nombre') || ''}`,
      `Email: ${data.get('email') || ''}`,
      `Empresa: ${data.get('empresa') || ''}`,
      `Teléfono: ${data.get('telefono') || ''}`,
      `Servicio: ${data.get('servicio') || ''}`,
      '',
      `Mensaje: ${data.get('mensaje') || ''}`,
    ].join('\n'),
  );

  window.location.href = `mailto:ventas@emeltec.cl?subject=${subject}&body=${body}`;
});

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion && window.gsap) {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;

  if (ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }

  gsap.from('.hero-copy > *', {
    opacity: 0,
    y: 24,
    duration: 0.8,
    ease: 'power3.out',
    stagger: 0.08,
  });

  gsap.from('.monitor-card', {
    opacity: 0,
    y: 34,
    scale: 0.96,
    duration: 0.9,
    ease: 'power3.out',
    delay: 0.18,
  });

  if (ScrollTrigger) {
    gsap.to('.hero-bg', {
      scale: 1.08,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });

    const revealTargets = [
      '.section-heading',
      '.solution-card',
      '.about-copy',
      '.about-media',
      '.proof-grid article',
      '.testimonial-grid article',
      '.contact-info',
      '.contact-form',
    ].join(',');

    gsap.utils.toArray(revealTargets).forEach((element, index) => {
      gsap.fromTo(
        element,
        {
          opacity: 0,
          y: 38,
          scale: 0.98,
        },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.86,
          ease: 'power3.out',
          delay: Math.min(index % 3, 2) * 0.05,
          scrollTrigger: {
            trigger: element,
            start: 'top 86%',
            toggleActions: 'play none none reverse',
          },
        },
      );
    });
  }
}
