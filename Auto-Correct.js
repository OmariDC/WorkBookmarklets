// Auto-Correct Bookmarklet Engine
// Namespace initialization
const AC = window.AC = window.AC || {};

// ===================== Storage system =====================
AC.storage = {
  prefix: 'ac:',
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch (e) {}
  },
  readRaw(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  writeRaw(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
};

// ===================== AC.state initialisation =====================
AC.state = {
  enabled: AC.storage.read('enabled', true),
  customMap: AC.storage.readRaw('ac_custom_map_v2', {}),
  customList: AC.storage.readRaw('ac_custom_dict_v2', []),
  capsRules: AC.storage.readRaw('ac_caps_rules_v2', []),
  customWordsNew: AC.storage.read('customWords', {}),
  customPhrasesNew: AC.storage.read('customPhrases', {}),
  logs: AC.storage.read('logs', []),
  stats: AC.storage.read('stats', { corrections: 0, lastCorrection: null }),
  recent: [],
  flatMap: {},
  multi: {},
  canonicals: [],
  lastAction: null,
  editors: new WeakSet(),
  keyListeners: new WeakMap(),
  observer: null,
  ui: { root: null, mapping: null, content: null, tabs: [], open: false, tab: 'log' }
};

// Clean invalid stored data
AC.state.customList = (AC.state.customList || []).filter(c => typeof c === "string" && c.trim());
AC.state.customMap = Object.fromEntries(
  Object.entries(AC.state.customMap || {}).filter(([m, c]) =>
    typeof m === "string" &&
    typeof c === "string" &&
    m.trim() &&
    c.trim()
  )
);

// ===================== Dictionary loading + merging =====================
AC.baseDict = {
  'Abarth': ['abart','abarht','abarth?'],
  'Alfa Romeo': ['alfaromeo','alpha romeo','alfa romo','alfaromeo','alfa romieo','alf aromeo','alpharomeo','alfa romio','alfa romero','alfa romeao','alfa romeo','alfa romeo','alfar omeo','alfa romeo','alfa romeo','alfaromeoo','alfa romeeo','alfa rome0','alfa r omeo','alfa romeo'],
  'Citroën': ['citroen','citreon','citroean','citroan','citroin','citoren','citroem'],
  'DS': ['ds','d.s.'],
  'DS Automobiles': ['ds automoblies','ds automobils','ds autom'],
  'Fiat': ['fiatt','fiadt'],
  'Jeep': ['jepp','jeap','jepe','jep'],
  'Leapmotor': ['leap motor','leapmotors'],
  'Peugeot': ['peugot','peugeut','peuguot','pegeot','pugeot','peugoet','peugeoet','pegueot'],
  'Vauxhall': ['vauxel','vauxall','vaxhall','vauxhal','vaulxhall','vauxheel'],
  'Stellantis': ['stellantus','stellentis','stellantis'],
  'Stellantis &You': ['stellantis and you','stellantis & you','stellantis &you','stellantis andyou'],
  'Birmingham Central': ['birmingam central','birmingham cental','birmingham centreal','brum central'],
  'Birmingham': ['brum'],
  'Birmingham North': ['birmingam north','birmingham nrth','birmingham northh','brum north'],
  'Birmingham South': ['birmingam south','birmingham soouth','birmingham southh','brum south'],
  'Bristol Cribbs': ['bristol cribs','bristolcribbs','bristol cribbb'],
  'Chelmsford': ['chelsford','chelmsord','chelmsfrod'],
  'Chingford': ['chingferd','chingfor','chingfrod'],
  'Coventry': ['coverty','coventary','covenrty'],
  'Crawley': ['crawely','crawly','crawlley'],
  'Croydon': ['croyden','croydun','croyodon'],
  'Edgware': ['edgeware','edgwer','edgwarre'],
  'Guildford': ['guilford','guild ford','guildfrod'],
  'Hatfield': ['hatfeild','hatfiled','hattfield'],
  'Leicester': ['lester','leister','liestter'],
  'Liverpool': ['liverpol','liverpoool','liverpoll'],
  'Maidstone': ['maidston','maidstoen','maidstoon'],
  'Manchester': ['manchestor','manchster','mannchester','manny'],
  'Newport': ['new port','newpport','newprot'],
  'Nottingham': ['nottingam','nottinghum','nothtingham'],
  'Preston': ['prestan','prestron','prestonn'],
  'Redditch': ['reditch','reddich','reddittch'],
  'Romford': ['romferd','romfor','romfford'],
  'Sale': ['sael','sal','salle'],
  'Sheffield': ['shefffield','sheffied','sheffild'],
  'Stockport': ['stcokport','stockprt','stookport'],
  'Walton': ['waltom','waltn','waulton'],
  'West London': ['westlondon','west londn','west londom'],
  'Wimbledon': ['wimbeldon','wimbeldun','wimbeldoon'],
  'London': ['londen','londan','lindon','londdon','lndon','londn','ldn'],
  'Motability': ['motab','motabilty','motivability'],
  'UK': ['uk','u k'],
  'Monday': ['monday','mondey','monady'],
  'Tuesday': ['tuesday','tueday','tuesay','tueseday'],
  'Wednesday': ['wednesday','wensday','wednsday','wedensday'],
  'Thursday': ['thursday','thurday','thursay'],
  'Friday': ['friday','firday'],
  'Saturday': ['saturday','satarday'],
  'Sunday': ['sunday','sundey'],
  'January': ['januray','janary','januarry'],
  'February': ['febuary','feburary','februuary'],
  'March': ['marhc','mrach','marchh'],
  'April': ['aprill'],
  'May': ['mayy','maay'],
  'June': ['junee','juen'],
  'July': ['julyy','jly'],
  'August': ['augustt','agust','auguest'],
  'September': ['septemberr','septembar','setpember'],
  'October': ['octobr','octuber','otcober'],
  'November': ['novemberr','noovember','novembar'],
  'December': ['decemberr','decembar','decmeber'],
  'I': ['i'],
  'able': ['abl','ab le'],
  'add': ['ad','a dd'],
  'address': ['adress','adresss','adrs'],
  'advise': ['adice','advice','advise'],
  'agent': ['agnt','agant'],
  'agents': ['agnts','agantS','agantes'],
  'all': ['al','a ll'],
  'along': ['alng','alogn'],
  'am': ['ma','a m'],
  'an': ['na','a n'],
  'and': ['adn','an d','snd','se nd'],
  'any': ['an y','anyy','ani'],
  'appointments': ['appontments','apointments','appoinments'],
  'arrange': ['arange','arrnge'],
  'are': ['ar','aer','arre'],
  'as': ['sa','a s'],
  'at': ['ta','a t'],
  'available': ['availble','avialable','avalable'],
  'aware': ['awre','awar'],
  'be': ['eb','b e'],
  'because': ['becuase','beacuse'],
  'before': ['befor','bfore','befroe'],
  'believe': ['belive','beleive'],
  'book': ['bok','bokk'],
  'both': ['bth','booth'],
  'branches': ['braches','branchs'],
  'but': ['bt','b ut'],
  'calendar': ['calender'],
  'call': ['cal','cal l'],
  'calls': ['cals','calss'],
  'can': ['csn'],
  "can't": ['cant','can t','cnt'],
  'central': ['centrall','centrl'],
  'closer': ['closr','closeer','clsoer'],
  'come': ['cmoe','coem'],
  'confirm': ['confrm','cnfirm','confrim'],
  'contact': ['contat','contac'],
  'costs': ['csts'],
  "couldn't": ['couldnt','coudnt',"could'nt"],
  'currently': ['curently','currenty','currenlty'],
  'dealership': ['delership','dealrship'],
  'definitely': ['definately','definatly','defently'],
  'department': ['departmnt','departent'],
  'dates': ['daets','datse'],
  'detail': ['detial'],
  'details': ['detials','detals'],
  'directly': ['directy','dirctly'],
  'do': ['d0','od'],
  "don't": ['dont','don t'],
  'discuss': ['dicuss','discus'],
  'editor': ['edtor','editro','edditor'],
  'email': ['emial','emiall'],
  'enough': ['enuf','enogh'],
  'everything': ['everyting','evrything'],
  'expected': ['expcted','expeced','expectd'],
  'exchanged': ['exhanged','exchnged'],
  'find': ['fnd','fi nd'],
  'fine': ['fien','fin'],
  'for': ['fro','fo','fr'],
  'fuel': ['fuell','fu el'],
  'further': ['furhter'],
  'get': ['gt','git'],
  'give': ['giv','giev'],
  'go': ['og','g o'],
  'have': ['hvae','hae','hve','havet'],
  'hate': ['hat','haet'],
  'heard': ['herd','haerd'],
  'hello': ['helo','helllo'],
  'help': ['hlp','hepl','hekp'],
  'here': ['hre','he re'],
  'how': ['hw','hwo'],
  'however': ['hovewer','howeer','howerver'],
  'if': ['fi','i f'],
  "I'm": ['im'],
  'immediate': ['immediat','immediatly'],
  'in': ['ni','i n'],
  'information': ['informtion','infromation','informaiton'],
  'interested': ['intrested','intersted','intereste'],
  'instead': ['instaed','insted'],
  'into': ['in to'],
  'issue': ['issuse','isssue','isue'],
  'is': ['si','i s'],
  'it': ['ut'],
  "i've": ['ive'],
  'just': ['jst','ju st'],
  'local': ['locl','loca'],
  'looking': ['loking','lookng','lookin'],
  'looked': ['loked','lookked'],
  'limited': ['limted','limiited'],
  'like': ['lik','liek'],
  'make': ['mkae','mak'],
  'may': ['mya'],
  'me': ['m','mee'],
  'miles': ['miiles'],
  'morning': ['morng','morni ng'],
  'move': ['mvoe','moev'],
  'my': ['ny','ym'],
  'need': ['need'],
  'needed': ['neded','needd'],
  'never': ['nevr','neveer'],
  'next': ['nxt','nextt'],
  'no problem': ['np'],
  'not': ['nto','noot'],
  'number': ['nubmer','numbr'],
  'of': ['fo','o f'],
  'on': ['o n'],
  'onto': ['on to','ont o'],
  'or': ['ro','o r'],
  'orders': ['ordres','oders'],
  'our': ['our'],
  'part-exchange': ['px'],
  'part-exchanging': ['pxing'],
  'please': ['plese','pleas'],
  'postcode': ['postocde'],
  'price': ['prcie','prce'],
  'problem': ['probelm','proble'],
  'previously': ['prevously','previoiusly'],
  'purchase': ['purches','purchace','pursch'],
  'potential': ['potental','potentail'],
  'quarter': ['quater','quartre','qarter'],
  'receive': ['recieve','recive'],
  'referring': ['refering'],
  'recommend': ['recomend','reccommend','recommnd'],
  'recommended': ['recomended','reommend','recommened'],
  'require': ['requre','requier'],
  'sales': ['saels','sles'],
  'schedule': ['shedule','schedul'],
  'scheduling': ['schedualling'],
  'seems': ['sems'],
  'sent': ['snt','se nt'],
  'service': ['sevice','srvice'],
  "shouldn't": ['shouldnt','shoudnt',"should'nt"],
  'site': ['sitr','si te'],
  'so': ['os','s o'],
  'so I': ['so i'],
  'so much': ['sm'],
  'something': ['smt'],
  'specific': ['spefic','specfic'],
  'sure': ['sur','shure'],
  'test': ['tset','te st'],
  'team': ['tem','te am'],
  'that': ['thst'],
  'thank you': ['thankyou','ty','thak you','thank yu'],
  'the': ['th','thee','teh'],
  'their': ['thier'],
  'these': ['tehse','thes'],
  'there': ['ther','thre','thare'],
  'this': ['tis','thsi','thes'],
  'though': ['tho','thogh','thugh','thouhg','thoough'],
  'thought': ['thot','thougth'],
  'through': ['throguh','thruogh','throuogh'],
  'time': ['tme','tiem'],
  'today': ['tody','todday','tdy'],
  'tomorrow': ['tommorow','tomorow','tmr'],
  'transmission': ['transmision','trasmission'],
  'type': ['tpe','ty pe'],
  'unavailable': ['unavaible','unavalible'],
  'unfortunately': ['unfortunetly','unfortunatly'],
  'valuation': ['valutaion','valution','valuaton'],
  'vehicle': ['vehical','vechicle','vehicule','vehicel','vehicl','vehcilea','vehcile'],
  'vehicles': ['vehciles','vehicels','vehicles','vehicals','vechicles','vehicules','vehicels','vehicls','vehcileas'],
  'viewings': ['viewngs','vieewings'],
  'website': ['wesbite','webiste','websit'],
  'we': ['ew','w e'],
  'West': ['wset','we st'],
  'which': ['whcih','whihc'],
  'will': ['wil','wll'],
  'with': ['wiht','w tih'],
  'work': ['wrok'],
  'working': ['workng','wroking','workiing'],
  'would': ['woudl','wold'],
  "wouldn't": ['woudlnt','wouldnt'],
  'wrong': ['wron','wrnog'],
  'yes': ['ye','y es'],
  'yet': ['yte','yt'],
  'you': ['yo','yuo','u'],
  'your': ['uour','ur'],
  'yourself': ['yourslef','yourse lf'],
  'seperate': ['seperate'],
  'recieve': ['recieve'],
  'adress': ['adress'],
  'definate': ['definate'],
  'definately': ['definately'],
  'occurence': ['occurence'],
  'occurance': ['occurance'],
  'embarass': ['embarass'],
  'embarassed': ['embarassed'],
  'goverment': ['goverment'],
  'enviroment': ['enviroment'],
  'responce': ['responce'],
  'writting': ['writting'],
  'arguement': ['arguement'],
  'beleive': ['beleive'],
  'wierd': ['wierd'],
  'existance': ['existance'],
  'firey': ['firey'],
  'gratefull': ['gratefull'],
  'independant': ['independant'],
  'liase': ['liase'],
  'ocassion': ['ocassion'],
  'ocasion': ['ocasion'],
  'occassion': ['occassion'],
  'recieveing': ['recieveing'],
  'recieveed': ['recieveed'],
  'occurd': ['occurd'],
  'untill': ['untill'],
  'wich': ['wich'],
  'alot': ['alot'],
  'kinda': ['kinda'],
  'sorta': ['sorta'],
  'cant': ['cant'],
  'dont': ['dont'],
  'wont': ['wont'],
  'wouldnt': ['wouldnt'],
  'couldnt': ['couldnt'],
  'shouldnt': ['shouldnt'],
  'wasnt': ['wasnt'],
  'werent': ['werent'],
  'isnt': ['isnt'],
  'im': ['im'],
  'ive': ['ive'],
  'ill': ['ill'],
  'id': ['id'],
  'lets': ['lets'],
  'youre': ['youre'],
  'theyre': ['theyre'],
  'its': ['its'],
  'doesnt': ['doesnt'],
  'didnt': ['didnt'],
  'wouldntve': ['wouldntve'],
  'couldntve': ['couldntve'],
  'shouldntve': ['shouldntve'],
  'infront': ['infront'],
  'eachother': ['eachother'],
  'aswell': ['aswell'],
  'at least': ['atleast'],
  'by the way': ['bytheway'],
  'thankyou': ['thankyou'],
  'iloveyou': ['iloveyou'],
  'forsure': ['forsure'],
  'whatare': ['whatare'],
  'dontknow': ['dontknow']
};

AC.mergeDictionaries = function () {
  const flat = {};
  const phrases = {};
  const canonicalSet = new Set();

  const addMapping = (miss, canon) => {
    if (miss == null || canon == null) return;
    if (typeof canon !== 'string') canon = String(canon);
    if (typeof miss !== 'string') miss = String(miss);
    const missStr = canon == null || miss == null ? '' : miss;
    const canonStr = canon == null ? '' : canon;
    if (!missStr) return;
    flat[missStr.toLowerCase()] = canonStr;
    if (missStr.includes(' ')) phrases[missStr.toLowerCase()] = canonStr;
  };

  const addCanonical = (canon) => {
    if (canon == null) return;
    if (typeof canon !== 'string') canon = String(canon);
    const canonStr = canon == null ? '' : canon;
    if (!canonStr) return;
    canonicalSet.add(canonStr);
    flat[canonStr.toLowerCase()] = canonStr;
    if (canonStr.includes(' ')) phrases[canonStr.toLowerCase()] = canonStr;
  };

  Object.entries(AC.baseDict).forEach(([canon, list]) => {
    addCanonical(canon);
    (list || []).forEach(m => addMapping(m, canon));
  });

  (AC.state.customList || []).forEach(canon => {
    if (typeof canon === "string" && canon.trim()) {
      addCanonical(canon.trim());
    }
  });
  Object.entries(AC.state.customMap || {}).forEach(([miss, canon]) => {
    if (
      typeof miss === "string" &&
      typeof canon === "string" &&
      miss.trim() &&
      canon.trim()
    ) {
      addCanonical(canon.trim());
      addMapping(miss.trim(), canon.trim());
    }
  });

  Object.entries(AC.state.customWordsNew).forEach(([k, v]) => {
    addCanonical(v);
    addMapping(k, v);
  });
  Object.entries(AC.state.customPhrasesNew).forEach(([k, v]) => {
    addCanonical(v);
    addMapping(k, v);
  });

  AC.state.flatMap = flat;
  AC.state.multi = phrases;
  AC.state.canonicals = Array.from(canonicalSet).sort((a, b) => a.localeCompare(b));
  AC.state.mergedWords = flat;
  AC.state.mergedPhrases = phrases;

  if (Object.keys(AC.state.mergedWords).length === 0) {
    console.warn("Dictionary failed to load, reloading baseDict");
    AC.state.mergedWords = Object.fromEntries(
      Object.entries(AC.baseDict).map(([canon, arr]) => [canon.toLowerCase(), canon])
    );
  }

  if (Object.keys(AC.state.mergedPhrases).length === 0) {
    AC.state.mergedPhrases = {};
  }
};
AC.mergeDictionaries();

// ===================== Time normalisation functions =====================
AC.toTwo = function (num) {
  return num.toString().padStart(2, '0');
};

AC.normalizeTime = function (word) {
  const lower = word.toLowerCase();
  const timeMatch = lower.match(/^(\d{1,2})(am|pm)$/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const suffix = timeMatch[2];
    if (suffix === 'pm' && h !== 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    return `${AC.toTwo(h)}:00`;
  }
  const colonMatch = lower.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = AC.toTwo(parseInt(colonMatch[1], 10));
    const m = AC.toTwo(parseInt(colonMatch[2], 10));
    if (parseInt(m, 10) >= 60 || parseInt(h, 10) >= 24) return null;
    return `${h}:${m}`;
  }
  return null;
};

AC.normalizeTimeLoose = function (word) {
  const compact = word.match(/^(\d{1,2})(am|pm)$/);
  if (compact) return AC.normalizeTime(word);
  const match = word.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    const h = AC.toTwo(parseInt(match[1], 10));
    const m = AC.toTwo(parseInt(match[2], 10));
    if (parseInt(m, 10) >= 60 || parseInt(h, 10) >= 24) return null;
    return `${h}:${m}`;
  }
  return AC.normalizeTime(word);
};

AC.state.logs = AC.state.logs.filter(e => !/\d/.test(e.word) || AC.normalizeTimeLoose(e.word));

// ===================== Word + phrase correction functions =====================
AC.applyCapitalization = function (original, replacement) {
  if (!replacement) return replacement;
  const capRuleMatch = (AC.state.capsRules || []).some(r => r.toLowerCase() === replacement.toLowerCase());
  if (capRuleMatch) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
};

AC.correctWord = function (word) {
  const time = AC.normalizeTimeLoose(word);
  if (time) return time;

  const words = AC.state.mergedWords;
  const phrases = AC.state.mergedPhrases;

  const lower = word.toLowerCase();
  const phraseKeys = Object.keys(phrases).map(k => k.toLowerCase()).sort((a, b) => b.length - a.length);
  for (const p of phraseKeys) {
    if (lower.includes(p)) return AC.applyCapitalization(word, phrases[p]);
  }

  let correction = null;
  if (phrases[lower]) correction = AC.applyCapitalization(word, phrases[lower]);
  if (!correction && words[lower]) correction = AC.applyCapitalization(word, words[lower]);
  if (!correction && lower === 'i') correction = 'I';
  if (correction === word) {
    const cap = AC.applyCapitalization(word, correction);
    if (cap !== word) correction = cap; else return null;
  }
  return correction;
};

// ===================== Caret handling functions =====================
AC.getSelectionRange = function (el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { start: el.selectionStart || 0, end: el.selectionEnd || 0 };
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0);
};

AC.setSelectionRange = function (el, range) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setSelectionRange(range, range);
    return;
  }
  const sel = window.getSelection();
  if (!sel || typeof range === 'number') return;
  sel.removeAllRanges();
  sel.addRange(range);
};

AC.replaceRange = function (el, start, end, text) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const value = el.value;
    el.value = value.slice(0, start) + text + value.slice(end);
    AC.setSelectionRange(el, start + text.length);
    return;
  }
  const range = AC.createRangeForContentEditable(el, start, end);
  if (!range) return;
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  const newRange = document.createRange();
  newRange.setStart(range.endContainer, range.endOffset);
  newRange.collapse(true);
  AC.setSelectionRange(el, newRange);
};

AC.createRangeForContentEditable = function (el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let current = walker.nextNode();
  let index = 0;
  let range = document.createRange();
  while (current) {
    const nextIndex = index + current.textContent.length;
    if (start >= index && start <= nextIndex) range.setStart(current, start - index);
    if (end >= index && end <= nextIndex) { range.setEnd(current, end - index); break; }
    index = nextIndex;
    current = walker.nextNode();
  }
  return range;
};

AC.getTextAndCursor = function (el) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { text: el.value, pos: el.selectionStart || 0 };
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { text: el.textContent || '', pos: 0 };
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.endContainer, range.endOffset);
  const pos = preRange.toString().length;
  return { text: el.textContent || '', pos };
};

// ===================== Logging engine =====================
AC.appendLog = function (word, snapshot) {
  const words = AC.state.mergedWords;
  const phrases = AC.state.mergedPhrases;
  const lower = word.toLowerCase();
  if (AC.normalizeTimeLoose(word)) return;
  if (/\d/.test(word) && !AC.normalizeTimeLoose(word)) return;
  if (phrases[word.toLowerCase()] || words[word.toLowerCase()]) return;

  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const duplicate = AC.state.logs.find(l => l.word === word && l.day === dayKey);
  if (duplicate) return;

  const entry = { word, snapshot, timestamp: now.toISOString(), day: dayKey };
  AC.state.logs.push(entry);
  if (AC.state.logs.length > 500) AC.state.logs.shift();
  AC.storage.write('logs', AC.state.logs);
};

// ===================== Autocorrect processing engine =====================
AC.process = function (el) {
  if (!AC.state.enabled) return;
  const { text, pos } = AC.getTextAndCursor(el);
  const before = text.slice(0, pos);
  const match = before.match(/(\S+)(\s*)$/);
  if (!match) return;
  const word = match[1];
  const start = match.index || 0;
  const end = start + word.length;
  const correction = AC.correctWord(word);
  console.debug("Word:", word, "Correction:", correction, "Dict size:", Object.keys(AC.state.mergedWords).length);
  if (!correction) {
    AC.appendLog(word, text.slice(Math.max(0, start - 20), Math.min(text.length, end + 20)));
    return;
  }
  if (correction === word) return;

  const tail = text.slice(end, pos);
  const trailingSpaces = match[2] || '';
  const newText = correction + trailingSpaces + (word.match(/\s*$/)?.[0] || '') + tail;
  AC.state.lastAction = { el, start, replacementLength: newText.length, original: text.slice(start, pos) };
  AC.replaceRange(el, start, pos, newText);
  AC.state.stats.corrections += 1;
  AC.state.stats.lastCorrection = new Date().toISOString();
  AC.storage.write('stats', AC.state.stats);
  AC.state.recent.push({ from: word, to: correction, at: AC.state.stats.lastCorrection });
  if (AC.state.recent.length > 50) AC.state.recent.shift();
};

AC.handleKey = function (event) {
  const triggers = [' ', '.', ',', '?', '!', 'Enter'];
  const el = event.target;
  if (!triggers.includes(event.key)) return;
  setTimeout(() => { AC.process(el); }, 0);
};

AC.undoLastCorrection = function () {
  const action = AC.state.lastAction;
  if (!action || !action.el) return;
  AC.replaceRange(action.el, action.start, action.start + action.replacementLength, action.original);
  AC.state.lastAction = null;
};

// ===================== Editor binding functions =====================
AC.isEditable = function (el) {
  if (!(el instanceof Element)) return false;
  if (el.dataset && el.dataset.acAttached) return false;
  if (el.matches('textarea, input[type=\'text\'], input[type=\'search\'], [contenteditable], .ql-editor, div[role=\'textbox\']')) return true;
  return false;
};

AC.bindEditor = function (el) {
  if (AC.state.editors.has(el)) return;
  if (AC.state.keyListeners.has(el)) return;
  el.dataset.acAttached = '1';
  const listener = AC.handleKey.bind(AC);
  el.addEventListener('keydown', listener);
  AC.state.editors.add(el);
  AC.state.keyListeners.set(el, listener);
};

AC.scanExisting = function () {
  const selectors = '.ql-editor, div[role=\'textbox\'], [contenteditable], textarea, input[type=\'text\'], input[type=\'search\']';
  document.querySelectorAll(selectors).forEach(el => { if (!AC.state.editors.has(el)) AC.bindEditor(el); });
};

// ===================== Mutation observer =====================
AC.startObserver = function () {
  if (AC.state.observer) return;
  AC.state.observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (AC.isEditable(node)) AC.bindEditor(node);
        node.querySelectorAll && node.querySelectorAll('.ql-editor, div[role=\'textbox\'], [contenteditable], textarea, input[type=\'text\'], input[type=\'search\']').forEach(el => { if (AC.isEditable(el)) AC.bindEditor(el); });
      });
    });
  });
  AC.state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
};

// ===================== UI sidebar + mapping panel =====================
AC.buildUI = function () {
  if (AC.state.ui.root) return;
  const style = document.createElement('style');
  style.textContent = `
    .ac-ui *, .ac-ui *::before, .ac-ui *::after { box-sizing: border-box; }
    .ac-sidebar-old { position: fixed; top: 0; left: 0; width: 280px; height: 100vh; background: #1e1d49; color: #fff; z-index: 99999; transform: translateX(-100%); transition: transform 0.25s ease, opacity 0.25s ease; opacity: 0; display: flex; flex-direction: column; font-family: Arial, sans-serif; box-shadow: 4px 0 10px rgba(0,0,0,0.4); }
    .ac-sidebar-old.ac-open { transform: translateX(0); opacity: 1; }
    .ac-header-old { padding: 12px 14px; background: #483a73; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    .ac-tabs-old { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 4px; border-bottom: 1px solid #bdbde3; }
    .ac-tab-old { background: #34416a; color: #fff; padding: 6px 10px; border: 1px solid #bdbde3; border-radius: 3px; cursor: pointer; font-size: 12px; transition: background 0.2s; }
    .ac-tab-old.ac-active { background: #f9772e; border-color: #f9772e; color: #1e1d49; }
    .ac-undo { margin: 0 12px 8px; padding: 6px 10px; background: #34416a; color: #fff; border: 1px solid #bdbde3; border-radius: 3px; cursor: pointer; }
    .ac-content-old { flex: 1; overflow: auto; padding: 10px 12px; }
    .ac-floating-old { position: fixed; bottom: 24px; left: 24px; width: 24px; height: 24px; aspect-ratio: 1 / 1; background: #f9772e; color: #1e1d49; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 6px 12px rgba(0,0,0,0.35); z-index: 100000; font-weight: bold; }
    .ac-list-old { list-style: none; padding: 0; margin: 0; }
    .ac-list-old li { padding: 6px 0; border-bottom: 1px solid #bdbde3; font-size: 12px; }
    .ac-input-old { width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid #bdbde3; background: #34416a; color: #fff; margin-bottom: 8px; }
    .ac-button-old { background: #34416a; color: #fff; border: 1px solid #bdbde3; padding: 6px 10px; border-radius: 4px; cursor: pointer; }
    .ac-row-old { display: flex; gap: 6px; margin-bottom: 8px; }
    .ac-mapping-panel { position: fixed; top: 0; right: 0; width: 320px; height: 100vh; background: #1e1d49; color: #fff; z-index: 99998; transform: translateX(100%); transition: transform 0.25s ease, opacity 0.25s ease; opacity: 0; padding: 12px; box-shadow: -4px 0 10px rgba(0,0,0,0.4); font-family: Arial, sans-serif; }
    .ac-mapping-panel.ac-open { transform: translateX(0); opacity: 1; }
    .ac-scrollbar-old::-webkit-scrollbar { width: 8px; }
    .ac-scrollbar-old::-webkit-scrollbar-thumb { background: #34416a; border-radius: 4px; }
    .ac-scrollbar-old::-webkit-scrollbar-track { background: #1e1d49; }
    .ac-dict-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    .ac-dict-item { background: #34416a; border: 1px solid #bdbde3; border-radius: 4px; padding: 6px; font-size: 12px; }
    .ac-dict-icons { margin-bottom: 4px; font-size: 12px; }
    .ac-dict-word { font-weight: bold; }
    .ac-dict-actions { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
    .ac-note { font-size: 11px; opacity: 0.8; margin-top: 6px; }
  `;
  document.head.appendChild(style);

  const sidebar = document.createElement('div');
  sidebar.className = 'ac-sidebar-old ac-ui ac-scrollbar-old';

  const header = document.createElement('div');
  header.className = 'ac-header-old';
  const title = document.createElement('div');
  title.textContent = 'Auto-Correct';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.className = 'ac-button-old';
  closeBtn.style.padding = '4px 8px';
  closeBtn.addEventListener('click', () => AC.toggleUI(false));
  header.appendChild(title);
  header.appendChild(closeBtn);

  const tabBar = document.createElement('div');
  tabBar.className = 'ac-tabs-old';
  const tabs = ['log', 'recent', 'stats', 'export', 'dictionary', 'settings'];
  tabs.forEach(id => {
    const btn = document.createElement('button');
    btn.className = 'ac-tab-old';
    btn.dataset.tab = id;
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.addEventListener('click', () => AC.switchTab(id));
    tabBar.appendChild(btn);
  });

  const undoBtn = document.createElement('button');
  undoBtn.className = 'ac-undo';
  undoBtn.textContent = 'Undo last correction';
  undoBtn.addEventListener('click', () => AC.undoLastCorrection());

  const content = document.createElement('div');
  content.className = 'ac-content-old ac-scrollbar-old';

  sidebar.appendChild(header);
  sidebar.appendChild(tabBar);
  sidebar.appendChild(undoBtn);
  sidebar.appendChild(content);

  const floating = document.createElement('div');
  floating.className = 'ac-floating-old';
  floating.textContent = 'AC';
  floating.addEventListener('click', () => AC.toggleUI());

  const mappingPanel = document.createElement('div');
  mappingPanel.className = 'ac-mapping-panel ac-scrollbar-old';

  document.body.appendChild(sidebar);
  document.body.appendChild(mappingPanel);
  document.body.appendChild(floating);

  AC.state.ui.root = sidebar;
  AC.state.ui.mapping = mappingPanel;
  AC.state.ui.content = content;
  AC.state.ui.tabs = tabBar.querySelectorAll('.ac-tab-old');

  AC.renderCurrentTab();
  AC.renderMappingPanel();

  document.addEventListener('keydown', e => {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      AC.toggleUI();
    }
  });
};

AC.toggleUI = function (force) {
  const next = typeof force === 'boolean' ? force : !AC.state.ui.open;
  AC.state.ui.open = next;
  if (!AC.state.ui.root) return;
  AC.state.ui.root.classList.toggle('ac-open', next);
};

AC.switchTab = function (id) {
  AC.state.ui.tab = id;
  AC.renderCurrentTab();
};

AC.renderCurrentTab = function () {
  if (!AC.state.ui.root) return;
  AC.state.ui.tabs.forEach(tab => tab.classList.toggle('ac-active', tab.dataset.tab === AC.state.ui.tab));
  AC.state.ui.content.textContent = '';
  const tab = AC.state.ui.tab;
  if (tab === 'log') AC.renderLog();
  if (tab === 'recent') AC.renderRecent();
  if (tab === 'stats') AC.renderStats();
  if (tab === 'export') AC.renderExport();
  if (tab === 'dictionary') AC.renderDictionary();
  if (tab === 'settings') AC.renderSettings();
};

AC.renderLog = function () {
  const sec = AC.state.ui.content;
  const list = document.createElement('ul');
  list.className = 'ac-list-old';
  AC.state.logs.slice().reverse().forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.word} — ${new Date(entry.timestamp).toLocaleString('en-GB', { hour12: false })}`;
    list.appendChild(li);
  });
  sec.appendChild(list);
};

AC.renderRecent = function () {
  const sec = AC.state.ui.content;
  const list = document.createElement('ul');
  list.className = 'ac-list-old';
  AC.state.recent.slice().reverse().forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.from} → ${entry.to} — ${new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })}`;
    list.appendChild(li);
  });
  if (!list.childElementCount) {
    const empty = document.createElement('div');
    empty.textContent = 'No recent corrections yet.';
    sec.appendChild(empty);
  }
  sec.appendChild(list);
};

AC.renderStats = function () {
  const sec = AC.state.ui.content;
  const p = document.createElement('div');
  p.textContent = `Corrections: ${AC.state.stats.corrections}`;
  const last = document.createElement('div');
  last.textContent = `Last: ${AC.state.stats.lastCorrection ? new Date(AC.state.stats.lastCorrection).toLocaleString('en-GB', { hour12: false }) : 'N/A'}`;
  sec.appendChild(p);
  sec.appendChild(last);
};

AC.renderDictionary = function () {
  const sec = AC.state.ui.content;

  const addWordRow = document.createElement('div');
  addWordRow.className = 'ac-row-old';
  const newCanon = document.createElement('input');
  newCanon.className = 'ac-input-old';
  newCanon.placeholder = 'Add canonical word/phrase';
  const starToggle = document.createElement('input');
  starToggle.type = 'checkbox';
  const starLabel = document.createElement('label');
  starLabel.style.display = 'flex';
  starLabel.style.alignItems = 'center';
  starLabel.style.gap = '4px';
  starLabel.appendChild(starToggle);
  starLabel.appendChild(document.createTextNode('Always capitalise'));
  const addCanonBtn = document.createElement('button');
  addCanonBtn.className = 'ac-button-old';
  addCanonBtn.textContent = 'Add';
  addCanonBtn.addEventListener('click', () => {
    if (!newCanon.value.trim()) return;
    const canon = newCanon.value.trim();
    AC.state.customList.push(canon);
    if (starToggle.checked && !AC.state.capsRules.includes(canon)) AC.state.capsRules.push(canon);
    AC.state.customWordsNew[canon.toLowerCase()] = canon;
    AC.storage.writeRaw('ac_custom_dict_v2', AC.state.customList);
    AC.storage.writeRaw('ac_caps_rules_v2', AC.state.capsRules);
    AC.storage.write('customWords', AC.state.customWordsNew);
    AC.mergeDictionaries();
    AC.renderCurrentTab();
  });
  addWordRow.appendChild(newCanon);
  addWordRow.appendChild(starLabel);
  addWordRow.appendChild(addCanonBtn);

  const addMapRow = document.createElement('div');
  addMapRow.className = 'ac-row-old';
  const miss = document.createElement('input');
  miss.className = 'ac-input-old';
  miss.placeholder = 'Misspelling';
  const canon = document.createElement('input');
  canon.className = 'ac-input-old';
  canon.placeholder = 'Canonical target';
  const addMapBtn = document.createElement('button');
  addMapBtn.className = 'ac-button-old';
  addMapBtn.textContent = 'Map';
  addMapBtn.addEventListener('click', () => {
    if (!miss.value.trim() || !canon.value.trim()) return;
    AC.state.customMap[miss.value.trim().toLowerCase()] = canon.value.trim();
    AC.state.customWordsNew[canon.value.trim().toLowerCase()] = canon.value.trim();
    AC.state.customWordsNew[miss.value.trim().toLowerCase()] = canon.value.trim();
    AC.storage.writeRaw('ac_custom_map_v2', AC.state.customMap);
    if (!AC.state.customList.includes(canon.value.trim())) {
      AC.state.customList.push(canon.value.trim());
      AC.storage.writeRaw('ac_custom_dict_v2', AC.state.customList);
    }
    AC.storage.write('customWords', AC.state.customWordsNew);
    AC.mergeDictionaries();
    miss.value = '';
    canon.value = '';
    AC.renderCurrentTab();
  });
  addMapRow.appendChild(miss);
  addMapRow.appendChild(canon);
  addMapRow.appendChild(addMapBtn);

  const mapBtn = document.createElement('button');
  mapBtn.className = 'ac-button-old';
  mapBtn.textContent = 'Open mapping panel';
  mapBtn.addEventListener('click', () => AC.toggleMapping(true));

  const dictGrid = document.createElement('div');
  dictGrid.className = 'ac-dict-grid';

  const wordToMappings = {};
  Object.entries(AC.state.flatMap).forEach(([k, v]) => {
    const canonLower = String(v).toLowerCase();
    wordToMappings[canonLower] = wordToMappings[canonLower] || [];
    const vLower = String(v).toLowerCase();
    if (k !== vLower) wordToMappings[canonLower].push(k);
  });

  AC.state.canonicals.forEach(canonWord => {
    const item = document.createElement('div');
    item.className = 'ac-dict-item';
    const icons = document.createElement('div');
    icons.className = 'ac-dict-icons';
    const lower = canonWord.toLowerCase();
    if ((AC.state.capsRules || []).some(r => r.toLowerCase() === lower)) icons.textContent += '⭐ ';
    if ((wordToMappings[lower] || []).length) icons.textContent += '⚙️ ';
    if (!AC.baseDict[canonWord]) icons.textContent += '⬜ ';
    const wordEl = document.createElement('div');
    wordEl.className = 'ac-dict-word';
    wordEl.textContent = canonWord;
    const missList = document.createElement('div');
    missList.style.fontSize = '11px';
    missList.textContent = (wordToMappings[lower] || []).sort().join(', ');
    const actions = document.createElement('div');
    actions.className = 'ac-dict-actions';
    if (!AC.baseDict[canonWord]) {
      const remove = document.createElement('button');
      remove.className = 'ac-button-old';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        AC.state.customList = AC.state.customList.filter(c => c !== canonWord);
        Object.keys(AC.state.customMap).forEach(m => { if (AC.state.customMap[m] === canonWord) delete AC.state.customMap[m]; });
        AC.storage.writeRaw('ac_custom_dict_v2', AC.state.customList);
        AC.storage.writeRaw('ac_custom_map_v2', AC.state.customMap);
        AC.mergeDictionaries();
        AC.renderCurrentTab();
      });
      actions.appendChild(remove);
    }
    const mapLink = document.createElement('button');
    mapLink.className = 'ac-button-old';
    mapLink.textContent = 'Map misspelling';
    mapLink.addEventListener('click', () => {
      AC.toggleMapping(true, canonWord);
    });
    actions.appendChild(mapLink);

    item.appendChild(icons);
    item.appendChild(wordEl);
    if (missList.textContent) item.appendChild(missList);
    item.appendChild(actions);
    dictGrid.appendChild(item);
  });

  sec.appendChild(addWordRow);
  sec.appendChild(addMapRow);
  sec.appendChild(mapBtn);
  sec.appendChild(dictGrid);
  const note = document.createElement('div');
  note.className = 'ac-note';
  note.textContent = '⭐ always capitalise · ⚙️ has mappings · ⬜ custom only';
  sec.appendChild(note);
};

AC.renderExport = function () {
  const sec = AC.state.ui.content;
  const data = { customMap: AC.state.customMap, customList: AC.state.customList, capsRules: AC.state.capsRules, logs: AC.state.logs, stats: AC.state.stats };
  const textarea = document.createElement('textarea');
  textarea.className = 'ac-input-old ac-scrollbar-old';
  textarea.style.height = '200px';
  textarea.textContent = JSON.stringify(data, null, 2);
  sec.appendChild(textarea);
};

AC.renderSettings = function () {
  const sec = AC.state.ui.content;
  const toggle = document.createElement('button');
  toggle.className = 'ac-button-old';
  toggle.textContent = AC.state.enabled ? 'Disable autocorrect' : 'Enable autocorrect';
  toggle.addEventListener('click', () => {
    AC.state.enabled = !AC.state.enabled;
    AC.storage.write('enabled', AC.state.enabled);
    AC.renderCurrentTab();
  });
  sec.appendChild(toggle);
};

AC.renderMappingPanel = function (prefill) {
  if (!AC.state.ui.mapping) return;
  const panel = AC.state.ui.mapping;
  panel.textContent = '';
  const title = document.createElement('div');
  title.style.marginBottom = '8px';
  title.textContent = 'Mapping panel';

  const search = document.createElement('input');
  search.className = 'ac-input-old';
  search.placeholder = 'Search canonical word';
  const results = document.createElement('div');
  results.className = 'ac-scrollbar-old';
  results.style.maxHeight = '180px';
  results.style.overflow = 'auto';

  const missInput = document.createElement('input');
  missInput.className = 'ac-input-old';
  missInput.placeholder = 'Misspelling';
  const canonInput = document.createElement('input');
  canonInput.className = 'ac-input-old';
  canonInput.placeholder = 'Canonical';
  if (prefill) canonInput.value = prefill;

  const renderResults = () => {
    results.textContent = '';
    const term = search.value.toLowerCase();
    const items = AC.state.canonicals.filter(c => c.toLowerCase().includes(term)).slice(0, 200);
    items.forEach(c => {
      const div = document.createElement('div');
      div.textContent = c;
      div.style.cursor = 'pointer';
      div.addEventListener('click', () => { canonInput.value = c; });
      results.appendChild(div);
    });
  };
  search.addEventListener('input', renderResults);
  renderResults();

  const assignBtn = document.createElement('button');
  assignBtn.className = 'ac-button-old';
  assignBtn.textContent = 'Assign';
  assignBtn.addEventListener('click', () => {
    if (!missInput.value.trim() || !canonInput.value.trim()) return;
    AC.state.customMap[missInput.value.trim().toLowerCase()] = canonInput.value.trim();
    if (!AC.state.customList.includes(canonInput.value.trim())) AC.state.customList.push(canonInput.value.trim());
    AC.state.customWordsNew[canonInput.value.trim().toLowerCase()] = canonInput.value.trim();
    AC.state.customWordsNew[missInput.value.trim().toLowerCase()] = canonInput.value.trim();
    AC.storage.writeRaw('ac_custom_map_v2', AC.state.customMap);
    AC.storage.writeRaw('ac_custom_dict_v2', AC.state.customList);
    AC.storage.write('customWords', AC.state.customWordsNew);
    AC.mergeDictionaries();
    AC.renderCurrentTab();
    renderResults();
    missInput.value = '';
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ac-button-old';
  closeBtn.textContent = 'Cancel';
  closeBtn.addEventListener('click', () => AC.toggleMapping(false));

  panel.appendChild(title);
  panel.appendChild(search);
  panel.appendChild(results);
  panel.appendChild(missInput);
  panel.appendChild(canonInput);
  panel.appendChild(assignBtn);
  panel.appendChild(closeBtn);
};

AC.toggleMapping = function (force, prefill) {
  if (!AC.state.ui.mapping) return;
  const panel = AC.state.ui.mapping;
  const next = typeof force === 'boolean' ? force : !panel.classList.contains('ac-open');
  panel.classList.toggle('ac-open', next);
  if (next) AC.renderMappingPanel(prefill);
};

// ===================== AC.init =====================
AC.init = function () {
  AC.mergeDictionaries();
  AC.scanExisting();
  AC.startObserver();
  AC.buildUI();
};

AC.init();
