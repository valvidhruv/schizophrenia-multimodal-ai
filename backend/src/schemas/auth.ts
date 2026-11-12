import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../services/passwordService';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('A valid email address is required.')
  .max(255);

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`
  );

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.').max(PASSWORD_MAX_LENGTH),
});

export const registerBodySchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(1, 'fullName is required.').max(255),
  role: z.enum(['admin', 'clinician', 'researcher']),
  password: passwordSchema,
});

export const updateProfileBodySchema = z.object({
  fullName: z.string().trim().min(1, 'fullName is required.').max(255),
});

export const changePasswordBodySchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'Current password is required.')
      .max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must be different from the current password.',
    path: ['newPassword'],
  });

export const refreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required.').max(512),
});
