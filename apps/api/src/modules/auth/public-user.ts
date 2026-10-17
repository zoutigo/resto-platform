/** Vue publique d'un utilisateur : jamais d'empreinte ni de donnée de récupération. */
export function toPublicUser(user: {
  id: string;
  name: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  restrictedUntil: Date | null;
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    phoneVerified: user.phoneVerifiedAt !== null,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    restricted: user.restrictedUntil !== null && user.restrictedUntil.getTime() > Date.now(),
  };
}
