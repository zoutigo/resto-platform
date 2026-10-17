// Environnement des tests unitaires : aucune connexion réelle n'est ouverte.
process.env.NODE_ENV = 'test';
process.env.AUTH_JWT_SECRET = 'test-only-jwt-secret-0123456789abcdefghij';
process.env.AUTH_PEPPER = 'test-only-pepper-0123456789abcdefghijkl';
