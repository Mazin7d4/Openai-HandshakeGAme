// The longer words are substring matches. Ambiguous short roots are checked
// only as complete whitespace-separated name tokens by leaderboard.mjs.
export const PROFANITY_WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'shitty', 'bullshit',
  'bitch', 'bitches', 'bastard', 'dickhead', 'dickweed', 'douche',
  'douchebag', 'jackass', 'piss', 'pissed', 'prick', 'slut', 'whore',
  'twat', 'wanker', 'motherfuck', 'cockhead', 'cocksucker',
  'nigger', 'nigga', 'chink', 'wetback', 'kike', 'tranny', 'faggot', 'faggy', 'retard', 'retarded',
  'skank', 'cumshot', 'jizz', 'porn', 'blowjob', 'handjob', 'rimjob',
  'gangbang', 'rapist',
];

export const WHOLE_WORD = [
  'ass', 'cum', 'tit', 'fag', 'cock', 'cunt', 'coon', 'spic', 'gook', 'kraut', 'dyke', 'rape',
];

export default PROFANITY_WORDS;
