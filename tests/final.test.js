const request = require('supertest');
const app = require('../src/app');

describe('final stage placeholders', () => {
  it('returns 501 for final health', async () => {
    const response = await request(app).get('/api/final/health');

    expect(response.status).toBe(501);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'NOT_IMPLEMENTED',
      message: 'FINAL stage is reserved for Phase 2'
    }));
    expect(typeof response.body.request_id).toBe('string');
    expect(response.body.request_id.length).toBeGreaterThan(0);
  });
});
