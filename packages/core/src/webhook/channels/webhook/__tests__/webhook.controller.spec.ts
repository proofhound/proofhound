import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookController } from '../webhook.controller';
import { WebhookService } from '../webhook.service';

describe('WebhookController', () => {
  let app: INestApplication;
  const service = {
    receive: vi.fn(),
    getCallResult: vi.fn(),
  };

  beforeEach(async () => {
    service.receive.mockResolvedValue({ status: 'success' });
    service.getCallResult.mockResolvedValue({ status: 'completed' });
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('receives a root public webhook path', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/wh-a3a1b2c3')
      .set('Authorization', 'Bearer ph_api_test')
      .send({ id: 'sample-1' })
      .expect(201, { status: 'success' });

    expect(service.receive).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookSlug: 'wh-a3a1b2c3',
        pathName: '',
        body: { id: 'sample-1' },
        authorization: 'Bearer ph_api_test',
      }),
    );
  });

  it('receives a nested connector path and async call query', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/webhook-slug/risk/sql-review')
      .set('Authorization', 'Bearer ph_api_test')
      .send({ id: 'sample-1' })
      .expect(201, { status: 'success' });

    expect(service.receive).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webhookSlug: 'webhook-slug',
        pathName: 'risk/sql-review',
      }),
    );

    await request(app.getHttpServer())
      .get('/webhooks/webhook-slug/risk/sql-review/calls/88888888-8888-4888-8888-888888888888')
      .set('Authorization', 'Bearer ph_api_test')
      .expect(200, { status: 'completed' });

    expect(service.getCallResult).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookSlug: 'webhook-slug',
        pathName: 'risk/sql-review',
        callId: '88888888-8888-4888-8888-888888888888',
      }),
    );
  });
});
