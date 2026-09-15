const ABBREVIATIONS: Record<string, string> = {
  名词: 'n.', noun: 'n.', n: 'n.',
  动词: 'v.', verb: 'v.', v: 'v.',
  及物动词: 'vt.', 'transitive verb': 'vt.', vt: 'vt.',
  不及物动词: 'vi.', 'intransitive verb': 'vi.', vi: 'vi.',
  形容词: 'adj.', adjective: 'adj.', adj: 'adj.',
  副词: 'adv.', adverb: 'adv.', adv: 'adv.',
  代词: 'pron.', pronoun: 'pron.', pron: 'pron.',
  介词: 'prep.', preposition: 'prep.', prep: 'prep.',
  连词: 'conj.', conjunction: 'conj.', conj: 'conj.',
  冠词: 'art.', article: 'art.', art: 'art.',
  限定词: 'det.', determiner: 'det.', det: 'det.',
  数词: 'num.', numeral: 'num.', num: 'num.',
  感叹词: 'interj.', interjection: 'interj.', interj: 'interj.',
  助动词: 'aux.', 'auxiliary verb': 'aux.', aux: 'aux.',
  情态动词: 'modal v.', 'modal verb': 'modal v.',
  短语: 'phr.', phrase: 'phr.', phr: 'phr.',
  短语动词: 'phr. v.', 'phrasal verb': 'phr. v.',
  词性未知: '—', unknown: '—',
};

/** Also normalize responses from older servers/providers during rollout. */
export function abbreviatePartOfSpeech(value: string): string {
  return value.split(/\s*[;；、,/|]\s*/u).map((part) => {
    const key = part.trim().toLowerCase().replace(/\.$/u, '');
    return ABBREVIATIONS[key] ?? part.trim();
  }).filter(Boolean).join(' / ');
}
