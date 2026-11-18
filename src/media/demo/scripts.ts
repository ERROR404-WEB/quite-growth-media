import type { VideoScript } from '../pipeline.js';

/**
 * Hand-written sample scripts used ONLY to test rendering locally (never published).
 * Each one was written independently for its brand - none is a translation of another.
 * Real scripts are generated per brand in Phase 4.
 */
export const DEMO_SCRIPTS: readonly VideoScript[] = [
  {
    brandId: 'quiet-growth',
    title: 'The overthinking loop',
    contentCategory: 'mindset_growth',
    language: 'en',
    scenes: [
      {
        narration: 'You replay the same conversation for the tenth time.',
        visual: 'Person lying awake, thought bubbles looping above the bed.',
      },
      {
        narration: "Your mind calls it preparing. It's really just looping.",
        visual: 'A small figure walking in circles on a winding path.',
      },
      {
        narration: 'Try this. Write the worry down in one plain sentence.',
        visual: 'Hand writing a single line in a notebook by a window.',
      },
      {
        narration: 'Then ask: is there one small thing I can do today?',
        visual: 'The same person looking at the sunrise, notebook closed.',
      },
      {
        narration: 'If yes, do it. If not, let the page hold it for you.',
        visual: 'Notebook on a shelf, person walking out into daylight.',
      },
    ],
  },
  {
    brandId: 'behtar-bano',
    title: 'दो मिनट का नियम',
    contentCategory: 'habits_discipline',
    language: 'hi',
    scenes: [
      {
        narration: 'हर सुबह तुम सोचते हो, आज से नई शुरुआत करूँगा।',
        visual: 'College student waking up, looking at a long to-do list.',
      },
      {
        narration: 'लेकिन बड़ा बदलाव डराता है, इसलिए हम उसे कल पर टाल देते हैं।',
        visual: 'The to-do list grows taller than the student.',
      },
      {
        narration: 'तो बदलाव को इतना छोटा कर दो कि मना ही न कर सको।',
        visual: 'The list shrinks into a tiny card with one line.',
      },
      {
        narration: 'सिर्फ़ दो मिनट पढ़ो, दो मिनट टहलो, या दो मिनट लिखो।',
        visual: 'Three quick vignettes: a book, a terrace walk, a diary.',
      },
      {
        narration: 'छोटी जीत रोज़ जुड़ती है। कल फिर बस दो मिनट।',
        visual: 'A calendar filling up with small green ticks.',
      },
    ],
  },
  {
    brandId: 'chinni-lokam',
    title: 'చిట్టి మామిడి పండ్లు లెక్కపెడుతుంది',
    contentCategory: 'learning_video',
    language: 'te',
    scenes: [
      {
        narration: 'చిన్ని తోటలోకి చిలుక చిట్టి వచ్చింది!',
        visual: 'A friendly green parrot (Chitti) landing in a small garden.',
        props: 0,
      },
      {
        narration: 'చెట్టు మీద మామిడి పండ్లు ఉన్నాయి. రండి, లెక్కపెడదాం!',
        visual: 'Mango tree with fruit; Chitti points with a wing.',
        props: 5,
      },
      {
        narration: 'ఒకటి, రెండు, మూడు!',
        visual: 'Three mangoes glow one by one as they are counted.',
        props: 3,
      },
      {
        narration: 'నాలుగు, ఐదు! ఐదు మామిడి పండ్లు!',
        visual: 'Five mangoes in a row, Chitti claps happily.',
        props: 5,
      },
      {
        narration: 'చిట్టి స్నేహితులతో పంచుకుంది. పంచుకోవడం ఎంత బాగుంది!',
        visual: 'Chitti shares mangoes with a squirrel and a little bird.',
      },
    ],
  },
];
