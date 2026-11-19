import { DEVOTIONAL_SLOTS, GLOBAL_CONTENT_RULES, HINDU_DEVOTIONAL_RULES, PLATFORMS_ALL } from '../shared.js';
import type { BrandConfig } from '../types.js';

export const bhaktiKiShakti: BrandConfig = {
  id: 'bhakti-ki-shakti',
  brandNumber: 3,
  displayName: 'Bhakti Ki Shakti',
  nativeName: 'भक्ति की शक्ति',
  language: 'hi',
  locale: 'hi-IN',
  audience: 'Hindi-speaking viewers',
  niche: 'hindu_devotional',
  tradition: 'hindu',
  madeForKids: false,
  dailyVideoTarget: 3,
  publishTimezone: 'Asia/Kolkata',
  platforms: [...PLATFORMS_ALL],
  contentSlots: DEVOTIONAL_SLOTS,
  topics: [
    'Krishna',
    'Shiva',
    'Hanuman',
    'Rama',
    'Vishnu',
    'Bhagavad Gita',
    'Ramayana',
    'Mahabharata',
    'Hindu stories',
    'Devotional teachings',
    'Mantras and their meanings',
  ],
  validation: { factCheck: true, scriptureCheck: true, childSafety: false },
  contentRules: [
    ...GLOBAL_CONTENT_RULES,
    ...HINDU_DEVOTIONAL_RULES,
    'Write in natural, everyday devotional Hindi (Devanagari); Sanskrit shlokas must be quoted exactly with meaning.',
  ],
  visualIdentity: {
    style: 'Rich devotional illustration inspired by traditional Indian painting, with original compositions',
    palette: ['#FF9933', '#8B0000', '#FFD700', '#1F4E79', '#FFF5E1'],
    typography: 'Bold Devanagari display font for titles, readable Devanagari sans for captions',
    characterNotes:
      'Respectful, consistent depictions of deities; original artwork, never copied from existing art',
    pacing: 'Story-led with gentle zooms; slower for mantras',
    avoid: ['Disrespectful or comic depictions of deities', 'Fear-based messaging', 'Unverified miracles'],
  },
  voice: {
    direction:
      'Calm, reverent Hindi male storyteller in his 40s; deep, smooth and devotional, with clear Sanskrit-friendly diction.',
    elevenLabs: {
      voiceId: 'qDuRKMlYmrm8trt5QyBn',
      name: 'Taksh - Calm, Serious and Smooth',
      source: 'library',
    },
    alternatives: [
      { voiceId: '6EphsklDopDQ6eRkwNHT', name: 'Shardul K - Hindu Mythology Storyteller', source: 'library' },
      {
        voiceId: 'zlREppBW1FE7WsYs43Sz',
        name: 'Yatin - Sacred & Divine Love Storyteller',
        source: 'library',
      },
    ],
  },
};
