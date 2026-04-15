// Populate all required env vars before any module loads config.ts
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-16chars';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-api-key';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
