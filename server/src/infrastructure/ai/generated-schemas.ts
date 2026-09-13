import { z } from 'zod';

const TargetAliasSchema = z.string().regex(/^t[1-9][0-9]*$/);

export const GeneratedPracticeSchema = z
  .object({
    title: z.string().min(1).max(160),
    paragraphs: z
      .array(
        z
          .object({
            key: z.string().min(1),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(3),
    usages: z.array(
      z
        .object({
          targetAlias: TargetAliasSchema,
          paragraphKey: z.string().min(1),
          surfaceForm: z.string().min(1),
        })
        .strict(),
    ),
    questions: z.array(
      z
        .object({
          targetAlias: TargetAliasSchema,
          prompt: z.string().min(1),
          optionsZh: z.array(z.string().min(1)).length(4),
          meaningEn: z.string().min(1),
          explanationZh: z.string().min(1),
          optionExplanationsZh: z.array(z.string().min(1)).length(4),
        })
        .strict(),
    ),
  })
  .strict();

export const VerificationSchema = z
  .object({
    approved: z.boolean(),
    issues: z.array(z.string()),
  })
  .strict();

export type GeneratedPractice = z.infer<typeof GeneratedPracticeSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
