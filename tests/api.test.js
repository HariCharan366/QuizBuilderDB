/**
 * QuizBuilder Automated Test Suite (Jest + Supertest)
 * Tests run against isolated test environment
 */
const request = require('supertest');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
const { app } = require('../backend/server');

describe('QuizBuilder Core Security & API Test Suite', () => {
  describe('Static & Resource Protection', () => {
    test('Blocks access to root /.env', async () => {
      const res = await request(app).get('/.env');
      expect(res.status).toBe(404);
    });

    test('Blocks access to /backend/server.js', async () => {
      const res = await request(app).get('/backend/server.js');
      expect(res.status).toBe(404);
    });

    test('Blocks access to /package.json', async () => {
      const res = await request(app).get('/package.json');
      expect(res.status).toBe(404);
    });
  });

  describe('Health Endpoint', () => {
    test('GET /api/health returns online status', async () => {
      const res = await request(app).get('/api/health');
      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.status).toBe('online');
      }
    });
  });

  describe('Authentication Input Validation (express-validator)', () => {
    test('POST /api/auth/register rejects short passwords (< 8 chars)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: 'Test User',
          username: 'validuser123',
          password: '123'
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/register rejects empty fullName or username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          fullName: '',
          username: '',
          password: 'Password123'
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/login rejects missing credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/admin/login rejects missing credentials with 400', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Protected Routes Security', () => {
    test('GET /api/admin/stats rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/admin/audit-logs rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/admin/analytics rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/analytics');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/results/my-history rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/results/my-history');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Retake Permissions & Attempt Tracking', () => {
    test('GET /api/admin/exam-activity?status=Retake rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/exam-activity?status=Retake');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/admin/students/:id/grant-retake rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/admin/students/64b1f8e12345678901234567/grant-retake');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/exams/:id/grant-retake rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/exams/64b1f8e12345678901234567/grant-retake');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
