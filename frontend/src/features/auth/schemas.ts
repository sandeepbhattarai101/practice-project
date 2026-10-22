import { z } from 'zod';
import { passwordProblem } from './api';

export const emailField = z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.');

/** Contract rule: 10–128 characters, including a letter and a digit. */
export const newPasswordField = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});
