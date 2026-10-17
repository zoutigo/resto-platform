import pg from 'pg';
import { API_URL, NEW_PIN, PIN, uniqueEmail, uniquePhone } from './data';

type Json = Record<string, unknown>;

export interface Account {
  phone: string;
  pin: string;
  name: string;
  userId: string;
  accessToken: string;
  recoveryCode: string;
}

export interface OwnerWithRestaurant extends Account {
  restaurantId: string;
  restaurantName: string;
}

/**
 * Prépare des données par l'API réelle (comptes, restaurant, employés) pour que chaque test
 * d'interface se concentre sur l'écran qu'il vérifie. Toutes les requêtes portent l'IP du test.
 */
export class ApiHelper {
  constructor(
    readonly baseUrl: string = API_URL,
    readonly ip: string,
  ) {}

  async call<T = Json>(
    path: string,
    init: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': this.ip,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok)
      throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${text}`);
    return data as T;
  }

  async registerCustomer(
    over: Partial<{ name: string; phone: string; pin: string }> = {},
  ): Promise<Account> {
    const body = {
      name: 'Awa Mbarga',
      phone: uniquePhone(),
      pin: PIN,
      pinConfirm: over.pin ?? PIN,
      birthDate: { day: 5, month: 3, year: 1990 },
      recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Douala' }],
      ...over,
    };
    if (over.pin) body.pinConfirm = over.pin;
    const res = await this.call<{
      user: { id: string };
      accessToken: string;
      recoveryCode: string;
    }>('/auth/customer/register', { body });
    return {
      phone: body.phone,
      pin: body.pin,
      name: body.name,
      userId: res.user.id,
      accessToken: res.accessToken,
      recoveryCode: res.recoveryCode,
    };
  }

  async registerOwner(
    over: Partial<{ firstName: string; lastName: string; phone: string; pin: string }> = {},
  ) {
    const body = {
      firstName: 'Paul',
      lastName: 'Essomba',
      phone: uniquePhone(),
      pin: PIN,
      pinConfirm: over.pin ?? PIN,
      birthDate: { day: 12, month: 11, year: 1980 },
      recoveryAnswers: [
        { question: 'BIRTH_CITY', answer: 'Bafoussam' },
        { question: 'FAVORITE_SPORT', answer: 'Football' },
      ],
      ...over,
    };
    if (over.pin) body.pinConfirm = over.pin;
    const res = await this.call<{
      user: { id: string };
      accessToken: string;
      recoveryCode: string;
    }>('/auth/staff/register', { body });
    return {
      phone: body.phone,
      pin: body.pin,
      name: `${body.firstName} ${body.lastName}`,
      userId: res.user.id,
      accessToken: res.accessToken,
      recoveryCode: res.recoveryCode,
    } satisfies Account;
  }

  /** Propriétaire inscrit, avec un restaurant déjà créé. */
  async ownerWithRestaurant(
    restaurantName = `Chez Mama ${Math.floor(Math.random() * 1e6)}`,
  ): Promise<OwnerWithRestaurant> {
    const owner = await this.registerOwner();
    const restaurant = await this.call<{ id: string }>('/restaurants', {
      body: { name: restaurantName, city: 'Douala' },
      token: owner.accessToken,
    });
    return { ...owner, restaurantId: restaurant.id, restaurantName };
  }

  /** Ajoute un employé ; renvoie son PIN temporaire. */
  async addStaff(
    owner: OwnerWithRestaurant,
    role: 'SUPERVISOR' | 'WAITER' | 'CASHIER' | 'PREPARATOR',
    name = 'Jean Nkoulou',
  ) {
    const phone = uniquePhone();
    const res = await this.call<{ member: { userId: string }; temporaryPin: string }>(
      `/restaurants/${owner.restaurantId}/team`,
      { body: { name, phone, role }, token: owner.accessToken },
    );
    return { phone, name, userId: res.member.userId, temporaryPin: res.temporaryPin };
  }

  /** Dernier code à 6 chiffres envoyé à une adresse (attend l'arrivée du message). */
  async emailCode(email: string, timeoutMs = 8000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = await this.call<{ code: string | null }[]>(
        `/__test/emails?to=${encodeURIComponent(email)}`,
      );
      const last = messages.at(-1);
      if (last?.code) return last.code;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Aucun email reçu pour ${email}`);
  }

  /** Compte « email + mot de passe » créé par l'API (inscription en deux temps). */
  async registerByEmail(
    audience: 'staff' | 'customer',
    over: Partial<{ email: string; password: string; name: string }> = {},
  ) {
    const email = over.email ?? uniqueEmail();
    const password = over.password ?? 'Soleil-2026';
    const name = over.name ?? 'Awa Mbarga';
    await this.call(`/auth/${audience}/register-email`, {
      body: { name, email, password, passwordConfirm: password },
    });
    const code = await this.emailCode(email);
    const res = await this.call<{ user: { id: string }; accessToken: string }>(
      `/auth/${audience}/register-email/verify`,
      { body: { email, code } },
    );
    return { email, password, name, userId: res.user.id, accessToken: res.accessToken };
  }

  /** Premier changement de PIN d'un employé : renvoie ses identifiants définitifs. */
  async activateStaff(staff: { phone: string; temporaryPin: string }, pin = NEW_PIN) {
    const login = await this.call<{ accessToken: string }>('/auth/staff/login', {
      body: { phone: staff.phone, pin: staff.temporaryPin },
    });
    await this.call('/auth/staff/pin', {
      body: { currentPin: staff.temporaryPin, newPin: pin, newPinConfirm: pin },
      token: login.accessToken,
    });
    return { phone: staff.phone, pin };
  }
}

/**
 * Avance l'horloge d'une récupération différée : la rend échue (la base de test est la seule
 * à jamais modifiée ainsi ; l'URL doit contenir « test »).
 */
export async function makeRecoveryDue(userId: string): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://resto:resto@localhost:5433/resto_test';
  if (!new URL(url).pathname.includes('test'))
    throw new Error('Refus de modifier une base qui n’est pas une base de test.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `UPDATE "RecoveryRequest" SET "availableAt" = now() - interval '1 minute' WHERE "userId" = $1 AND status = 'PENDING'`,
      [userId],
    );
  } finally {
    await client.end();
  }
}
