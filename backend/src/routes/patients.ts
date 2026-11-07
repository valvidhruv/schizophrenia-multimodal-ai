import { Router, type RequestHandler } from 'express';
import { DISCLAIMER } from '../constants';
import { ApiError } from '../errors';
import { requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { notImplemented } from '../middleware/notImplemented';
import { validate } from '../middleware/validate';
import {
  createPatientBodySchema,
  listPatientsQuerySchema,
  patientParamsSchema,
  updatePatientBodySchema,
} from '../schemas/patient';
import type {
  CreatePatientInput,
  PatientStore,
} from '../services/patientService';

function listPatientsHandler(patientStore: PatientStore): RequestHandler {
  return asyncHandler(async (req, res) => {
    const query = listPatientsQuerySchema.parse(req.query);
    const page = await patientStore.list(query);
    res.status(200).json({ ...page, disclaimer: DISCLAIMER });
  });
}

function createPatientHandler(patientStore: PatientStore): RequestHandler {
  return asyncHandler(async (req, res) => {
    const input = req.body as CreatePatientInput;
    const record = await patientStore.create(input);
    res.status(201).json({ ...record, disclaimer: DISCLAIMER });
  });
}

function getPatientHandler(patientStore: PatientStore): RequestHandler {
  return asyncHandler(async (req, res) => {
    const record = await patientStore.findById(req.params.id);
    if (!record) {
      throw ApiError.notFound('Patient not found.');
    }
    res.status(200).json({ ...record, disclaimer: DISCLAIMER });
  });
}

export function createPatientsRouter(patientStore?: PatientStore): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: listPatientsQuerySchema }),
    patientStore ? listPatientsHandler(patientStore) : notImplemented('Patient listing')
  );

  router.post(
    '/',
    requireRole('admin', 'clinician'),
    validate({ body: createPatientBodySchema }),
    patientStore ? createPatientHandler(patientStore) : notImplemented('Patient creation')
  );

  router.get(
    '/:id',
    validate({ params: patientParamsSchema }),
    patientStore ? getPatientHandler(patientStore) : notImplemented('Patient detail')
  );

  router.put(
    '/:id',
    requireRole('admin', 'clinician'),
    validate({ params: patientParamsSchema, body: updatePatientBodySchema }),
    notImplemented('Patient update')
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    validate({ params: patientParamsSchema }),
    notImplemented('Patient deletion')
  );

  return router;
}
