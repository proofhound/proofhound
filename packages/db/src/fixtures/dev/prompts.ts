export type DevPromptFixture = {
  id: string;
  name: string;
  currentOnlineVersionId: string | null;
  defaultDatasetId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: Array<{
    id: string;
    versionNumber: number;
    body: string | null;
    variables: Array<{
      name: string;
      type: string;
      required: boolean;
      description?: string;
      datasetField?: string;
    }>;
    outputSchema: Record<string, unknown> | null;
    judgmentRules: Record<string, unknown> | null;
    promptLanguage: 'zh-CN' | 'en-US';
    parentVersionId: string | null;
    generatedByOptimizationId: string | null;
    changeReason: string | null;
    isFrozen: boolean;
    createdAt: string;
    frozenAt: string | null;
  }>;
};

export const DEV_PROMPTS: DevPromptFixture[] = [
  {
    id: '246bc6d3-8ac9-43d5-a055-f9098884e227',
    name: 'emotion category',
    currentOnlineVersionId: null,
    defaultDatasetId: 'db945aa9-fe6e-4591-9b99-42f0b4dd567e',
    createdAt: '2026-05-23T03:09:52.572Z',
    updatedAt: '2026-05-23T07:05:49.531Z',
    versions: [
      {
        id: '6f06843e-f897-473e-b0e4-4bbdd0a56fda',
        versionNumber: 1,
        body: 'please analyze the given text emotion.\n\n{{text}}',
        variables: [
          {
            name: 'text',
            type: 'text',
            required: true,
            description: 'string',
            datasetField: 'text',
          },
        ],
        outputSchema: {
          fields: [
            {
              key: 'expected_output',
              value: 'negative or positive',
              isJudgment: true,
            },
          ],
        },
        judgmentRules: {
          rules: [],
        },
        promptLanguage: 'en-US',
        parentVersionId: null,
        generatedByOptimizationId: null,
        changeReason: 'Initial version',
        isFrozen: true,
        createdAt: '2026-05-23T03:09:52.572Z',
        frozenAt: '2026-05-23T04:25:10.807Z',
      },
      {
        id: 'c77ce1bc-160c-5a51-84ed-0334233803fd',
        versionNumber: 2,
        body: "You are a sentiment classification expert. Classify the sentiment of the following customer review as exactly one of: positive, negative, or neutral.\n\nDefinitions:\n- positive: the reviewer is genuinely satisfied and would recommend the product or place without significant reservations.\n- negative: the reviewer expresses disappointment, low expectations met at best, or would not strongly recommend — including reviews that use faint praise, hedged language, or 'it will do' phrasing.\n- neutral: the review is purely factual or expresses neither clear satisfaction nor dissatisfaction.\n\nRules:\n1. Base your classification on the OVERALL, dominant evaluative stance expressed across the entire text, not on isolated negative or positive words.\n2. If the review contains both praise and criticism, determine which sentiment is stronger or more central to the author's experience.\n3. For bullet-point or list-style reviews, weigh all points together rather than focusing on the first or last few items.\n4. Complaint-framed context (e.g., explaining why the author had to visit) does not by itself indicate negative sentiment — look at the author's overall conclusion and dominant tone.\n5. Faint-praise phrases such as 'this will do', 'it fulfills the craving', 'good enough', or 'couldn't go wrong with it' are negative indicators, not positive ones.\n6. Output only the single label: positive, negative, or neutral.\n\nReview:\n{{text}}",
        variables: [
          {
            name: 'text',
            type: 'text',
            required: true,
            description: 'string',
            datasetField: 'text',
          },
        ],
        outputSchema: {
          fields: [
            {
              key: 'expected_output',
              value: 'negative or positive',
              isJudgment: true,
            },
          ],
        },
        judgmentRules: {
          rules: [],
        },
        promptLanguage: 'en-US',
        parentVersionId: '6f06843e-f897-473e-b0e4-4bbdd0a56fda',
        generatedByOptimizationId: null,
        changeReason:
          "Replaced the vague 'please analyze the given text emotion' instruction with a fully structured directive. The new prompt: (1) defines all three sentiment labels precisely to eliminate ambiguity (addresses ep3); (2) adds a holistic-aggregation rule instructing the model to judge overall evaluative stance rather than latching onto salient negative tokens (addresses ep1, rules 1–4); (3) explicitly flags faint-praise language as a negative indicator (addresses ep2, rule 5); (4) enforces a single-label output constraint (addresses ep3, rule 6). No new placeholders were introduced; {{text}} is preserved exactly.",
        isFrozen: true,
        createdAt: '2026-05-23T06:35:41.873Z',
        frozenAt: '2026-05-23T06:35:41.878Z',
      },
      {
        id: '8eab5ca8-08f2-5bdc-b69e-bedf4c6f188e',
        versionNumber: 3,
        body: "You are a sentiment classification assistant. Classify the overall sentiment of the following customer review as exactly one of: positive, negative, or neutral.\n\nLabel definitions:\n- positive: the reviewer is genuinely satisfied and would recommend the experience without significant reservations.\n- negative: the reviewer is dissatisfied, OR their praise is heavily qualified, backhanded, or based on low expectations (e.g., 'this will do', 'fulfills the craving', 'couldn't go wrong with it', 'def a fast food type place').\n- neutral: the review is balanced with roughly equal positive and negative points and no clear overall lean.\n\nRules:\n1. Assess the dominant, overall sentiment of the entire text — do not let isolated negative or positive words override the net impression.\n2. If the review contains both praise and complaints, determine which sentiment is stronger overall and use that label.\n3. When surface-level positive words appear alongside settling language, unmet expectations, or heavily qualified praise, treat the overall tone as negative.\n\n{{text}}",
        variables: [
          {
            name: 'text',
            type: 'text',
            required: true,
            description: 'string',
            datasetField: 'text',
          },
        ],
        outputSchema: {
          fields: [
            {
              key: 'expected_output',
              value: 'negative or positive',
              isJudgment: true,
            },
          ],
        },
        judgmentRules: {
          rules: [],
        },
        promptLanguage: 'en-US',
        parentVersionId: '6f06843e-f897-473e-b0e4-4bbdd0a56fda',
        generatedByOptimizationId: '1f9d680e-355c-4f14-a0b6-aef5e6c062c6',
        changeReason:
          'Replaced the vague one-line instruction with a structured directive that (1) defines all three sentiment labels precisely, (2) adds an explicit dominant-sentiment aggregation rule to prevent isolated negative tokens from overriding net-positive reviews, and (3) adds an explicit settling/backhanded-language clause with concrete examples to prevent lukewarm reviews from being flipped to positive. These three additions directly address all three error patterns identified in the evidence bundle (ep-surface-negative-override, ep-missing-aggregation-rule, ep-settling-language-missed) and are expected to recover the 3 misclassified samples responsible for the -0.01 accuracy gap.',
        isFrozen: true,
        createdAt: '2026-05-23T07:05:49.527Z',
        frozenAt: '2026-05-23T07:05:49.531Z',
      },
    ],
  },
];
