/**
 * Emoji Detection & Helper Utilities for Connexa Messenger
 */

export interface EmojiInfo {
  isOnlyEmojis: boolean;
  count: number;
}

/**
 * Checks whether text consists purely of emoji characters (ignoring whitespace).
 * Uses grapheme segmentation to accurately count compound emojis (e.g. 👨‍👩‍👧‍👦, 🏳️‍🌈, ❤️‍🔥).
 */
export function getEmojiInfo(text: string): EmojiInfo {
  if (!text) return { isOnlyEmojis: false, count: 0 };
  const trimmed = text.trim();
  if (!trimmed) return { isOnlyEmojis: false, count: 0 };

  // Segment by graphemes to support multi-code-point emojis correctly
  let graphemes: string[] = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    graphemes = Array.from(segmenter.segment(trimmed)).map(s => s.segment);
  } else {
    // Fallback: match emoji sequences
    const matches = trimmed.match(/\p{Extended_Pictographic}/gu);
    graphemes = matches || [];
  }

  // Filter out any whitespace graphemes
  const nonWhitespaceGraphemes = graphemes.filter(g => !/^\s+$/.test(g));
  if (nonWhitespaceGraphemes.length === 0) {
    return { isOnlyEmojis: false, count: 0 };
  }

  // Regex to verify whether a grapheme is an emoji pictograph
  // Strips zero-width joiners and variation selectors before testing
  const emojiRegex = /^\p{Extended_Pictographic}+$/u;
  const allEmojis = nonWhitespaceGraphemes.every(g => {
    const stripped = g.replace(/[\uFE0E\uFE0F\u200D]/g, '');
    return emojiRegex.test(stripped);
  });

  return {
    isOnlyEmojis: allEmojis,
    count: nonWhitespaceGraphemes.length
  };
}

export interface EmojiCategory {
  id: string;
  name: string;
  icon: string;
  emojis: { emoji: string; name: string; keywords?: string[] }[];
}

export const QUICK_EMOJIS = ['❤️', '😂', '👍', '🔥', '😍', '🎉', '🙏', '😊', '✨', '🥺'];

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: '😊',
    emojis: [
      { emoji: '😀', name: 'grinning face', keywords: ['happy', 'smile'] },
      { emoji: '😃', name: 'grinning face with big eyes', keywords: ['happy', 'joy'] },
      { emoji: '😄', name: 'grinning face with smiling eyes', keywords: ['happy', 'laugh'] },
      { emoji: '😁', name: 'beaming face', keywords: ['grin'] },
      { emoji: '😆', name: 'grinning squinting face', keywords: ['laugh', 'lol'] },
      { emoji: '😅', name: 'sweat smile', keywords: ['hot', 'relief'] },
      { emoji: '😂', name: 'face with tears of joy', keywords: ['laugh', 'crying', 'lol'] },
      { emoji: '🤣', name: 'rolling on floor laughing', keywords: ['rofl', 'laugh'] },
      { emoji: '🥲', name: 'smiling face with tear', keywords: ['sad', 'grateful'] },
      { emoji: '🥹', name: 'holding back tears', keywords: ['proud', 'touched'] },
      { emoji: '😊', name: 'smiling face with smiling eyes', keywords: ['blush', 'warm'] },
      { emoji: '😇', name: 'smiling face with halo', keywords: ['angel', 'innocent'] },
      { emoji: '🙂', name: 'slightly smiling face', keywords: ['smile', 'fine'] },
      { emoji: '🙃', name: 'upside down face', keywords: ['silly', 'sarcasm'] },
      { emoji: '😉', name: 'winking face', keywords: ['wink', 'flirt'] },
      { emoji: '😌', name: 'relieved face', keywords: ['peace', 'calm'] },
      { emoji: '😍', name: 'heart eyes', keywords: ['love', 'crush'] },
      { emoji: '🥰', name: 'smiling face with hearts', keywords: ['love', 'adore'] },
      { emoji: '😘', name: 'face blowing a kiss', keywords: ['kiss', 'love'] },
      { emoji: '😗', name: 'kissing face', keywords: ['kiss'] },
      { emoji: '😙', name: 'kissing face with smiling eyes', keywords: ['kiss'] },
      { emoji: '😚', name: 'kissing face with closed eyes', keywords: ['kiss'] },
      { emoji: '😋', name: 'face savoring food', keywords: ['yum', 'delicious'] },
      { emoji: '😛', name: 'face with tongue', keywords: ['tongue', 'silly'] },
      { emoji: '😜', name: 'winking face with tongue', keywords: ['joke', 'party'] },
      { emoji: '🤪', name: 'zany face', keywords: ['crazy', 'wild'] },
      { emoji: '😝', name: 'squinting face with tongue', keywords: ['playful'] },
      { emoji: '🤑', name: 'money mouth face', keywords: ['rich', 'dollar'] },
      { emoji: '🤗', name: 'smiling face with open hands', keywords: ['hug'] },
      { emoji: '🫣', name: 'face with peeking eye', keywords: ['shy', 'scared'] },
      { emoji: '🤫', name: 'shushing face', keywords: ['quiet', 'secret'] },
      { emoji: '🤔', name: 'thinking face', keywords: ['think', 'wonder'] },
      { emoji: '🫡', name: 'saluting face', keywords: ['yes', 'sir', 'respect'] },
      { emoji: '🤐', name: 'zipper mouth face', keywords: ['silent'] },
      { emoji: '🤨', name: 'face with raised eyebrow', keywords: ['skeptical'] },
      { emoji: '😐', name: 'neutral face', keywords: ['meh'] },
      { emoji: '😑', name: 'expressionless face', keywords: ['blank'] },
      { emoji: '😶', name: 'face without mouth', keywords: ['speechless'] },
      { emoji: '😏', name: 'smirking face', keywords: ['smirk', 'cool'] },
      { emoji: '😒', name: 'unamused face', keywords: ['annoyed'] },
      { emoji: '🙄', name: 'face with rolling eyes', keywords: ['whatever'] },
      { emoji: '😬', name: 'grimacing face', keywords: ['awkward', 'oops'] },
      { emoji: '🤥', name: 'lying face', keywords: ['pinocchio', 'lie'] },
      { emoji: '😌', name: 'relieved', keywords: ['relaxed'] },
      { emoji: '😔', name: 'pensive face', keywords: ['sad', 'down'] },
      { emoji: '😪', name: 'sleepy face', keywords: ['tired'] },
      { emoji: '🤤', name: 'drooling face', keywords: ['hungry'] },
      { emoji: '😴', name: 'sleeping face', keywords: ['goodnight', 'zzz'] },
      { emoji: '😷', name: 'face with medical mask', keywords: ['sick'] },
      { emoji: '🤒', name: 'face with thermometer', keywords: ['ill', 'fever'] },
      { emoji: '🤕', name: 'face with head bandage', keywords: ['hurt'] },
      { emoji: '🤢', name: 'nauseated face', keywords: ['gross'] },
      { emoji: '🤮', name: 'face vomiting', keywords: ['disgust'] },
      { emoji: '🤧', name: 'sneezing face', keywords: ['sneeze'] },
      { emoji: '🥵', name: 'hot face', keywords: ['heat', 'summer'] },
      { emoji: '🥶', name: 'cold face', keywords: ['freezing', 'winter'] },
      { emoji: '🥴', name: 'woozy face', keywords: ['dizzy'] },
      { emoji: '😵', name: 'knocked-out face', keywords: ['dead'] },
      { emoji: '🤯', name: 'exploding head', keywords: ['mindblown'] },
      { emoji: '🤠', name: 'cowboy hat face', keywords: ['western'] },
      { emoji: '🥳', name: 'partying face', keywords: ['celebrate', 'birthday'] },
      { emoji: '😎', name: 'smiling face with sunglasses', keywords: ['cool', 'chill'] },
      { emoji: '🤓', name: 'nerd face', keywords: ['geek'] },
      { emoji: '🧐', name: 'face with monocle', keywords: ['curious'] },
      { emoji: '😕', name: 'confused face', keywords: ['puzzled'] },
      { emoji: '😟', name: 'worried face', keywords: ['concern'] },
      { emoji: '🙁', name: 'slightly frowning face', keywords: ['unhappy'] },
      { emoji: '☹️', name: 'frowning face', keywords: ['sad'] },
      { emoji: '😮', name: 'face with open mouth', keywords: ['wow'] },
      { emoji: '😯', name: 'hushed face', keywords: ['surprise'] },
      { emoji: '😲', name: 'astonished face', keywords: ['shock'] },
      { emoji: '😳', name: 'flushed face', keywords: ['embarrassed'] },
      { emoji: '🥺', name: 'pleading face', keywords: ['puppy eyes', 'please'] },
      { emoji: '😦', name: 'frowning face with open mouth', keywords: ['gasp'] },
      { emoji: '😨', name: 'fearful face', keywords: ['scared'] },
      { emoji: '😰', name: 'anxious face with sweat', keywords: ['nervous'] },
      { emoji: '😥', name: 'sad but relieved face', keywords: ['close call'] },
      { emoji: '😢', name: 'crying face', keywords: ['tear', 'sad'] },
      { emoji: '😭', name: 'loudly crying face', keywords: ['bawling', 'sob'] },
      { emoji: '😱', name: 'face screaming in fear', keywords: ['horror'] },
      { emoji: '😖', name: 'confounded face', keywords: ['frustrated'] },
      { emoji: '😣', name: 'persevering face', keywords: ['struggle'] },
      { emoji: '😞', name: 'disappointed face', keywords: ['letdown'] },
      { emoji: '😓', name: 'downcast face with sweat', keywords: ['hard work'] },
      { emoji: '😩', name: 'weary face', keywords: ['exhausted'] },
      { emoji: '😫', name: 'tired face', keywords: ['sleepy'] },
      { emoji: '🥱', name: 'yawning face', keywords: ['bored'] },
      { emoji: '😤', name: 'face with steam from nose', keywords: ['proud', 'triumph'] },
      { emoji: '😡', name: 'pouting face', keywords: ['angry', 'mad'] },
      { emoji: '😠', name: 'angry face', keywords: ['cross'] },
      { emoji: '🤬', name: 'face with symbols on mouth', keywords: ['swearing', 'rage'] },
      { emoji: '😈', name: 'smiling face with horns', keywords: ['devil', 'mischief'] },
      { emoji: '👿', name: 'angry face with horns', keywords: ['demon'] },
      { emoji: '💀', name: 'skull', keywords: ['dead', 'skeleton', 'lol'] },
      { emoji: '☠️', name: 'skull and crossbones', keywords: ['danger', 'poison'] },
      { emoji: '💩', name: 'pile of poo', keywords: ['poop', 'crap'] },
      { emoji: '🤡', name: 'clown face', keywords: ['circus'] },
      { emoji: '👻', name: 'ghost', keywords: ['spooky', 'halloween'] },
      { emoji: '👽', name: 'alien', keywords: ['ufo'] },
      { emoji: '🤖', name: 'robot', keywords: ['bot'] }
    ]
  },
  {
    id: 'gestures',
    name: 'Gestures & People',
    icon: '👋',
    emojis: [
      { emoji: '👋', name: 'waving hand', keywords: ['hello', 'bye'] },
      { emoji: '🤚', name: 'raised back of hand', keywords: ['stop'] },
      { emoji: '🖐️', name: 'hand with fingers splayed', keywords: ['five'] },
      { emoji: '✋', name: 'raised hand', keywords: ['high five'] },
      { emoji: '🖖', name: 'vulcan salute', keywords: ['star trek'] },
      { emoji: '🫱', name: 'rightwards hand', keywords: ['reach'] },
      { emoji: '🫲', name: 'leftwards hand', keywords: ['reach'] },
      { emoji: '👌', name: 'OK hand', keywords: ['perfect', 'agree'] },
      { emoji: '🤌', name: 'pinched fingers', keywords: ['italian'] },
      { emoji: '🤏', name: 'pinching hand', keywords: ['small', 'little'] },
      { emoji: '✌️', name: 'victory hand', keywords: ['peace'] },
      { emoji: '🤞', name: 'crossed fingers', keywords: ['luck', 'hope'] },
      { emoji: '🫰', name: 'hand with index finger and thumb crossed', keywords: ['kpop', 'heart'] },
      { emoji: '🤟', name: 'love-you gesture', keywords: ['love'] },
      { emoji: '🤘', name: 'sign of the horns', keywords: ['rock', 'metal'] },
      { emoji: '🤙', name: 'call me hand', keywords: ['hang loose', 'shaka'] },
      { emoji: '👈', name: 'backhand index pointing left', keywords: ['left'] },
      { emoji: '👉', name: 'backhand index pointing right', keywords: ['right'] },
      { emoji: '👆', name: 'backhand index pointing up', keywords: ['up'] },
      { emoji: '🖕', name: 'middle finger', keywords: ['insult'] },
      { emoji: '👇', name: 'backhand index pointing down', keywords: ['down'] },
      { emoji: '☝️', name: 'index pointing up', keywords: ['one'] },
      { emoji: '👍', name: 'thumbs up', keywords: ['like', 'approve', 'yes'] },
      { emoji: '👎', name: 'thumbs down', keywords: ['dislike', 'no'] },
      { emoji: '✊', name: 'raised fist', keywords: ['power'] },
      { emoji: '👊', name: 'oncoming fist', keywords: ['fist bump'] },
      { emoji: '🤛', name: 'left-facing fist', keywords: ['punch'] },
      { emoji: '🤜', name: 'right-facing fist', keywords: ['bump'] },
      { emoji: '👏', name: 'clapping hands', keywords: ['applause', 'bravo'] },
      { emoji: '🙌', name: 'raising hands', keywords: ['celebrate', 'hooray'] },
      { emoji: '🫶', name: 'heart hands', keywords: ['love'] },
      { emoji: '👐', name: 'open hands', keywords: ['welcome'] },
      { emoji: '🤲', name: 'palms up together', keywords: ['prayer'] },
      { emoji: '🤝', name: 'handshake', keywords: ['deal', 'agreement'] },
      { emoji: '🙏', name: 'folded hands', keywords: ['please', 'thanks', 'pray'] },
      { emoji: '✍️', name: 'writing hand', keywords: ['write'] },
      { emoji: '💅', name: 'nail polish', keywords: ['sass', 'fabulous'] },
      { emoji: '🤳', name: 'selfie', keywords: ['camera'] },
      { emoji: '💪', name: 'flexed biceps', keywords: ['strong', 'gym', 'workout'] },
      { emoji: '👀', name: 'eyes', keywords: ['look', 'see'] },
      { emoji: '👁️', name: 'eye', keywords: ['look'] },
      { emoji: '👅', name: 'tongue', keywords: ['taste'] },
      { emoji: '👄', name: 'mouth', keywords: ['lips'] },
      { emoji: '🫦', name: 'biting lip', keywords: ['flirt'] }
    ]
  },
  {
    id: 'hearts',
    name: 'Hearts & Love',
    icon: '❤️',
    emojis: [
      { emoji: '❤️', name: 'red heart', keywords: ['love', 'like'] },
      { emoji: '🧡', name: 'orange heart', keywords: ['love'] },
      { emoji: '💛', name: 'yellow heart', keywords: ['love', 'friendship'] },
      { emoji: '💚', name: 'green heart', keywords: ['love', 'nature'] },
      { emoji: '💙', name: 'blue heart', keywords: ['love', 'peace'] },
      { emoji: '💜', name: 'purple heart', keywords: ['love'] },
      { emoji: '🖤', name: 'black heart', keywords: ['dark', 'goth'] },
      { emoji: '🤍', name: 'white heart', keywords: ['pure'] },
      { emoji: '🤎', name: 'brown heart', keywords: ['warm'] },
      { emoji: '💔', name: 'broken heart', keywords: ['breakup', 'sad'] },
      { emoji: '❤️‍🔥', name: 'heart on fire', keywords: ['passion', 'hot'] },
      { emoji: '❤️‍🩹', name: 'mending heart', keywords: ['heal'] },
      { emoji: '❣️', name: 'heart exclamation', keywords: ['love'] },
      { emoji: '💕', name: 'two hearts', keywords: ['love'] },
      { emoji: '💞', name: 'revolving hearts', keywords: ['love'] },
      { emoji: '💓', name: 'beating heart', keywords: ['pulse'] },
      { emoji: '💗', name: 'growing heart', keywords: ['sweet'] },
      { emoji: '💖', name: 'sparkling heart', keywords: ['magic', 'glitter'] },
      { emoji: '💘', name: 'heart with arrow', keywords: ['cupid'] },
      { emoji: '💝', name: 'heart with ribbon', keywords: ['gift'] },
      { emoji: '💟', name: 'heart decoration', keywords: ['card'] },
      { emoji: '💌', name: 'love letter', keywords: ['note'] },
      { emoji: '💋', name: 'kiss mark', keywords: ['kiss', 'lips'] }
    ]
  },
  {
    id: 'animals',
    name: 'Animals & Nature',
    icon: '🐶',
    emojis: [
      { emoji: '🐶', name: 'dog face', keywords: ['puppy', 'pet'] },
      { emoji: '🐱', name: 'cat face', keywords: ['kitten', 'meow'] },
      { emoji: '🐭', name: 'mouse face', keywords: ['rodent'] },
      { emoji: '🐹', name: 'hamster face', keywords: ['cute'] },
      { emoji: '🐰', name: 'rabbit face', keywords: ['bunny'] },
      { emoji: '🦊', name: 'fox', keywords: ['clever'] },
      { emoji: '🐻', name: 'bear', keywords: ['teddy'] },
      { emoji: '🐼', name: 'panda', keywords: ['bamboo'] },
      { emoji: '🐨', name: 'koala', keywords: ['australia'] },
      { emoji: '🐯', name: 'tiger face', keywords: ['wild'] },
      { emoji: '🦁', name: 'lion', keywords: ['king'] },
      { emoji: '🐮', name: 'cow face', keywords: ['farm'] },
      { emoji: '🐷', name: 'pig face', keywords: ['oink'] },
      { emoji: '🐸', name: 'frog', keywords: ['amphibian'] },
      { emoji: '🐵', name: 'monkey face', keywords: ['ape'] },
      { emoji: '🐔', name: 'chicken', keywords: ['bird'] },
      { emoji: '🐧', name: 'penguin', keywords: ['ice'] },
      { emoji: '🐦', name: 'bird', keywords: ['tweet'] },
      { emoji: '🦆', name: 'duck', keywords: ['quack'] },
      { emoji: '🦅', name: 'eagle', keywords: ['bird'] },
      { emoji: '🦉', name: 'owl', keywords: ['wise'] },
      { emoji: '🦇', name: 'bat', keywords: ['night'] },
      { emoji: '🐺', name: 'wolf', keywords: ['howl'] },
      { emoji: '🐗', name: 'boar', keywords: ['pig'] },
      { emoji: '🐴', name: 'horse face', keywords: ['ride'] },
      { emoji: '🦄', name: 'unicorn', keywords: ['magic'] },
      { emoji: '🐝', name: 'honeybee', keywords: ['buzz', 'honey'] },
      { emoji: '🐛', name: 'bug', keywords: ['insect'] },
      { emoji: '🦋', name: 'butterfly', keywords: ['pretty'] },
      { emoji: '🐌', name: 'snail', keywords: ['slow'] },
      { emoji: '🐞', name: 'lady beetle', keywords: ['ladybug'] },
      { emoji: '🐢', name: 'turtle', keywords: ['slow'] },
      { emoji: '🐍', name: 'snake', keywords: ['serpent'] },
      { emoji: '🐙', name: 'octopus', keywords: ['ocean'] },
      { emoji: '🐬', name: 'dolphin', keywords: ['sea'] },
      { emoji: '🐳', name: 'whale', keywords: ['ocean'] },
      { emoji: '🦈', name: 'shark', keywords: ['danger'] },
      { emoji: '🌸', name: 'cherry blossom', keywords: ['flower', 'spring'] },
      { emoji: '🌹', name: 'rose', keywords: ['romantic'] },
      { emoji: '🌺', name: 'hibiscus', keywords: ['flower'] },
      { emoji: '🌻', name: 'sunflower', keywords: ['sun', 'yellow'] },
      { emoji: '🌼', name: 'blossom', keywords: ['flower'] },
      { emoji: '🌷', name: 'tulip', keywords: ['flower'] },
      { emoji: '🌱', name: 'seedling', keywords: ['grow'] },
      { emoji: '🌲', name: 'evergreen tree', keywords: ['pine'] },
      { emoji: '🌴', name: 'palm tree', keywords: ['beach', 'tropical'] },
      { emoji: '🌵', name: 'cactus', keywords: ['desert'] },
      { emoji: '🍀', name: 'four leaf clover', keywords: ['lucky'] },
      { emoji: '🍁', name: 'maple leaf', keywords: ['autumn', 'canada'] }
    ]
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: '🍔',
    emojis: [
      { emoji: '🍏', name: 'green apple', keywords: ['fruit'] },
      { emoji: '🍎', name: 'red apple', keywords: ['fruit'] },
      { emoji: '🍌', name: 'banana', keywords: ['fruit'] },
      { emoji: '🍉', name: 'watermelon', keywords: ['summer'] },
      { emoji: '🍇', name: 'grapes', keywords: ['wine'] },
      { emoji: '🍓', name: 'strawberry', keywords: ['berry'] },
      { emoji: '🍒', name: 'cherries', keywords: ['fruit'] },
      { emoji: '🍑', name: 'peach', keywords: ['fruit'] },
      { emoji: '🍍', name: 'pineapple', keywords: ['tropical'] },
      { emoji: '🥥', name: 'coconut', keywords: ['island'] },
      { emoji: '🥑', name: 'avocado', keywords: ['guac'] },
      { emoji: '🥦', name: 'broccoli', keywords: ['veggie'] },
      { emoji: '🌶️', name: 'hot pepper', keywords: ['spicy'] },
      { emoji: '🌽', name: 'corn', keywords: ['maize'] },
      { emoji: '🥕', name: 'carrot', keywords: ['veggie'] },
      { emoji: '🥐', name: 'croissant', keywords: ['pastry', 'bakery'] },
      { emoji: '🍞', name: 'bread', keywords: ['toast'] },
      { emoji: '🧀', name: 'cheese wedge', keywords: ['cheddar'] },
      { emoji: '🍳', name: 'cooking', keywords: ['egg', 'breakfast'] },
      { emoji: '🥞', name: 'pancakes', keywords: ['brunch'] },
      { emoji: '🧇', name: 'waffle', keywords: ['breakfast'] },
      { emoji: '🥓', name: 'bacon', keywords: ['pork'] },
      { emoji: '🥩', name: 'cut of meat', keywords: ['steak'] },
      { emoji: '🍗', name: 'poultry leg', keywords: ['chicken'] },
      { emoji: '🍔', name: 'hamburger', keywords: ['fast food', 'burger'] },
      { emoji: '🍟', name: 'french fries', keywords: ['chips'] },
      { emoji: '🍕', name: 'pizza', keywords: ['cheese', 'slice'] },
      { emoji: '🥪', name: 'sandwich', keywords: ['lunch'] },
      { emoji: '🌮', name: 'taco', keywords: ['mexican'] },
      { emoji: '🌯', name: 'burrito', keywords: ['wrap'] },
      { emoji: '🥗', name: 'green salad', keywords: ['healthy'] },
      { emoji: '🍝', name: 'spaghetti', keywords: ['pasta'] },
      { emoji: '🍜', name: 'steaming bowl', keywords: ['ramen', 'noodles'] },
      { emoji: '🍲', name: 'pot of food', keywords: ['soup', 'stew'] },
      { emoji: '🍣', name: 'sushi', keywords: ['japanese'] },
      { emoji: '🍱', name: 'bento box', keywords: ['lunch'] },
      { emoji: '🍦', name: 'soft ice cream', keywords: ['dessert'] },
      { emoji: '🍧', name: 'shaved ice', keywords: ['ice'] },
      { emoji: '🍨', name: 'ice cream', keywords: ['gelato'] },
      { emoji: '🍩', name: 'doughnut', keywords: ['donut'] },
      { emoji: '🍪', name: 'cookie', keywords: ['chocolate chip'] },
      { emoji: '🎂', name: 'birthday cake', keywords: ['party', 'celebrate'] },
      { emoji: '🍰', name: 'shortcake', keywords: ['slice'] },
      { emoji: '🧁', name: 'cupcake', keywords: ['sweet'] },
      { emoji: '🍫', name: 'chocolate bar', keywords: ['candy'] },
      { emoji: '🍿', name: 'popcorn', keywords: ['movie'] },
      { emoji: '☕', name: 'hot beverage', keywords: ['coffee', 'tea'] },
      { emoji: '🍵', name: 'teacup without handle', keywords: ['green tea'] },
      { emoji: '🧋', name: 'bubble tea', keywords: ['boba'] },
      { emoji: '🥤', name: 'cup with straw', keywords: ['soda'] },
      { emoji: '🍺', name: 'beer mug', keywords: ['alcohol', 'cheers'] },
      { emoji: '🍻', name: 'clinking beer mugs', keywords: ['celebrate'] },
      { emoji: '🥂', name: 'clinking glasses', keywords: ['toast', 'champagne'] },
      { emoji: '🍷', name: 'wine glass', keywords: ['red wine'] }
    ]
  },
  {
    id: 'activities',
    name: 'Activities & Symbols',
    icon: '✨',
    emojis: [
      { emoji: '✨', name: 'sparkles', keywords: ['magic', 'shine', 'clean'] },
      { emoji: '⭐', name: 'star', keywords: ['night'] },
      { emoji: '🌟', name: 'glowing star', keywords: ['famous'] },
      { emoji: '💫', name: 'dizzy', keywords: ['star'] },
      { emoji: '🔥', name: 'fire', keywords: ['lit', 'hot', 'flame'] },
      { emoji: '💥', name: 'collision', keywords: ['boom', 'bang'] },
      { emoji: '🎉', name: 'party popper', keywords: ['tada', 'congrats'] },
      { emoji: '🎊', name: 'confetti ball', keywords: ['party'] },
      { emoji: '🎈', name: 'balloon', keywords: ['birthday'] },
      { emoji: '🎁', name: 'wrapped gift', keywords: ['present'] },
      { emoji: '🏆', name: 'trophy', keywords: ['winner', 'champion'] },
      { emoji: '🥇', name: '1st place medal', keywords: ['first', 'gold'] },
      { emoji: '⚽', name: 'soccer ball', keywords: ['football'] },
      { emoji: '🏀', name: 'basketball', keywords: ['hoops'] },
      { emoji: '🏈', name: 'american football', keywords: ['superbowl'] },
      { emoji: '⚾', name: 'baseball', keywords: ['sports'] },
      { emoji: '🎾', name: 'tennis', keywords: ['match'] },
      { emoji: '🎮', name: 'video game', keywords: ['controller', 'play'] },
      { emoji: '🎯', name: 'bullseye', keywords: ['target'] },
      { emoji: '🎲', name: 'game die', keywords: ['dice', 'luck'] },
      { emoji: '🎵', name: 'musical note', keywords: ['song'] },
      { emoji: '🎶', name: 'musical notes', keywords: ['music'] },
      { emoji: '🎤', name: 'microphone', keywords: ['sing', 'karaoke'] },
      { emoji: '🎧', name: 'headphone', keywords: ['music', 'listen'] },
      { emoji: '📸', name: 'camera with flash', keywords: ['photo'] },
      { emoji: '💡', name: 'light bulb', keywords: ['idea'] },
      { emoji: '📱', name: 'mobile phone', keywords: ['smartphone'] },
      { emoji: '💻', name: 'laptop', keywords: ['computer'] },
      { emoji: '🚀', name: 'rocket', keywords: ['launch', 'moon'] },
      { emoji: '🚗', name: 'automobile', keywords: ['car'] },
      { emoji: '✈️', name: 'airplane', keywords: ['fly', 'travel'] },
      { emoji: '🏖️', name: 'beach with umbrella', keywords: ['vacation'] },
      { emoji: '💯', name: 'hundred points', keywords: ['perfect', 'score'] },
      { emoji: '✔️', name: 'check mark', keywords: ['done', 'yes'] },
      { emoji: '❌', name: 'cross mark', keywords: ['no', 'cancel'] }
    ]
  }
];
