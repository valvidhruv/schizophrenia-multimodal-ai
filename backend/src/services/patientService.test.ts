import {
  createSqlPatientStore,
  type PatientQueryFn,
  type PatientRecord,
} from './patientService';
import { ApiError } from '../errors';

const PATIENT_ID = '44444444-4444-4444-8444-444444444444';

const patientRow = {
  id: PATIENT_ID,
  subject_id: 'SCHZ_001',
  diagnosis: 'schizophrenia',
  age: 35,
  sex: 'male',
  handedness: 'right',
  eeg_available: true,
  smri_available: false,
  fmri_available: true,
  clinical_available: true,
  panss_available: true,
  created_at: new Date('2026-10-18T01:02:03.000Z'),
  updated_at: new Date('2026-10-18T04:05:06.000Z'),
};

const mappedPatient: PatientRecord = {
  id: PATIENT_ID,
  subjectId: 'SCHZ_001',
  diagnosis: 'schizophrenia',
  age: 35,
  sex: 'male',
  handedness: 'right',
  eegAvailable: true,
  smriAvailable: false,
  fmriAvailable: true,
  clinicalAvailable: true,
  panssAvailable: true,
  createdAt: '2026-10-18T01:02:03.000Z',
  updatedAt: '2026-10-18T04:05:06.000Z',
};

interface CapturedCall {
  text: string;
  params: unknown[];
}

function fakeQuery(
  impl: (text: string, params: unknown[]) => Promise<unknown[]>
): { queryFn: PatientQueryFn; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const queryFn: PatientQueryFn = async <T>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return (await impl(text, params)) as T[];
  };
  return { queryFn, calls };
}

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: '23505',
    constraint,
  });
}

describe('createSqlPatientStore - create', () => {
  test('inserts with placeholders only and never embeds values in SQL', async () => {
    const hostileSubject = "SCHZ' OR 1=1; --";
    const { queryFn, calls } = fakeQuery(async () => [patientRow]);
    const store = createSqlPatientStore({ queryFn });

    await store.create({ subjectId: hostileSubject });

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain(
      'INSERT INTO patients (subject_id, diagnosis, age, sex, handedness, created_by)'
    );
    expect(calls[0].text).toContain('VALUES ($1, $2, $3, $4, $5, NULL)');
    expect(calls[0].text).not.toContain(hostileSubject);
    expect(calls[0].text).not.toContain('OR 1=1');
    expect(calls[0].params).toEqual([hostileSubject, null, null, null, null]);
  });

  test('maps the returned row to the camelCase API record', async () => {
    const { queryFn } = fakeQuery(async () => [patientRow]);
    const store = createSqlPatientStore({ queryFn });

    const record = await store.create({
      subjectId: 'SCHZ_001',
      diagnosis: 'schizophrenia',
      age: 35,
      sex: 'male',
      handedness: 'right',
    });

    expect(record).toEqual(mappedPatient);
  });

  test('passes provided optional fields as parameters', async () => {
    const { queryFn, calls } = fakeQuery(async () => [patientRow]);
    const store = createSqlPatientStore({ queryFn });

    await store.create({ subjectId: 'SCHZ_001', age: 42 });

    expect(calls[0].params).toEqual(['SCHZ_001', null, 42, null, null]);
  });

  test('maps 23505 on patients_subject_id_key to a 409 ApiError', async () => {
    const { queryFn } = fakeQuery(async () => {
      throw uniqueViolation('patients_subject_id_key');
    });
    const store = createSqlPatientStore({ queryFn });

    await expect(store.create({ subjectId: 'SCHZ_001' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'CONFLICT',
    });
  });

  test('the 409 message does not echo the subject id or any SQL', async () => {
    const { queryFn } = fakeQuery(async () => {
      throw uniqueViolation('patients_subject_id_key');
    });
    const store = createSqlPatientStore({ queryFn });

    const err = await store.create({ subjectId: 'SECRET_SUBJECT_777' }).catch((e: unknown) => e);
    const apiError = err as ApiError;

    expect(apiError.message).toBe('A patient with this subjectId already exists.');
    expect(apiError.message).not.toContain('SECRET_SUBJECT_777');
    expect(apiError.message).not.toContain('INSERT');
  });

  test('wraps 23505 raised on any other constraint in a log-safe error', async () => {
    const { queryFn } = fakeQuery(async () => {
      throw uniqueViolation('patients_created_by_fkey');
    });
    const store = createSqlPatientStore({ queryFn });

    const err = (await store
      .create({ subjectId: 'SCHZ_001' })
      .catch((e: unknown) => e)) as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.name).not.toBe('ApiError');
    expect(err.message).toContain('23505');
    expect(err.message).toContain('patients_created_by_fkey');
    expect((err as { constraint?: unknown }).constraint).toBeUndefined();
  });

  test('wraps other database errors and drops enumerable driver properties', async () => {
    const failure = Object.assign(new Error('column "age" is of wrong type'), {
      code: '23514',
      detail: 'Failing row contains (SECRET_SUBJECT_777, 35)',
      schema: 'public',
      table: 'patients',
    });
    const { queryFn } = fakeQuery(async () => {
      throw failure;
    });
    const store = createSqlPatientStore({ queryFn });

    const err = (await store
      .create({ subjectId: 'SCHZ_001', age: 35 })
      .catch((e: unknown) => e)) as Error;

    expect(err).not.toBe(failure);
    expect(err.message).toBe(
      'Patient store operation failed: 23514: column "age" is of wrong type'
    );
    expect(err.message).not.toContain('SECRET_SUBJECT_777');
    expect((err as { detail?: unknown }).detail).toBeUndefined();
    expect((err as { table?: unknown }).table).toBeUndefined();
  });

  test('throws when the insert returns no row', async () => {
    const { queryFn } = fakeQuery(async () => []);
    const store = createSqlPatientStore({ queryFn });

    await expect(store.create({ subjectId: 'SCHZ_001' })).rejects.toThrow(
      'Patient insert returned no row'
    );
  });
});

describe('createSqlPatientStore - findById', () => {
  test('queries by placeholder and maps the row', async () => {
    const { queryFn, calls } = fakeQuery(async () => [patientRow]);
    const store = createSqlPatientStore({ queryFn });

    const record = await store.findById(PATIENT_ID);

    expect(record).toEqual(mappedPatient);
    expect(calls[0].text).toContain('WHERE id = $1');
    expect(calls[0].text).not.toContain(PATIENT_ID);
    expect(calls[0].params).toEqual([PATIENT_ID]);
  });

  test('returns null when the row does not exist', async () => {
    const { queryFn } = fakeQuery(async () => []);
    const store = createSqlPatientStore({ queryFn });

    await expect(store.findById(PATIENT_ID)).resolves.toBeNull();
  });

  test('maps string timestamps to ISO strings', async () => {
    const { queryFn } = fakeQuery(async () => [
      { ...patientRow, created_at: '2026-10-18T01:02:03.000Z', updated_at: '2026-10-18T04:05:06.000Z' },
    ]);
    const store = createSqlPatientStore({ queryFn });

    const record = await store.findById(PATIENT_ID);

    expect(record?.createdAt).toBe('2026-10-18T01:02:03.000Z');
    expect(record?.updatedAt).toBe('2026-10-18T04:05:06.000Z');
  });
});

describe('createSqlPatientStore - list', () => {
  test('runs a count query and a page query with computed limit and offset', async () => {
    const { queryFn, calls } = fakeQuery(async (text) =>
      text.includes('COUNT') ? [{ total: 45 }] : [patientRow]
    );
    const store = createSqlPatientStore({ queryFn });

    const page = await store.list({ page: 3, limit: 20 });

    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('SELECT COUNT(*)::int AS total FROM patients');
    expect(calls[0].text).not.toContain('WHERE');
    expect(calls[0].params).toEqual([]);
    expect(calls[1].text).toContain('ORDER BY created_at DESC, id DESC');
    expect(calls[1].text).toContain('LIMIT $1 OFFSET $2');
    expect(calls[1].params).toEqual([20, 40]);
    expect(page.pagination).toEqual({ page: 3, limit: 20, total: 45, totalPages: 3 });
    expect(page.data).toEqual([mappedPatient]);
  });

  test('builds filters from placeholders only, never inline values', async () => {
    const { queryFn, calls } = fakeQuery(async (text) =>
      text.includes('COUNT') ? [{ total: 2 }] : [patientRow]
    );
    const store = createSqlPatientStore({ queryFn });

    await store.list({ page: 1, limit: 20, diagnosis: 'schizophrenia', search: 'SCHZ' });

    expect(calls[0].text).toContain('WHERE diagnosis = $1');
    expect(calls[0].text).toContain('subject_id ILIKE $2 ESCAPE');
    expect(calls[0].params).toEqual(['schizophrenia', '%SCHZ%']);
    for (const call of calls) {
      expect(call.text).not.toContain('schizophrenia');
      expect(call.text).not.toContain('SCHZ');
    }
  });

  test('escapes percent, underscore, and backslash literally in search terms', async () => {
    const { queryFn, calls } = fakeQuery(async (text) =>
      text.includes('COUNT') ? [{ total: 1 }] : [patientRow]
    );
    const store = createSqlPatientStore({ queryFn });

    await store.list({ page: 1, limit: 20, search: '50%_x\\y' });

    expect(calls[0].params).toEqual(['%50\\%\\_x\\\\y%']);
    expect(calls[0].text).toContain("ESCAPE '\\'");
    expect(calls[0].text).not.toContain('50%');
    expect(calls[1].params).toEqual(['%50\\%\\_x\\\\y%', 20, 0]);
  });

  test('treats an empty search string as no filter', async () => {
    const { queryFn, calls } = fakeQuery(async (text) =>
      text.includes('COUNT') ? [{ total: 0 }] : []
    );
    const store = createSqlPatientStore({ queryFn });

    const page = await store.list({ page: 1, limit: 20, search: '' });

    expect(calls).toHaveLength(1);
    expect(calls[0].text).not.toContain('WHERE');
    expect(calls[0].params).toEqual([]);
    expect(page.data).toEqual([]);
  });

  test('skips the page query when the count is zero', async () => {
    const { queryFn, calls } = fakeQuery(async () => [{ total: 0 }]);
    const store = createSqlPatientStore({ queryFn });

    const page = await store.list({ page: 3, limit: 20 });

    expect(calls).toHaveLength(1);
    expect(page).toEqual({
      data: [],
      pagination: { page: 3, limit: 20, total: 0, totalPages: 0 },
    });
  });

  test('treats a missing count row as zero', async () => {
    const { queryFn } = fakeQuery(async () => []);
    const store = createSqlPatientStore({ queryFn });

    const page = await store.list({ page: 1, limit: 20 });

    expect(page.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  test('keeps total from the count query even when the page is beyond the last', async () => {
    const { queryFn, calls } = fakeQuery(async (text) =>
      text.includes('COUNT') ? [{ total: 3 }] : []
    );
    const store = createSqlPatientStore({ queryFn });

    const page = await store.list({ page: 9, limit: 20 });

    expect(calls).toHaveLength(2);
    expect(page.data).toEqual([]);
    expect(page.pagination).toEqual({ page: 9, limit: 20, total: 3, totalPages: 1 });
  });
});
