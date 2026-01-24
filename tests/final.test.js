const request = require('supertest');
const app = require('../src/app');

describe('final stage placeholders', () => {
  it('returns 501 for final health', async () => {
    const response = await request(app).get('/api/final/health');

    expect(response.status).toBe(501);
    expect(response.body).toEqual({
      code: 'NOT_IMPLEMENTED',
      message: 'FINAL stage is reserved for Phase 2'
    });
  });
});
