process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.ANALOG_SITE_KEY_SECRET ??= "test-site-key-secret-32chars";
process.env.ANALOG_ENROLLMENT_SECRET ??= "test-enrollment-secret-32chars";
process.env.ANALOG_PROVIDER_WEBHOOK_SECRET ??= "test-provider-secret-32chars";
process.env.ANALOG_OS_WEBHOOK_SECRET ??= "test-os-secret-32chars";
process.env.ANALOG_DASHBOARD_PASSWORD ??= "test-dashboard-password-32chars";
