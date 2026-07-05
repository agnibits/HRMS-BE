import { z } from 'zod';

/** Zod schemas for the AI endpoints. Guards payload size to protect token budget. */
export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']).default('user'),
        content: z.string().min(1).max(8000),
      })
    )
    .min(1, 'At least one message is required')
    .max(30),
  context: z.string().max(6000).optional().default(''),
});

export const generateJdSchema = z.object({
  title: z.string().trim().min(2).max(120),
  department: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  type: z.string().trim().max(60).optional(),
  seniority: z.string().trim().max(60).optional(),
});

export const screenResumeSchema = z.object({
  jobTitle: z.string().trim().min(2).max(120),
  resumeText: z.string().trim().min(30, 'Resume text is too short').max(20000),
});

export const summarizeSchema = z.object({
  text: z.string().trim().min(30, 'Document text is too short').max(20000),
});

export default { chatSchema, generateJdSchema, screenResumeSchema, summarizeSchema };
