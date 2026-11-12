import type { PrincipalValidator } from '../middleware/auth';

export const acceptSignedPrincipals: PrincipalValidator = async (principal) =>
  principal;
