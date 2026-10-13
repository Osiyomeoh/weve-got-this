/**
 * Prompts: the questions worth asking regularly.
 */

import type { ToolContext } from './toolkit.js';

/**
 * Daily check-in.
 */
export function registerDailyCheckPrompt({ server }: ToolContext): void {
  server.registerPrompt(
    'daily-check',
    {
      title: 'Daily check-in',
      description: 'Walk through how today went and what still needs an owner.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              "Give me today's care summary, then tell me anything that still has no owner. " +
              'Read the results as they are written. If something was only expected and not ' +
              'logged, say it has no record - do not say it was missed.',
          },
        },
      ],
    }),
  );
}

/**
 * Weekly review.
 */
export function registerWeeklyReviewPrompt({ server }: ToolContext): void {
  server.registerPrompt(
    'weekly-review',
    {
      title: 'Weekly review',
      description: 'What is coming up this week, and what nobody has claimed.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              'What is going to fall through the cracks this week? Use the care gaps for the ' +
              'next seven days, read the most urgent ones, and ask who can take them.',
          },
        },
      ],
    }),
  );
}
