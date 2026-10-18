import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors';
import { validate } from '../middleware/validate';
import {
  createPatientBodySchema,
  listPatientsQuerySchema,
  patientParamsSchema,
  updatePatientBodySchema,
} from '../schemas/patient';

type ValidationSchemas = Parameters<typeof validate>[0];

function run(schemas: ValidationSchemas, req: Request): ApiError | undefined {
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  validate(schemas)(req, {} as Response, next);
  return next.mock.calls[0]?.[0] as ApiError | undefined;
}

function makeRequest(partial: Partial<Request>): Request {
  return {
    body: {},
    params: {},
    query: {},
    ...partial,
  } as unknown as Request;
}

describe('validate middleware', () => {
  test('passes a valid body and replaces req.body', () => {
    const req = makeRequest({ body: { subjectId: 'SCHZ_001', age: 34 } });

    const err = run({ body: createPatientBodySchema }, req);

    expect(err).toBeUndefined();
    expect(req.body).toEqual({ subjectId: 'SCHZ_001', age: 34 });
  });

  test('rejects an out-of-range age', () => {
    const req = makeRequest({ body: { subjectId: 'SCHZ_001', age: 200 } });

    const err = run({ body: createPatientBodySchema }, req);

    expect(err).toBeInstanceOf(ApiError);
    expect(err?.status).toBe(400);
    expect(err?.code).toBe('VALIDATION_ERROR');
    expect(err?.details).toEqual([expect.objectContaining({ field: 'age' })]);
  });

  test('rejects a missing subjectId', () => {
    const req = makeRequest({ body: { age: 34 } });

    const err = run({ body: createPatientBodySchema }, req);

    expect(err?.details).toEqual([
      expect.objectContaining({ field: 'subjectId' }),
    ]);
  });

  test('prefixes invalid path params', () => {
    const req = makeRequest({ params: { id: 'not-a-uuid' } });

    const err = run({ params: patientParamsSchema }, req);

    expect(err?.details).toEqual([
      expect.objectContaining({ field: 'params.id' }),
    ]);
  });

  test('prefixes invalid query values', () => {
    const req = makeRequest({ query: { page: 'zero' } });

    const err = run({ query: listPatientsQuerySchema }, req);

    expect(err?.details).toEqual([expect.objectContaining({ field: 'query.page' })]);
  });

  test('rejects an empty update body', () => {
    const req = makeRequest({ body: {} });

    const err = run({ body: updatePatientBodySchema }, req);

    expect(err?.details).toEqual([expect.objectContaining({ field: '(root)' })]);
  });
});
