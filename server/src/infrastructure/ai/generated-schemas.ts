import { z } from 'zod';

/**
 * The shape a reply needs to be worth repairing. Anything finer (the number of options,
 * the answer index, explanations, the title, which paragraph holds a target) is repaired
 * or completed by the validator, so only an article with paragraphs is required here.
 */
export const GeneratedPracticeSchema = z.object({
  title: z.string(),
  paragraphs: z
    .array(z.object({ key: z.string(), text: z.string() }))
    .min(1),
  usages: z.array(
    z.object({
      targetAlias: z.string(),
      paragraphKey: z.string(),
      surfaceForm: z.string(),
    }),
  ),
  questions: z.array(
    z.object({
      targetAlias: z.string(),
      prompt: z.string(),
      optionsEn: z.array(z.string()),
      correctOptionIndex: z.number(),
      meaningEn: z.string(),
      explanationZh: z.string(),
      optionExplanationsZh: z.array(z.string()),
      optionExplanationsEn: z.array(z.string()),
    }),
  ),
});

export type GeneratedPractice = z.infer<typeof GeneratedPracticeSchema>;
