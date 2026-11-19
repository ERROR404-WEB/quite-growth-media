import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseOpenAiConfig, requireApiKey } from '../../src/ai/config.js';
import type { FetchLike } from '../../src/ai/openai-client.js';
import { OpenAiClient, OpenAiError } from '../../src/ai/openai-client.js';
import { buildImagePrompt, OpenAiIllustrator } from '../../src/ai/openai-illustrator.js';
import { Budget, BudgetExceededError, imageCostUsd, textCostUsd } from '../../src/ai/pricing.js';
import type { Storyboard } from '../../src/ai/script-writer.js';
import {
  applyStoryboard,
  buildScriptPrompt,
  estimateScriptSeconds,
  generateScript,
  musicMoodLine,
  pausesFor,
  ScriptValidationError,
  validateScript,
  xWeightedLength,
} from '../../src/ai/script-writer.js';
import { buildStoryboardPrompt, generateStoryboard, validateStoryboard } from '../../src/ai/storyboard.js';
import { BRANDS, getBrand } from '../../src/brands/index.js';
import type { PaletteMood, ShotType, StoryBeat } from '../../src/domain/constants.js';
import { estimateSpeechSeconds } from '../../src/media/timeline.js';

const KEY = 'sk-test-0123456789abcdefghijklmnop';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: (Response | Error)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('unexpected extra request');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const client = (f: FetchLike) => new OpenAiClient({ apiKey: KEY, fetch: f, sleep: async () => undefined });

describe('OpenAI config', () => {
  it('has safe defaults and treats a blank key as missing', () => {
    const cfg = parseOpenAiConfig({ OPENAI_API_KEY: '  ' });
    expect(cfg.OPENAI_API_KEY).toBeUndefined();
    expect(cfg.OPENAI_IMAGE_SIZE).toBe('1008x1792');
    expect(cfg.OPENAI_MAX_USD_PER_RUN).toBe(2);
    expect(() => requireApiKey(cfg)).toThrow(/never paste it into chat/);
  });

  it('rejects image sizes that are not multiples of 16', () => {
    expect(() => parseOpenAiConfig({ OPENAI_IMAGE_SIZE: '1080x1920' })).toThrow(/multiples of 16/);
  });
});

describe('pricing and budget', () => {
  it('computes token costs from the dated price table', () => {
    expect(textCostUsd('gpt-6.2-sol', { input: 1_000_000, cachedInput: 0, output: 1_000_000 })).toBeCloseTo(
      12,
    );
    expect(imageCostUsd('gpt-image-2.6-flare', { textInput: 1000, imageInput: 0, output: 2000 })).toBeCloseTo(
      0.065,
    );
  });

  it('stops before a call that could exceed the cap', () => {
    const b = new Budget(0.2);
    b.reserve(0.1, 'a');
    b.record('script', 'm', 0.15);
    expect(() => b.reserve(0.1, 'image 1/5')).toThrow(BudgetExceededError);
    expect(b.spentUsd).toBeCloseTo(0.15);
  });
});

describe('OpenAiClient', () => {
  it('sends the key only in the Authorization header', async () => {
    const m = mockFetch([json(200, { ok: true })]);
    await client(m.fetch).post('/x', { a: 1 });
    expect((m.calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(String(m.calls[0]!.init.body)).not.toContain(KEY);
    expect(m.calls[0]!.url).toBe('https://api.openai.com/v1/x');
  });

  it('retries 429 / 5xx / network errors a bounded number of times', async () => {
    const m = mockFetch([
      json(429, { error: { message: 'slow down' } }, { 'retry-after': '1' }),
      new TypeError('fetch failed'),
      json(503, { error: { message: 'busy' } }),
      json(200, { ok: 1 }),
    ]);
    await expect(client(m.fetch).post('/x', {})).resolves.toEqual({ ok: 1 });
    expect(m.calls).toHaveLength(4);

    const n = mockFetch([json(500, {}), json(500, {}), json(500, {}), json(500, {})]);
    await expect(client(n.fetch).post('/x', {})).rejects.toThrow(/500/);
    expect(n.calls).toHaveLength(4);
  });

  it('does not retry client errors and never echoes the key', async () => {
    const m = mockFetch([
      json(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }),
    ]);
    const err = await client(m.fetch)
      .post('/x', {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAiError);
    expect((err as OpenAiError).status).toBe(401);
    expect((err as OpenAiError).message).not.toContain(KEY);
    expect(m.calls).toHaveLength(1);
  });
});

const quietGrowth = getBrand('quiet-growth')!;
const line = (
  beat: StoryBeat,
  narration: string,
  delivery: string,
  shot: ShotType,
  palette: PaletteMood,
  extra: { sfx?: 'none' | 'soft_impact'; camera?: 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' } = {},
) => ({
  beat,
  narration,
  delivery,
  visual: `An illustration for: ${narration}`,
  shot,
  palette,
  camera: extra.camera ?? ('zoom-in' as const),
  sfx: extra.sfx ?? ('none' as const),
});

const goodScript = {
  title: 'Exhausted from pretending',
  idea: {
    coreMessage: 'What looks like laziness is often exhaustion from pretending to be fine.',
    identitySignal: 'I understand myself better than the labels people give me',
    permissionGiven: 'Removes guilt about resting and slowing down',
    emotionalArc: { start: 'shame', mid: 'recognition', peak: 'relief', landing: 'quiet pride' },
    targetAudience: 'High-achievers who feel burnt out',
    shareTrigger: 'Sending it to a friend who keeps calling themselves lazy',
    parallelPattern: 'A_repetitive_opener' as const,
    quotes: {
      strongest: "It's not about doing more. It's about carrying less.",
      screenshot: 'Even the ocean pulls back before the next wave rises.',
      share: "Rest isn't quitting. It's how you come back.",
    },
    loopLink: 'Coming back loops to the hook about pretending.',
    hookScore: 9,
    quotabilityScore: 9,
  },
  deliveryStyle: 'intimate' as const,
  characterDescription:
    'A woman in her late twenties with shoulder-length dark hair and a muted green cardigan.',
  scenes: [
    line(
      'hook',
      "You're not lazy. You're exhausted from pretending.",
      'soft, knowing',
      'close_up_portrait',
      'contemplative',
      {
        sfx: 'soft_impact',
      },
    ),
    line(
      'message',
      "It's not about doing more. It's about carrying less.",
      'quiet, certain',
      'indoor_reflection',
      'contemplative',
    ),
    line(
      'message',
      "It's not about being stronger. It's about being honest.",
      'warm, rising',
      'two_people',
      'intimate',
    ),
    line(
      'message',
      'The moment you stop performing, you start recovering.',
      'steady, gentle',
      'night_urban',
      'night',
    ),
    line(
      'metaphor',
      'Even the ocean pulls back before the next wave rises.',
      'almost a whisper',
      'vast_landscape',
      'peaceful',
    ),
    line(
      'conclusion',
      "Rest isn't quitting. It's how you come back.",
      'steady, proud',
      'close_up_portrait',
      'peaceful',
    ),
  ],
  soundDesign: { music: 'healing' as const, ambience: 'none' as const },
  metadata: {
    youtubeTitle: "You're not lazy",
    shortDescription: 'A reminder that rest is how you come back.',
    captions: {
      instagram: 'Even the ocean pulls back before the next wave rises.',
      facebook: "You're not lazy. You're exhausted from pretending.",
      youtube: "Rest isn't quitting.",
      x: "Rest isn't quitting. It's how you come back.",
    },
    hashtags: ['#rest', '#burnout', '#quietgrowth'],
    keywords: ['rest', 'burnout recovery', 'self compassion'],
  },
  safetyNotes: 'none',
};

type Script = typeof goodScript;
const withScenes = (scenes: Script['scenes']): Script => ({ ...goodScript, scenes });
const kidsLine = (narration: string, beat: StoryBeat) =>
  line(beat, narration, 'warm, playful', 'two_people', 'peaceful');

function responsesResult(output: unknown, usage = { input_tokens: 900, output_tokens: 400 }) {
  return json(200, { status: 'completed', output: [{ type: 'message', content: [output] }], usage });
}

describe('script writer', () => {
  it('builds prompts from the brand rules, language and slot', () => {
    const { system, user } = buildScriptPrompt({
      brand: getBrand('nanhe-sitare')!,
      contentCategory: 'rhyme_song',
    });
    expect(system).toContain('Hindi written in Devanagari');
    expect(system).toContain('Target age: 2-6 years');
    expect(system).toMatch(/Never ask viewers to like, subscribe/);
    expect(system).toMatch(/never translate/i);
    expect(system).toMatch(/"hook", the last scene "payoff"/);
    expect(user).toContain('Original rhyme or song');
  });

  it('requests strict structured output and returns a validated script with its cost', async () => {
    const m = mockFetch([responsesResult({ type: 'output_text', text: JSON.stringify(goodScript) })]);
    const budget = new Budget(1);
    const g = await generateScript(
      client(m.fetch),
      { brand: quietGrowth, contentCategory: 'mindset_growth' },
      { model: 'gpt-6.2-sol', budget },
    );
    const body = JSON.parse(String(m.calls[0]!.init.body)) as {
      store: boolean;
      text: { format: Record<string, unknown> };
    };
    expect(m.calls[0]!.url).toMatch(/\/responses$/);
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true, name: 'video_script' });
    expect(g.script).toMatchObject({
      brandId: 'quiet-growth',
      language: 'en',
      contentCategory: 'mindset_growth',
    });
    expect(g.script.scenes).toHaveLength(6);
    expect(g.costUsd).toBeCloseTo((900 * 2 + 400 * 10) / 1e6);
    expect(budget.spentUsd).toBeCloseTo(g.costUsd);
  });

  it('returns the idea, per-line delivery, shot, palette and the scripted pauses', async () => {
    const m = mockFetch([responsesResult({ type: 'output_text', text: JSON.stringify(goodScript) })]);
    const g = await generateScript(
      client(m.fetch),
      { brand: quietGrowth, contentCategory: 'mindset_growth' },
      { model: 'gpt-6.2-sol', budget: new Budget(1) },
    );
    expect(g.centralIdea).toBe(goodScript.idea.coreMessage);
    expect(g.idea.parallelPattern).toBe('A_repetitive_opener');
    expect(g.soundDesign).toEqual({ music: 'healing', ambience: 'none' });
    expect(g.script.scenes.map((s) => s.pause)).toEqual(['beat', 'none', 'none', 'beat', 'pause', 'none']);
    expect(g.script.scenes[0]).toMatchObject({
      beat: 'hook',
      delivery: 'soft, knowing',
      shot: 'close_up_portrait',
      palette: 'contemplative',
      sfx: 'soft_impact',
    });
    expect(g.metadata.hashtags).toEqual(['#rest', '#burnout', '#quietgrowth']);
  });

  it('reports refusals and invalid output as validation errors', async () => {
    const refused = mockFetch([responsesResult({ type: 'refusal', refusal: 'cannot help' })]);
    await expect(
      generateScript(
        client(refused.fetch),
        { brand: quietGrowth, contentCategory: 'mindset_growth' },
        { model: 'm', budget: new Budget(1) },
      ),
    ).rejects.toThrow(/refused/);
    const tooFew = mockFetch([
      responsesResult({
        type: 'output_text',
        text: JSON.stringify(withScenes(goodScript.scenes.slice(0, 1))),
      }),
    ]);
    await expect(
      generateScript(
        client(tooFew.fetch),
        { brand: quietGrowth, contentCategory: 'mindset_growth' },
        { model: 'm', budget: new Budget(1) },
      ),
    ).rejects.toBeInstanceOf(ScriptValidationError);
  });

  it('refuses scripture brands until scripture verification exists, without calling the API', async () => {
    const m = mockFetch([]);
    await expect(
      generateScript(
        client(m.fetch),
        { brand: getBrand('bhakti-ki-shakti')!, contentCategory: 'goodness' },
        { model: 'm', budget: new Budget(1) },
      ),
    ).rejects.toThrow(/scripture verification/);
    expect(m.calls).toHaveLength(0);
  });

  it('accepts the reference script and estimates its length with the pauses', () => {
    const { problems, seconds } = validateScript(quietGrowth, goodScript);
    expect(problems).toEqual([]);
    expect(seconds).toBeGreaterThanOrEqual(22);
    expect(seconds).toBeLessThanOrEqual(27);
    // Beats (2 × 0.7 s) and the pause (1.2 s) are part of the estimate, at the calm voice's 0.92× pace.
    const noPauses = goodScript.scenes.reduce(
      (s, x) => s + estimateSpeechSeconds(x.narration, 'en') / 0.92 + 0.7,
      0,
    );
    expect(estimateScriptSeconds(quietGrowth, goodScript.scenes)).toBeCloseTo(noPauses + 2.6, 1);
  });

  it('requires pure Hindi and Telugu narration: English words in Latin script are rejected', () => {
    const hi = getBrand('behtar-bano')!;
    const hiLines = (msg: string) => ({
      ...goodScript,
      scenes: [
        line('hook', 'तुम आलसी नहीं हो। तुम थक गए हो।', 'soft, knowing', 'close_up_portrait', 'contemplative'),
        line('message', msg, 'quiet, certain', 'night_urban', 'night'),
        line('message', 'बात मज़बूत दिखने की नहीं, सच्चा होने की है।', 'warm, rising', 'two_people', 'intimate'),
        line(
          'metaphor',
          'समंदर भी पीछे हटता है, अगली लहर से पहले।',
          'almost a whisper',
          'vast_landscape',
          'peaceful',
        ),
        line(
          'conclusion',
          'आराम हार नहीं है। वापसी का रास्ता है।',
          'steady, proud',
          'close_up_portrait',
          'peaceful',
        ),
      ],
    });
    expect(validateScript(hi, hiLines('बात ज़्यादा करने की नहीं, कम ढोने की है।')).problems.join()).not.toMatch(
      /narration is not mainly in/,
    );
    expect(validateScript(hi, hiLines('बात office की नहीं, overthinking की है।')).problems.join()).toMatch(
      /narration is not mainly in pure, modern, everyday Hindi/,
    );
    const { system } = buildScriptPrompt({
      brand: getBrand('ninnu-nuvvu-geluvu')!,
      contentCategory: 'mindset_growth',
    });
    expect(system).toMatch(/pure, modern, everyday Telugu written in Telugu script/);
    expect(system).toMatch(/no old literary/);
  });

  it('checks language, kids CTAs, false promises and duration', () => {
    const kids = getBrand('little-wonder-world')!;
    const bad = withScenes([
      kidsLine('Count the apples with me, one two three!', 'hook'),
      kidsLine('Now like and subscribe for more fun songs!', 'story'),
      kidsLine('Red apples, green apples, yummy apples for you.', 'payoff'),
    ]);
    expect(validateScript(kids, bad).problems).toContain('kids content contains a call to action');
    expect(validateScript(getBrand('chinni-lokam')!, goodScript).problems.join()).toMatch(
      /not mainly in .*Telugu/,
    );
    const promise = withScenes(
      goodScript.scenes.map((s) =>
        s.beat === 'conclusion' ? { ...s, narration: 'This habit is guaranteed to make you rich.' } : s,
      ),
    );
    expect(validateScript(quietGrowth, promise).problems.join()).toMatch(/guaranteed/);
    const long = withScenes(Array.from({ length: 8 }, () => kidsLine('word '.repeat(18).trim(), 'story')));
    expect(validateScript(kids, long).problems.join()).toMatch(/outside 7-45/);
    expect(validateScript(quietGrowth, long).problems.join()).toMatch(/outside 19-27/);
  });

  it('enforces hook → message (2-4) → metaphor → conclusion for self-improvement', () => {
    const problems = (scenes: Script['scenes']) =>
      validateScript(quietGrowth, withScenes(scenes)).problems.join(' | ');
    expect(problems([...goodScript.scenes].reverse())).toMatch(/first line must be the only hook/);
    const s = goodScript.scenes;
    expect(problems([s[0]!, s[1]!, s[4]!, s[5]!])).toMatch(/needs 2-4 message lines \(got 1\)/);
    expect(problems([s[0]!, s[1]!, s[2]!, s[3]!, s[5]!])).toMatch(/exactly one metaphor/);
    expect(problems([s[0]!, s[1]!, s[4]!, s[2]!, s[3]!, s[5]!])).toMatch(/out of order/);
    // Kids brands keep the hook → story → payoff structure.
    const kidsStory = withScenes([
      kidsLine('One red apple rolls away.', 'hook'),
      kidsLine('Two yellow bananas say hello.', 'story'),
      kidsLine('Three cheers for fruit friends!', 'payoff'),
    ]);
    expect(validateScript(getBrand('little-wonder-world')!, kidsStory).problems).toEqual([]);
  });

  it('applies the viral quality gates: statement hook, ≤3.5 s hook, 8+ scores, real quotes, shot variety', () => {
    const problems = (patch: Partial<Script>) =>
      validateScript(quietGrowth, { ...goodScript, ...patch }).problems.join(' | ');
    const hook = (narration: string) => goodScript.scenes.map((x, i) => (i === 0 ? { ...x, narration } : x));
    expect(problems({ scenes: hook('Why are you always so tired?') })).toMatch(/statement, not a question/);
    expect(
      problems({
        scenes: hook('You are not lazy at all, you are simply exhausted from pretending every day.'),
      }),
    ).toMatch(/hook takes ~\d\.\d s/);
    expect(problems({ idea: { ...goodScript.idea, hookScore: 7 } })).toMatch(/hook score 7\/10 is below 8/);
    expect(problems({ idea: { ...goodScript.idea, quotabilityScore: 6 } })).toMatch(
      /quotability score 6\/10/,
    );
    expect(
      problems({
        idea: {
          ...goodScript.idea,
          quotes: { ...goodScript.idea.quotes, screenshot: 'A line nobody says.' },
        },
      }),
    ).toMatch(/idea.quotes.screenshot is not a line from the narration/);
    expect(
      problems({ scenes: goodScript.scenes.map((x) => ({ ...x, shot: 'close_up_portrait' as const })) }),
    ).toMatch(/at least 3 different shot types/);
    const shotsAre = (...shots: ShotType[]) =>
      problems({ scenes: goodScript.scenes.map((x, i) => ({ ...x, shot: shots[i]! })) });
    expect(
      shotsAre(
        'close_up_portrait',
        'two_people',
        'close_up_portrait',
        'night_urban',
        'symbolic_object',
        'close_up_portrait',
      ),
    ).toMatch(/at most 2 close-up portraits/);
    expect(
      shotsAre(
        'close_up_portrait',
        'two_people',
        'two_people',
        'night_urban',
        'symbolic_object',
        'close_up_portrait',
      ),
    ).toMatch(/never repeat a shot type in consecutive lines/);
    expect(
      shotsAre(
        'close_up_portrait',
        'two_people',
        'indoor_reflection',
        'two_people',
        'symbolic_object',
        'close_up_portrait',
      ),
    ).toMatch(/at least one wide shot/);
    // A calm window scene may open the video (the reference reel's look).
    expect(
      shotsAre(
        'indoor_reflection',
        'two_people',
        'close_up_portrait',
        'night_urban',
        'symbolic_object',
        'vast_landscape',
      ),
    ).toBe('');
    expect(problems({ scenes: hook("You're not LAZY. You're exhausted.") })).toMatch(/ALL-CAPS/);
    expect(
      problems({ scenes: goodScript.scenes.map((x, i) => (i === 2 ? { ...x, delivery: '[gunshot]' } : x)) }),
    ).toMatch(/short English voice direction: "\[gunshot\]"/);
    // The narrator stays calm: dramatic or loud directions are rejected.
    expect(
      problems({
        scenes: goodScript.scenes.map((x, i) => (i === 1 ? { ...x, delivery: 'excited, shouting' } : x)),
      }),
    ).toMatch(/deliveries must stay calm.*"excited, shouting"/);
    // Format and feeling only: the reference reel's own lines are never reused.
    expect(
      problems({
        scenes: goodScript.scenes.map((x, i) =>
          i === 1 ? { ...x, narration: "It's not rejection. It's selection." } : x,
        ),
      }),
    ).toMatch(/reuses a line from the reference reel/);
  });

  it('rejects clichés and engagement bait in English and Hindi', () => {
    const conclusion = (narration: string) =>
      withScenes(goodScript.scenes.map((s) => (s.beat === 'conclusion' ? { ...s, narration } : s)));
    expect(
      validateScript(quietGrowth, conclusion('So never give up, not even tonight.')).problems.join(),
    ).toMatch(/cliché "never give up"/);
    expect(
      validateScript(quietGrowth, conclusion('Share this with someone who needs it.')).problems.join(),
    ).toMatch(/asks viewers to like/);
    const hindi = getBrand('behtar-bano')!;
    const hiScript = {
      ...goodScript,
      scenes: [
        line('hook', 'तुम आलसी नहीं हो। तुम थक गए हो।', 'soft, knowing', 'close_up_portrait', 'contemplative'),
        line(
          'message',
          'बात ज़्यादा करने की नहीं, कम ढोने की है।',
          'quiet, certain',
          'indoor_reflection',
          'contemplative',
        ),
        line('message', 'बात मज़बूत दिखने की नहीं, सच्चा होने की है।', 'warm, rising', 'two_people', 'intimate'),
        line(
          'metaphor',
          'समंदर भी पीछे हटता है, अगली लहर से पहले।',
          'almost a whisper',
          'vast_landscape',
          'peaceful',
        ),
        line(
          'conclusion',
          'बस इतना याद रखो, कभी हार मत मानो।',
          'steady, proud',
          'close_up_portrait',
          'peaceful',
        ),
      ],
    };
    expect(validateScript(hindi, hiScript).problems.join()).toMatch(/cliché "कभी हार मत मान"/);
  });

  it('validates platform metadata: limits, hashtags, language and no engagement requests', () => {
    const problems = (metadata: Partial<Script['metadata']>) =>
      validateScript(quietGrowth, {
        ...goodScript,
        metadata: { ...goodScript.metadata, ...metadata },
      }).problems.join(' | ');
    const captions = goodScript.metadata.captions;
    expect(problems({ youtubeTitle: 'x'.repeat(101) })).toMatch(/YouTube title is 101 characters/);
    expect(problems({ hashtags: ['#a1', '#b2'] })).toMatch(/needs 3-8 hashtags/);
    expect(problems({ hashtags: Array.from({ length: 9 }, (_, i) => `#tag${i}`) })).toMatch(
      /needs 3-8 hashtags/,
    );
    expect(problems({ hashtags: ['#ok', 'nohash', '#two words'] })).toMatch(
      /invalid hashtags: nohash #two words/,
    );
    expect(problems({ hashtags: ['#Rest', '#rest', '#calm'] })).toMatch(/duplicate hashtags/);
    expect(problems({ captions: { ...captions, x: 'y'.repeat(270) } })).toMatch(/X post is \d+ weighted/);
    expect(problems({ captions: { ...captions, instagram: 'Rest #now' } })).toMatch(
      /must not contain hashtags/,
    );
    expect(problems({ captions: { ...captions, facebook: 'Comment below if this hit home.' } })).toMatch(
      /engagement request/,
    );
    expect(problems({ youtubeTitle: 'Guaranteed to cure burnout' })).toMatch(/guaranteed-outcome/);
    expect(validateScript(getBrand('ninnu-nuvvu-geluvu')!, goodScript).problems.join()).toMatch(
      /metadata is not mainly in .*Telugu/,
    );
  });

  it('counts X length with weighting: emoji count double, Devanagari and Telugu single', () => {
    expect(xWeightedLength('abc')).toBe(3);
    expect(xWeightedLength('आराम')).toBe(4);
    expect(xWeightedLength('నువ్వు')).toBe(6);
    expect(xWeightedLength('🌙')).toBe(2);
    expect(xWeightedLength('a—b')).toBe(3);
  });

  it('puts the viral formula into the self-improvement prompt', () => {
    const { system } = buildScriptPrompt({ brand: quietGrowth, contentCategory: 'relationships_eq' });
    expect(system).toMatch(/IDENTITY SIGNAL.*PERMISSION.*EMOTIONAL SWING/s);
    expect(system).toMatch(/STEP 1 - THE IDEA/);
    expect(system).toMatch(/"hook" - exactly 1 line, 3-9 words/);
    expect(system).toMatch(
      /"message" - 2-4 lines .*A_repetitive_opener.*B_contrasting_pairs.*C_escalating_list.*D_negation_affirmation/s,
    );
    expect(system).toMatch(/"metaphor" - exactly 1 line, 8-15 words/);
    expect(system).toMatch(/"conclusion" - exactly 1 line, 5-12 words.*loops back/s);
    expect(system).toContain('19-27 seconds');
    expect(system).toContain('sweet spot 22-25 s');
    expect(system).toMatch(/about \d+-\d+ words/);
    expect(system).toMatch(/"delivery"/);
    expect(system).toMatch(/Ellipses|ellipses/);
    expect(system).toMatch(/close_up_portrait \(soft close portrait/);
    expect(system).toMatch(/contemplative \(faded blue hour/);
    expect(system).toMatch(/Netflix thumbnail/);
    expect(system).toMatch(/framing \(from behind.*→ subject with a specific, understated expression/);
    expect(system).toMatch(/deep, calm, unhurried voice/);
    expect(system).toMatch(/reframe pair/);
    expect(system).toMatch(/0\.7 s beat .* 1\.2 s pause/);
    expect(system).toMatch(/mostly slow push-ins/);
    expect(system).toMatch(/at most 2 close_up_portrait/);
    expect(system).toMatch(/never romanticise clinical anxiety/);
    expect(system).toContain("you can't pour from an empty cup");
    const kids = buildScriptPrompt({
      brand: getBrand('little-wonder-world')!,
      contentCategory: 'rhyme_song',
    });
    expect(kids.system).toMatch(/bright, curious opening frame/);
    expect(kids.system).not.toMatch(/STEP 1 - THE IDEA/);
  });

  it('assigns [BEAT] after the hook and last message line and [PAUSE] after the metaphor', () => {
    expect(pausesFor(['hook', 'message', 'message', 'metaphor', 'conclusion'])).toEqual([
      'beat',
      'none',
      'beat',
      'pause',
      'none',
    ]);
    expect(pausesFor(['hook', 'story', 'payoff'])).toEqual(['beat', 'none', 'none']);
  });
});

describe('shared storyboard (one topic and image set, separate scripts)', () => {
  const trio = BRANDS.filter((b) => b.niche === 'self_improvement');
  const storyboard: Storyboard = {
    title: 'Rest is how you come back',
    idea: {
      coreMessage: goodScript.idea.coreMessage,
      identitySignal: goodScript.idea.identitySignal,
      permissionGiven: goodScript.idea.permissionGiven,
      emotionalArc: goodScript.idea.emotionalArc,
      targetAudience: 'Burnt-out young adults in the US and India',
      shareTrigger: goodScript.idea.shareTrigger,
      parallelPattern: 'A_repetitive_opener',
      loopLink: goodScript.idea.loopLink,
    },
    characterDescription: 'A young woman with warm brown skin, dark wavy hair and a mustard cardigan.',
    soundDesign: { music: 'motivational', ambience: 'none' },
    lines: goodScript.scenes.map((s, i) => ({
      beat: s.beat,
      intent: `Meaning of line ${i + 1}: name the hidden exhaustion, then lift the viewer.`,
      delivery: s.delivery,
      visual: `Shared image ${i + 1}: rooftop at dusk, wind in her hair.`,
      shot: s.shot,
      palette: s.palette,
      camera: 'zoom-in' as const,
      sfx: 'none' as const,
    })),
  };

  it('plans meaning and images only, for all three brands, with only the music moods we own', () => {
    const { system, user } = buildStoryboardPrompt({
      brands: trio,
      contentCategory: 'mindset_growth',
      availableMusicMoods: ['motivational'],
    });
    expect(system).toMatch(/You write NO narration/);
    expect(system).toMatch(/Quiet Growth \(en\), Behtar Bano \(hi\), Ninnu Nuvvu Geluvu \(te\)/);
    expect(system).toMatch(/US and in India alike/);
    expect(system).toMatch(/warm brown skin/);
    expect(system).toMatch(/Licensed music is available only for these moods: motivational/);
    expect(system).toMatch(/IDENTITY SIGNAL/);
    expect(user).toContain('Mindset reframes');
    expect(() =>
      buildStoryboardPrompt({ brands: [getBrand('chinni-lokam')!], contentCategory: 'learning_video' }),
    ).toThrow(/only for the self-improvement brands/);
  });

  it('validates the 4-step arc, visual rules, quoted wording and music availability', () => {
    expect(validateStoryboard(storyboard, ['motivational'])).toEqual([]);
    const quoted = {
      ...storyboard,
      lines: storyboard.lines.map((l, i) => (i === 0 ? { ...l, intent: 'Say "you are not lazy"' } : l)),
    };
    expect(validateStoryboard(quoted).join()).toMatch(/no quoted wording/);
    expect(validateStoryboard(storyboard, ['sad']).join()).toMatch(
      /music mood "motivational" has no licensed track/,
    );
    const noMetaphor = { ...storyboard, lines: storyboard.lines.filter((l) => l.beat !== 'metaphor') };
    expect(validateStoryboard(noMetaphor).join()).toMatch(/exactly one metaphor/);
    const loud = {
      ...storyboard,
      lines: storyboard.lines.map((l, i) => (i === 1 ? { ...l, delivery: 'dramatic, rising' } : l)),
    };
    expect(validateStoryboard(loud).join()).toMatch(/deliveries must stay calm.*"dramatic, rising"/);
  });

  it('gives each brand only the meaning (never another language) and locks the shared images', () => {
    const { system, user } = buildScriptPrompt({
      brand: getBrand('ninnu-nuvvu-geluvu')!,
      contentCategory: 'mindset_growth',
      storyboard,
    });
    expect(user).toMatch(/Write THIS brand's narration from scratch in pure, modern, everyday Telugu/);
    expect(user).toMatch(/Never translate or adapt wording from any other language/);
    expect(user).toMatch(/Write exactly 6 lines/);
    expect(user).toContain('Shared image 1: rooftop at dusk');
    expect(system).toMatch(/images are already fixed by the shared storyboard/);
    expect(system).toMatch(/STEP 1 - THE IDEA is given by the shared storyboard/);

    const { out, problems } = applyStoryboard(storyboard, goodScript);
    expect(problems).toEqual([]);
    expect(out.scenes.map((s) => s.visual)).toEqual(storyboard.lines.map((l) => l.visual));
    expect(out.soundDesign).toEqual({ music: 'motivational', ambience: 'none' });
    expect(out.characterDescription).toBe(storyboard.characterDescription);
    expect(out.scenes[0]!.narration).toBe(goodScript.scenes[0]!.narration);
    expect(applyStoryboard(storyboard, withScenes(goodScript.scenes.slice(0, 5))).problems.join()).toMatch(
      /storyboard has 6 lines but the script has 5/,
    );
  });

  it('generates a storyboard and a storyboard-locked script with mocked API calls', async () => {
    const m = mockFetch([
      responsesResult({ type: 'output_text', text: JSON.stringify(storyboard) }),
      responsesResult({ type: 'output_text', text: JSON.stringify(goodScript) }),
    ]);
    const budget = new Budget(1);
    const { storyboard: sb } = await generateStoryboard(
      client(m.fetch),
      { brands: trio, contentCategory: 'mindset_growth', availableMusicMoods: ['motivational'] },
      { model: 'gpt-6.2-sol', budget },
    );
    expect(JSON.parse(String(m.calls[0]!.init.body)).text.format.name).toBe('shared_storyboard');
    const g = await generateScript(
      client(m.fetch),
      { brand: quietGrowth, contentCategory: 'mindset_growth', storyboard: sb },
      { model: 'gpt-6.2-sol', budget },
    );
    expect(g.script.scenes.map((s) => s.visual)).toEqual(sb.lines.map((l) => l.visual));
    expect(g.soundDesign.music).toBe('motivational');
    expect(m.calls).toHaveLength(2);
  });

  it('tells the single-brand writer which music moods have licensed tracks', () => {
    expect(musicMoodLine()).toMatch(/Choose one music mood/);
    expect(musicMoodLine([])).toMatch(/set music to "none"/);
    expect(musicMoodLine(['motivational', 'hopeful'])).toMatch(/only for these moods: motivational, hopeful/);
  });
});

describe('OpenAI illustrator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qgm-ill-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const ok = (size = '1008x1792') =>
    json(200, {
      data: [{ b64_json: jpegBytes.toString('base64') }],
      size,
      quality: 'medium',
      output_format: 'jpeg',
      usage: {
        input_tokens: 300,
        output_tokens: 1500,
        input_tokens_details: { text_tokens: 300, image_tokens: 0 },
      },
    });
  const req = (i = 0) => ({
    brand: getBrand('little-wonder-world')!,
    sceneIndex: i,
    sceneCount: 4,
    visual: 'A bunny sorting red and yellow fruit',
    characterDescription: 'A small grey bunny with a teal scarf',
    seed: 's',
    width: 1188,
    height: 2112,
    workDir: dir,
  });

  it('builds a safe, text-free, brand-styled prompt', () => {
    const p = buildImagePrompt(getBrand('little-wonder-world')!, req());
    expect(p).toContain('Vertical 9:16');
    expect(p).toMatch(/fills the entire frame edge to edge/);
    expect(p).toContain('#FFD166');
    expect(p).toContain('A small grey bunny with a teal scarf');
    expect(p).toMatch(/Do not include any text/);
    expect(p).toMatch(/do not resemble any existing cartoon/);
    expect(p).toMatch(/age-appropriate for young children/);
  });

  it('builds the storybook-anime prompt with the line shot, mood palette, skin tones and framing', () => {
    const qg = getBrand('quiet-growth')!;
    const first = buildImagePrompt(qg, {
      visual: 'A woman on a pier at dusk',
      sceneIndex: 0,
      shot: 'vast_landscape',
      palette: 'contemplative',
    });
    expect(first).toMatch(
      /Premium hand-painted anime-style illustration with a warm vintage lo-fi film look/,
    );
    expect(first).toMatch(/amber and honey sunlight/);
    expect(first).toMatch(/Shot: one small solitary figure, often seen from behind/);
    expect(first).toMatch(/Colour palette \(contemplative mood\): #2B3A4A/);
    expect(first).toMatch(/Brand accent colours, used sparingly: #2F3E4E/);
    expect(first).toMatch(/Character skin tones: #C7A196/);
    expect(first).toMatch(/Lighting: Soft, warm natural light/);
    expect(first).toMatch(/never pure black/);
    expect(first).toMatch(/Framing: Calm, cinematic framing/);
    expect(first).toMatch(/opening frame of the video: it must stop the scroll/);
    // Centred soft captions: the middle band stays calm instead of the lower third.
    expect(first).toMatch(/caption is added later across the vertical centre/);
    expect(first).not.toMatch(/lower third should hold only simple/);
    expect(first).toMatch(/Avoid: .*Glossy 3D, CGI/);
    expect(first).not.toMatch(/Recurring character/);
    const later = buildImagePrompt(qg, {
      visual: 'x',
      sceneIndex: 2,
      characterDescription: 'none',
      palette: 'night',
    });
    expect(later).toMatch(/Colour palette \(night mood\): #141B26/);
    expect(later).not.toMatch(/opening frame/);
    expect(later).not.toMatch(/Recurring character/);
    // Brands without mood palettes keep their own palette and the lower-third caption zone.
    const chinni = buildImagePrompt(getBrand('chinni-lokam')!, { visual: 'x', palette: 'night' });
    expect(chinni).not.toMatch(/night mood/);
    expect(chinni).toMatch(/lower third should hold only simple/);
  });

  it('saves the decoded image and records cost and provenance', async () => {
    const m = mockFetch([ok()]);
    const budget = new Budget(1);
    const ill = await new OpenAiIllustrator(client(m.fetch), {
      model: 'gpt-image-2.6-flare',
      quality: 'medium',
      size: '1008x1792',
      budget,
    }).generate(req());
    const body = JSON.parse(String(m.calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-image-2.6-flare',
      size: '1008x1792',
      quality: 'medium',
      output_format: 'jpeg',
      n: 1,
    });
    expect(ill.file).toBe('scene-1.jpg');
    expect(readFileSync(join(dir, 'scene-1.jpg')).equals(jpegBytes)).toBe(true);
    expect(ill.costUsd).toBeCloseTo((300 * 5 + 1500 * 30) / 1e6);
    expect(budget.spentUsd).toBeCloseTo(ill.costUsd);
    expect(String(ill.provenance.licence)).toMatch(/owns all Output/);
  });

  it('renders only the hook (first) image at the higher hook quality', async () => {
    const m = mockFetch([ok(), ok()]);
    const ill = new OpenAiIllustrator(client(m.fetch), {
      model: 'gpt-image-2.6-flare',
      quality: 'medium',
      hookQuality: 'high',
      size: '1008x1792',
      budget: new Budget(2),
    });
    expect(ill.name).toContain('medium, hook high');
    await ill.generate(req(0));
    await ill.generate(req(1));
    const qualities = m.calls.map((c) => (JSON.parse(String(c.init.body)) as { quality: string }).quality);
    expect(qualities).toEqual(['high', 'medium']);
  });

  it('falls back to 1024x1536 once when the custom size is rejected', async () => {
    const m = mockFetch([json(400, { error: { message: 'Invalid size 1008x1792' } }), ok('1024x1536')]);
    const ill = await new OpenAiIllustrator(client(m.fetch), {
      model: 'gpt-image-2.6-flare',
      quality: 'medium',
      size: '1008x1792',
      budget: new Budget(1),
    }).generate(req(1));
    expect(JSON.parse(String(m.calls[1]!.init.body)).size).toBe('1024x1536');
    expect(ill.provenance.size).toBe('1024x1536');
  });

  it('respects the budget cap before calling the API', async () => {
    const m = mockFetch([]);
    const ill = new OpenAiIllustrator(client(m.fetch), {
      model: 'gpt-image-2.6-flare',
      quality: 'high',
      size: '1008x1792',
      budget: new Budget(0.1),
    });
    await expect(ill.generate(req())).rejects.toBeInstanceOf(BudgetExceededError);
    expect(m.calls).toHaveLength(0);
  });
});
