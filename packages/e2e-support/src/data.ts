import { randomInt } from 'node:crypto';

/** PIN de test : solide (accepté par les schémas) et connu de tous les assistants. */
export const PIN = '483920';
export const NEW_PIN = '715204';
export const PASSWORD = 'Soleil-2026';

/** Numéro mobile camerounais unique par appel (9 chiffres commençant par 6). */
export const uniquePhone = () => `+2376${randomInt(10_000_000, 99_999_999)}`;

/** Forme saisissable dans le champ (sans +237), comme le ferait un utilisateur. */
export const localPhone = (phone: string) => phone.replace('+237', '');

export const uniqueEmail = () => `e2e${randomInt(1_000_000_000)}@example.cm`;

/** Chaque test a sa propre IP (TRUST_PROXY=1 côté API) : les compteurs anti-abus ne se mélangent pas. */
export const uniqueIp = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4010';
