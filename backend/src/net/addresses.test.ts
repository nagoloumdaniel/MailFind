import { describe, expect, it } from 'vitest';
import { isForbiddenHostname, isForbiddenIp } from './addresses.js';

describe('isForbiddenIp, IPv4', () => {
  it('refuse la boucle locale', () => {
    expect(isForbiddenIp('127.0.0.1')).toBe(true);
    expect(isForbiddenIp('127.255.255.254')).toBe(true);
  });

  it('refuse les reseaux prives', () => {
    expect(isForbiddenIp('10.0.0.1')).toBe(true);
    expect(isForbiddenIp('172.16.0.1')).toBe(true);
    expect(isForbiddenIp('172.31.255.255')).toBe(true);
    expect(isForbiddenIp('192.168.1.1')).toBe(true);
  });

  it('refuse les metadonnees des hebergeurs cloud', () => {
    // C'est l'adresse qui rend une faille de ce type interessante pour un
    // attaquant : elle sert des identifiants d'infrastructure.
    expect(isForbiddenIp('169.254.169.254')).toBe(true);
  });

  it('refuse le lien local, le partage operateur et la diffusion', () => {
    expect(isForbiddenIp('169.254.1.1')).toBe(true);
    expect(isForbiddenIp('100.64.0.1')).toBe(true);
    expect(isForbiddenIp('224.0.0.1')).toBe(true);
    expect(isForbiddenIp('255.255.255.255')).toBe(true);
    expect(isForbiddenIp('0.0.0.0')).toBe(true);
  });

  it('accepte une adresse publique', () => {
    expect(isForbiddenIp('93.184.216.34')).toBe(false);
    expect(isForbiddenIp('8.8.8.8')).toBe(false);
    // Juste en dehors des plages privees, des deux cotes.
    expect(isForbiddenIp('172.15.255.255')).toBe(false);
    expect(isForbiddenIp('172.32.0.1')).toBe(false);
    expect(isForbiddenIp('11.0.0.1')).toBe(false);
  });

  it('refuse ce qui n est pas une adresse', () => {
    expect(isForbiddenIp('')).toBe(true);
    expect(isForbiddenIp('pas une ip')).toBe(true);
    expect(isForbiddenIp('999.1.1.1')).toBe(true);
    // Notation octale, qui designe 127.0.0.1 sur certains resolveurs.
    expect(isForbiddenIp('0177.0.0.1')).toBe(true);
  });
});

describe('isForbiddenIp, IPv6', () => {
  it('refuse la boucle locale et l adresse non specifiee', () => {
    expect(isForbiddenIp('::1')).toBe(true);
    expect(isForbiddenIp('::')).toBe(true);
  });

  it('refuse le lien local et les adresses locales uniques', () => {
    expect(isForbiddenIp('fe80::1')).toBe(true);
    expect(isForbiddenIp('fd00::1')).toBe(true);
    expect(isForbiddenIp('fc00::1')).toBe(true);
    expect(isForbiddenIp('ff02::1')).toBe(true);
  });

  it('voit l IPv4 cachee dans une adresse IPv6', () => {
    // Sans cette regle, ::ffff:127.0.0.1 ouvrirait la porte que le reste ferme.
    expect(isForbiddenIp('::ffff:127.0.0.1')).toBe(true);
    expect(isForbiddenIp('::ffff:169.254.169.254')).toBe(true);
    expect(isForbiddenIp('::ffff:93.184.216.34')).toBe(false);
  });

  it('accepte une adresse IPv6 publique', () => {
    expect(isForbiddenIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('refuse la plage de documentation', () => {
    expect(isForbiddenIp('2001:db8::1')).toBe(true);
  });
});

describe('isForbiddenHostname', () => {
  it('refuse les noms de la machine elle-meme', () => {
    expect(isForbiddenHostname('localhost')).toBe(true);
    expect(isForbiddenHostname('LOCALHOST')).toBe(true);
    expect(isForbiddenHostname('ip6-localhost')).toBe(true);
  });

  it('refuse les raccourcis de metadonnees', () => {
    expect(isForbiddenHostname('metadata.google.internal')).toBe(true);
    expect(isForbiddenHostname('metadata')).toBe(true);
  });

  it('refuse les domaines reserves a un usage local', () => {
    expect(isForbiddenHostname('serveur.local')).toBe(true);
    expect(isForbiddenHostname('intranet.corp')).toBe(true);
    expect(isForbiddenHostname('machine.lan')).toBe(true);
  });

  it('refuse un nom d hote qui est une adresse interdite', () => {
    expect(isForbiddenHostname('127.0.0.1')).toBe(true);
    expect(isForbiddenHostname('169.254.169.254')).toBe(true);
  });

  it('refuse une adresse IPv6 litterale, crochets compris', () => {
    // `URL.hostname` rend « [::1] » : sans retirer les crochets, ce n'etait
    // plus reconnu comme une adresse.
    expect(isForbiddenHostname('[::1]')).toBe(true);
    expect(isForbiddenHostname('[fe80::1]')).toBe(true);
    expect(isForbiddenHostname('[2606:2800:220:1:248:1893:25c8:1946]')).toBe(false);
  });

  it('accepte un domaine ordinaire', () => {
    expect(isForbiddenHostname('doctolib.fr')).toBe(false);
    expect(isForbiddenHostname('careers.example.com')).toBe(false);
    expect(isForbiddenHostname('exemple.fr.')).toBe(false);
  });

  it('refuse un nom vide', () => {
    expect(isForbiddenHostname('')).toBe(true);
  });
});
