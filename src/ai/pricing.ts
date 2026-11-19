// Prices per 1M tokens, from https://developers.openai.com/api/docs/pricing (Standard tier),
// checked 18 Nov 2026. Re-check before relying on them; actual billing is what OpenAI charges.
export const PRICING_CHECKED_ON = '2026-11-18';

interface TextRates {
  input: number;
  cachedInput: number;
  output: number;
}

interface ImageRates {
  textInput: number;
  imageInput: number;
  imageOutput: number;
}

export const TEXT_RATES: Record<string, TextRates> = {
  'gpt-6.2-astra': { input: 8, cachedInput: 0.4, output: 40 },
  'gpt-6.2-sol': { input: 2, cachedInput: 0.1, output: 10 },
  'gpt-6.1-sol': { input: 2, cachedInput: 0.1, output: 10 },
  'gpt-6.1-terra': { input: 1, cachedInput: 0.05, output: 5 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

export const IMAGE_RATES: Record<string, ImageRates> = {
  'gpt-image-2.6-sunburst': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-2.6-flare': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-2.5-sunburst': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-2.5-flare': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-2': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-1-mini': { textInput: 2, imageInput: 2.5, imageOutput: 8 },
};

const perMillion = (tokens: number, rate: number) => (tokens * rate) / 1_000_000;

/** Unknown models are priced at the most expensive listed rate so budgets stay conservative. */
export function textCostUsd(
  model: string,
  usage: { input: number; cachedInput: number; output: number },
): number {
  const r = TEXT_RATES[model] ?? TEXT_RATES['gpt-6.2-astra']!;
  return (
    perMillion(Math.max(0, usage.input - usage.cachedInput), r.input) +
    perMillion(usage.cachedInput, r.cachedInput) +
    perMillion(usage.output, r.output)
  );
}

export function imageCostUsd(
  model: string,
  usage: { textInput: number; imageInput: number; output: number },
): number {
  const r = IMAGE_RATES[model] ?? IMAGE_RATES['gpt-image-2.6-flare']!;
  return (
    perMillion(usage.textInput, r.textInput) +
    perMillion(usage.imageInput, r.imageInput) +
    perMillion(usage.output, r.imageOutput)
  );
}

/** Tracks spend for one run and refuses calls that could exceed the cap. */
export class Budget {
  private spent = 0;
  readonly entries: { kind: string; model: string; usd: number }[] = [];

  constructor(readonly capUsd: number) {}

  get spentUsd(): number {
    return this.spent;
  }

  /** Throws before a call whose worst-case cost would exceed the cap. */
  reserve(estimateUsd: number, what: string): void {
    if (this.spent + estimateUsd > this.capUsd) {
      throw new BudgetExceededError(
        `Stopping before ${what}: spent $${this.spent.toFixed(4)}, next call may cost up to ` +
          `$${estimateUsd.toFixed(2)}, cap is $${this.capUsd.toFixed(2)} (OPENAI_MAX_USD_PER_RUN).`,
      );
    }
  }

  record(kind: string, model: string, usd: number): void {
    this.spent += usd;
    this.entries.push({ kind, model, usd });
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}
