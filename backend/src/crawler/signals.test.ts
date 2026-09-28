import { describe, expect, it } from 'vitest';
import { parsePage } from './document.js';
import { pageSignals } from './signals.js';

const signaux = (html: string, url = 'https://www.acme.fr/') =>
  pageSignals(parsePage(html, new URL(url)));

describe('pageSignals', () => {
  it('reconnait un formulaire de contact a sa zone de message (F-408)', () => {
    expect(
      signaux('<form><input type="email" name="email"><textarea name="message"></textarea></form>')
        .contactForm,
    ).toBe(true);
  });

  it('ne prend pas une inscription a la lettre d information ni une recherche pour un contact', () => {
    expect(signaux('<form><input type="email"><button>OK</button></form>').contactForm).toBe(false);
    expect(signaux('<form role="search"><input name="q"></form>').contactForm).toBe(false);
  });

  it('releve le lien vers la page carrieres, sur le site ou chez une plateforme (F-408)', () => {
    expect(signaux('<a href="/nous-rejoindre">Nous rejoindre</a>').careersUrl?.pathname).toBe(
      '/nous-rejoindre',
    );
    expect(
      signaux('<a href="https://www.welcometothejungle.com/fr/companies/acme">Jobs</a>').careersUrl
        ?.hostname,
    ).toBe('www.welcometothejungle.com');
    expect(
      signaux('<a href="https://autre.fr/carrieres">Carrieres</a>').careersUrl,
    ).toBeUndefined();
  });

  it('signale une page construite par JavaScript (F-412)', () => {
    const html =
      '<html><body><noscript>Activez JavaScript pour voir ce site.</noscript><div id="root"></div><script src="/app.js"></script></body></html>';
    expect(signaux(html).dynamicContent).toBe(true);
  });

  it('ne prend pas une page courte ordinaire pour une page dynamique', () => {
    expect(signaux('<p>Acme, artisan a Lyon.</p>').dynamicContent).toBe(false);
    expect(
      signaux(
        `<main><p>${'Texte lisible. '.repeat(30)}</p></main><div id="root"></div><script src="/a.js"></script>`,
      ).dynamicContent,
    ).toBe(false);
  });

  it('releve le standard et la page LinkedIn de l entreprise (F-409)', () => {
    const resultat = signaux(
      '<a href="tel:+33 1 02 03 04 05">Appeler</a><a href="https://fr.linkedin.com/company/acme/posts">LinkedIn</a>',
    );
    expect(resultat.phone).toBe('+33102030405');
    expect(resultat.linkedinUrl).toBe('https://www.linkedin.com/company/acme');
  });

  it('reconnait une page de mentions legales, par son adresse ou son titre', () => {
    expect(signaux('<p>x</p>', 'https://acme.fr/mentions-legales').legalNotice).toBe(true);
    expect(signaux('<h1>Mentions légales</h1>', 'https://acme.fr/infos').legalNotice).toBe(true);
    expect(signaux('<h1>Contact</h1>', 'https://acme.fr/contact').legalNotice).toBe(false);
  });
});
