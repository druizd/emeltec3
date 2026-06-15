const form = document.querySelector('#contact-form');
const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('#site-nav');
const testimonialTrack = document.querySelector('[data-testimonial-track]');
const testimonialCards = Array.from(document.querySelectorAll('.testimonial-card'));
const testimonialPrev = document.querySelector('[data-testimonial-prev]');
const testimonialNext = document.querySelector('[data-testimonial-next]');
const testimonialDots = document.querySelector('[data-testimonial-dots]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let activeTestimonial = 0;
let testimonialTimer;

const closeMenu = () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  nav?.classList.remove('is-open');
};

const renderTestimonial = (index) => {
  if (!testimonialTrack || testimonialCards.length === 0) {
    return;
  }

  activeTestimonial = (index + testimonialCards.length) % testimonialCards.length;
  testimonialTrack.style.transform = `translateX(-${activeTestimonial * 100}%)`;

  testimonialDots?.querySelectorAll('button').forEach((dot, dotIndex) => {
    dot.classList.toggle('is-active', dotIndex === activeTestimonial);
    dot.setAttribute('aria-selected', String(dotIndex === activeTestimonial));
  });
};

const startTestimonialAutoplay = () => {
  if (prefersReducedMotion || testimonialCards.length < 2) {
    return;
  }

  clearInterval(testimonialTimer);
  testimonialTimer = setInterval(() => renderTestimonial(activeTestimonial + 1), 5200);
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

testimonialCards.forEach((_, index) => {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.setAttribute('aria-label', `Ver testimonio ${index + 1}`);
  dot.setAttribute('role', 'tab');
  dot.addEventListener('click', () => {
    renderTestimonial(index);
    startTestimonialAutoplay();
  });
  testimonialDots?.append(dot);
});

testimonialPrev?.addEventListener('click', () => {
  renderTestimonial(activeTestimonial - 1);
  startTestimonialAutoplay();
});

testimonialNext?.addEventListener('click', () => {
  renderTestimonial(activeTestimonial + 1);
  startTestimonialAutoplay();
});

renderTestimonial(0);
startTestimonialAutoplay();

const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const accessKey = form.dataset.web3formsKey || '';
  const submitButton = form.querySelector('.submit-button');
  const submitLabel = submitButton?.querySelector('span');
  const status = form.querySelector('.form-status');

  const setStatus = (type, message) => {
    if (!status) {
      return;
    }

    status.classList.remove('is-success', 'is-error', 'is-visible');
    if (!message) {
      status.textContent = '';
      return;
    }
    status.textContent = message;
    status.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
  };

  // Honeypot: si viene marcado, es bot → ignorar en silencio.
  if (data.get('botcheck')) {
    return;
  }

  if (!accessKey || accessKey === 'TU_ACCESS_KEY_WEB3FORMS') {
    setStatus('error', 'El formulario aún no está configurado. Escríbenos a ventas@emeltec.cl.');
    return;
  }

  const payload = {
    access_key: accessKey,
    subject: `Solicitud de contacto Emeltec Cloud - ${data.get('empresa') || data.get('nombre')}`,
    from_name: 'Landing Emeltec Cloud',
    nombre: data.get('nombre') || '',
    email: data.get('email') || '',
    empresa: data.get('empresa') || '',
    telefono: data.get('telefono') || '',
    servicio: data.get('servicio') || '',
    mensaje: data.get('mensaje') || '',
    replyto: data.get('email') || '',
  };

  submitButton?.setAttribute('disabled', 'true');
  if (submitLabel) submitLabel.textContent = 'Enviando...';
  setStatus('', '');

  try {
    const response = await fetch(WEB3FORMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (response.ok && result.success) {
      setStatus('success', '¡Gracias! Recibimos tu solicitud. Te contactaremos a la brevedad.');
      form.reset();
    } else {
      setStatus('error', 'No pudimos enviar el formulario. Intenta de nuevo o escríbenos a ventas@emeltec.cl.');
    }
  } catch (error) {
    setStatus('error', 'Error de conexión. Intenta de nuevo o escríbenos a ventas@emeltec.cl.');
  } finally {
    submitButton?.removeAttribute('disabled');
    if (submitLabel) submitLabel.textContent = 'Enviar formulario';
  }
});

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
      scale: 1.06,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });

    const revealTargets = [
      '.problem-copy',
      '.problem-grid article',
      '.section-heading',
      '.solution-card',
      '.about-copy',
      '.about-media',
      '.client-carousel',
      '.testimonial-shell',
      '.contact-info',
      '.contact-form',
    ].join(',');

    gsap.utils.toArray(revealTargets).forEach((element, index) => {
      gsap.fromTo(
        element,
        { opacity: 0, y: 34, scale: 0.985 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.82,
          ease: 'power3.out',
          delay: Math.min(index % 3, 2) * 0.04,
          scrollTrigger: {
            trigger: element,
            start: 'top 88%',
            toggleActions: 'play none none reverse',
          },
        },
      );
    });
  }
}
