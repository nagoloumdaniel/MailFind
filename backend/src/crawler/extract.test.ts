import { describe, expect, it } from 'vitest';
import { parsePage } from './document.js';
import { extractAddresses } from './extract.js';

const URL_PAGE = new URL('https://www.acme.fr/contact');
const extraire = (html: string) => extractAddresses(parsePage(html, URL_PAGE));
const adresses = (html: string) =>
  extraire(html).found.map((trouvee) => `${trouvee.address} ${trouvee.method}`);

describe('extractAddresses (F-406)', () => {
  it('lit un lien mailto, sans son sujet', () => {
    expect(
      adresses('<a href="mailto:Recrutement@Acme.FR?subject=Candidature">Postuler</a>'),
    ).toEqual(['Recrutement@acme.fr mailto']);
  });

  it('lit plusieurs adresses dans un meme mailto, et les decode', () => {
    expect(adresses('<a href="mailto:rh%40acme.fr,presse@acme.fr">RH</a>')).toEqual([
      'rh@acme.fr mailto',
      'presse@acme.fr mailto',
    ]);
  });

  it('lit une adresse dans le texte visible, sans coller les blocs voisins', () => {
    expect(adresses('<p>Ecrivez a contact@acme.fr</p><p>Tel 01 02 03 04 05</p>')).toEqual([
      'contact@acme.fr text',
    ]);
  });

  it('ne compte pas deux fois l adresse d un mailto qui s affiche aussi', () => {
    expect(adresses('<a href="mailto:contact@acme.fr">contact@acme.fr</a>')).toEqual([
      'contact@acme.fr mailto',
    ]);
  });

  it('lit un attribut qui porte une adresse', () => {
    expect(adresses('<button data-email="jobs@acme.fr">Nous ecrire</button>')).toEqual([
      'jobs@acme.fr attribute',
    ]);
  });

  it('lit les donnees structurees JSON-LD', () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Organization","email":"mailto:info@acme.fr",
       "contactPoint":[{"@type":"ContactPoint","email":"support@acme.fr"}]}
    </script>`;
    expect(adresses(html)).toEqual(['info@acme.fr json_ld', 'support@acme.fr json_ld']);
  });

  it('ignore un JSON-LD illisible sans echouer', () => {
    expect(adresses('<script type="application/ld+json">{pas du json</script>')).toEqual([]);
  });

  it('lit les microdonnees', () => {
    expect(adresses('<span itemprop="email">contact@acme.fr</span>')).toEqual([
      'contact@acme.fr microdata',
    ]);
  });

  it('lit les formes ecrites courantes', () => {
    expect(adresses('<p>contact [at] acme [point] fr</p>')).toEqual([
      'contact@acme.fr written_form',
    ]);
    expect(adresses('<p>recrutement(at)acme.fr</p>')).toEqual(['recrutement@acme.fr written_form']);
    expect(adresses('<p>presse {arobase} acme [dot] co [dot] uk</p>')).toEqual([
      'presse@acme.co.uk written_form',
    ]);
  });

  it('ne lit rien dans les scripts ni dans les styles', () => {
    expect(adresses('<script>var a = "dev@acme.fr";</script><style>/* x@y.fr */</style>')).toEqual(
      [],
    );
  });

  it('garde un extrait de contexte de 200 caracteres au plus', () => {
    const long = 'Bienvenue chez Acme. '.repeat(30);
    const [trouvee] = extraire(`<p>${long} Ecrivez-nous a contact@acme.fr. ${long}</p>`).found;
    expect(trouvee?.excerpt.length).toBeLessThanOrEqual(200);
    expect(trouvee?.excerpt).toContain('contact@acme.fr');
  });

  it('refuse ce qui n a que l allure d une adresse', () => {
    expect(adresses('<p>a@b @acme.fr contact@ acme@localhost x@acme.f</p>')).toEqual([]);
  });

  it('rend le meme resultat quel que soit l ordre de lecture', () => {
    const html = '<p>b@acme.fr</p><a href="mailto:a@acme.fr">A</a>';
    expect(adresses(html)).toEqual(['a@acme.fr mailto', 'b@acme.fr text']);
  });
});

describe('adresses masquees (F-407)', () => {
  it('signale une adresse protegee par Cloudflare, sans la decoder', () => {
    const html = `<a href="/cdn-cgi/l/email-protection#0e6d61607a6f6d7a4e6f6d6360206872">
      <span class="__cf_email__" data-cfemail="0e6d61607a6f6d7a4e6f6d6360206872">[email&#160;protected]</span></a>`;
    const resultat = extraire(html);
    expect(resultat.masked).toBe(true);
    expect(resultat.found).toEqual([]);
  });

  it('signale une adresse assemblee par un script, sans l executer', () => {
    const html = `<script>document.write('<a href="mai' + 'lto:' + 'contact' + '@' + 'acme.fr">ecrire</a>');</script>`;
    const resultat = extraire(html);
    expect(resultat.masked).toBe(true);
    expect(resultat.found).toEqual([]);
  });

  it('ne signale rien sur une page ordinaire', () => {
    expect(extraire('<p>contact@acme.fr</p>').masked).toBe(false);
  });
});
