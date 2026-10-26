// Moderation word lists. Pure data, meant to be edited.
//
// HOW MATCHING WORKS (see moderation.ts)
//   Text is split into tokens on whitespace. Each token is folded: NFKC,
//   lower-case, "ё" -> "е", Armenian "և"/"եւ" -> "եվ", digits/symbols used as
//   letters in mixed tokens (f4ck, $uka) -> letters, everything that is not a
//   letter removed ("f.u.c.k" -> "fuck"), mixed Latin/Cyrillic look-alikes
//   mapped to Cyrillic ("cукa" -> "сука"). Repeated letters are also tried
//   squeezed ("fuuuuck" -> "fuck"). List entries are folded the same way, so
//   write them in their normal spelling.
//
//   exact    the whole token must equal the entry
//   prefix   the token must start with the entry (covers endings/inflections)
//   contains the entry may appear anywhere inside one token — only for roots
//            that never occur inside ordinary words
//
// Keep entries for STRONG profanity and slurs only: mild words ("shit",
// "damn", "черт") are allowed — people are burning their bad year.
// Before adding a prefix/contains entry, check it is not the start/part of a
// normal word in any of the three languages (e.g. Russian "хлебать" contains
// "ебат", Armenian "քուն" means sleep, "բոզբաշ" is a soup).

export interface WordList {
  exact: string[];
  prefix: string[];
  contains: string[];
}

export const BLOCKLIST: Record<string, WordList> = {
  // Armenian, Armenian script
  hy: {
    exact: ["բոզ", "բոզի", "բոզը", "բոզեր", "բոզերի", "գյոտ", "գյոթ"],
    prefix: [
      "քունեմ", "քունել", "քունվա", "քունած",
      "պոռնիկ", "սիկտիր", "փեսեվենկ", "փեզեվենկ", "ջհուդ",
      "պիդոր", "պիդար", "պիզդ",
    ],
    contains: [],
  },
  // Armenian in Latin transliteration (incl. "q" for ք)
  hy_latn: {
    exact: ["boz", "bozi", "bozy", "bozer", "gyot", "gyoty"],
    prefix: [
      "kunem", "qunem", "kunel", "qunel", "kunvac", "qunvac", "kunvats", "qunvats",
      "pornik", "siktir", "pesevenk", "pezevenk", "jhud",
    ],
    contains: [],
  },
  // Armenian in Cyrillic transliteration
  hy_cyrl: {
    exact: ["боз", "бози"],
    prefix: ["кунем", "кунел", "сиктир", "песевенк", "пезевенк"],
    contains: [],
  },
  // Russian (Cyrillic)
  ru: {
    exact: [
      "бля", "блять", "блядь", "бляди", "блядина", "блядство", "блядский", "блядская",
      "сука", "суки", "суку", "сукой", "суке", "сучка", "сучки", "сучара", "сукин",
      "манда", "еб", "ебло", "пидр", "педик", "педики", "педиков",
      "жид", "жиды", "жидов", "жидовка", "жидяра",
      "хач", "хачи", "хачей", "хачик", "хачики", "хачье",
      "чурка", "чурки", "чурок",
    ],
    prefix: [
      "хуй", "хуе", "хуя", "хую", "хуев", "хуит", "хуил",
      "нахуй", "нахуя", "похуй", "похуис", "охуе", "охуи", "нихуя", "захуя",
      "еба", "ебл", "ебу", "ебн", "ебан",
      "заеб", "наеб", "уеб", "выеб", "отъеб", "доеб", "съеб", "проеб", "поеб", "разъеб", "объеб", "въеб",
      "мудак", "мудил", "мудоз", "мудач",
      "пидор", "пидар", "пидрил",
      "шлюх", "гандон", "залуп", "дроч", "жидов",
    ],
    contains: ["пизд", "хуйн", "хуйл", "долбоеб", "ебанут", "уебок", "уебищ"],
  },
  // Russian in Latin transliteration
  ru_latn: {
    exact: [
      "suka", "blyat", "blyad", "blya", "huy", "khuy", "xuy", "huyna",
      "nahuy", "nahui", "nakhuy", "pohuy", "mudak", "eban", "ebat", "yebat", "yoban", "ebal", "zhid",
    ],
    prefix: ["pizd", "pidor", "pidar", "pidaras", "mudila", "yeban", "yobany", "eblan", "zaeb"],
    contains: [],
  },
  // English
  en: {
    exact: [
      "fag", "fags", "kike", "kikes", "spic", "spics", "chink", "chinks", "dyke", "dykes",
      "tranny", "trannies", "paki", "pakis", "twat", "twats", "retard", "retards", "retarded", "fuk", "fuks",
    ],
    prefix: ["fck", "fukin", "cunt", "whore", "slut", "bitch", "faggot", "wanker", "cocksuck", "wetback"],
    contains: ["fuck", "nigger", "nigga"],
  },
};

// Very common Armenian first names. Each line is one name in all the forms we
// want to catch: Armenian script, Latin transliterations, Cyrillic.
// Case endings are added automatically (moderation.ts: NAME_SUFFIXES), so
// write only the base form.
//
// Deliberately NOT listed because they are ordinary words: Արև/Arev (sun),
// Հույս (hope), Անուշ/Anush (sweet), Աստղիկ (little star), Գոհար (gem),
// Վրեժ (revenge), Ara/Ара (common interjection), Gor/Гор (Russian гора/горе),
// Грант (Russian "grant"), Marine (English word), Eva, Margarita.
export const COMMON_NAMES: string[][] = [
  // male
  ["Արամ", "Aram", "Арам"],
  ["Արմեն", "Armen", "Армен"],
  ["Արման", "Arman", "Арман"],
  ["Արսեն", "Arsen", "Арсен"],
  ["Արթուր", "Artur", "Arthur", "Артур"],
  ["Արտակ", "Artak", "Артак"],
  ["Աշոտ", "Ashot", "Ашот"],
  ["Արշակ", "Arshak", "Аршак"],
  ["Դավիթ", "Davit", "David", "Давид", "Давит"],
  ["Գևորգ", "Gevorg", "Gevork", "Геворг", "Геворк"],
  ["Գրիգոր", "Grigor", "Григор"],
  ["Հայկ", "Hayk", "Haik", "Айк", "Гайк"],
  ["Հակոբ", "Hakob", "Hakop", "Akop", "Акоп", "Акоб"],
  ["Հովհաննես", "Hovhannes", "Hovannes", "Ovanes", "Ованес", "Оганес", "Ованнес"],
  ["Հրանտ", "Hrant"],
  ["Կարեն", "Karen", "Карен"],
  ["Լևոն", "Levon", "Левон"],
  ["Մհեր", "Mher", "Мгер"],
  ["Նարեկ", "Narek", "Нарек"],
  ["Սամվել", "Samvel", "Самвел"],
  ["Սարգիս", "Sargis", "Sarkis", "Саргис", "Саркис"],
  ["Սուրեն", "Suren", "Сурен"],
  ["Տիգրան", "Tigran", "Тигран"],
  ["Վահե", "Vahe", "Ваге", "Ваэ"],
  ["Վարդան", "Vardan", "Vartan", "Вардан", "Вартан"],
  ["Վազգեն", "Vazgen", "Вазген"],
  ["Էդգար", "Edgar", "Эдгар"],
  ["Գագիկ", "Gagik", "Гагик"],
  ["Համլետ", "Hamlet", "Гамлет"],
  ["Խաչատուր", "Khachatur", "Xachatur", "Хачатур"],
  ["Ռաֆայել", "Rafayel", "Rafael", "Рафаэль", "Рафаел"],
  ["Սևակ", "Sevak", "Севак"],
  ["Վահագն", "Vahagn", "Ваагн"],
  ["Նորայր", "Norayr", "Norair", "Норайр"],
  ["Սմբատ", "Smbat", "Смбат"],
  ["Մկրտիչ", "Mkrtich", "Мкртич"],
  ["Անդրանիկ", "Andranik", "Андраник"],
  ["Ալբերտ", "Albert", "Альберт"],
  ["Ռոբերտ", "Robert", "Роберт"],
  ["Միքայել", "Mikayel", "Mikael", "Микаел", "Микаэл"],
  ["Պետրոս", "Petros", "Петрос"],
  ["Զավեն", "Zaven", "Завен"],
  ["Էրիկ", "Erik", "Эрик"],
  ["Ռուբեն", "Ruben", "Рубен"],
  ["Հարություն", "Harutyun", "Arutyun", "Арутюн"],
  // female
  ["Աննա", "Anna", "Анна"],
  ["Անի", "Ani", "Ани"],
  ["Անահիտ", "Anahit", "Анаит"],
  ["Արփի", "Arpi", "Арпи"],
  ["Արմինե", "Armine", "Армине"],
  ["Գայանե", "Gayane", "Gayaneh", "Гаяне"],
  ["Հասմիկ", "Hasmik", "Asmik", "Асмик"],
  ["Կարինե", "Karine", "Карине"],
  ["Լիլիթ", "Lilit", "Лилит"],
  ["Լուսինե", "Lusine", "Лусине"],
  ["Մարիամ", "Mariam", "Мариам"],
  ["Մարինե", "Марине"],
  ["Մերի", "Meri", "Мери"],
  ["Նարե", "Nare", "Наре"],
  ["Նարինե", "Narine", "Нарине"],
  ["Նունե", "Nune", "Нуне"],
  ["Սաթենիկ", "Satenik", "Сатеник"],
  ["Սոնա", "Sona", "Сона"],
  ["Սիրանուշ", "Siranush", "Сирануш"],
  ["Սյուզաննա", "Syuzanna", "Suzanna", "Сюзанна"],
  ["Տաթևիկ", "Tatevik", "Татевик"],
  ["Թամարա", "Tamara", "Тамара"],
  ["Էլեն", "Elen", "Элен"],
  ["Քրիստինե", "Kristine", "Кристине"],
  ["Միլենա", "Milena", "Милена"],
  ["Ռուզաննա", "Ruzanna", "Рузанна"],
  ["Հռիփսիմե", "Hripsime", "Ripsime", "Рипсиме"],
  ["Շուշան", "Shushan", "Шушан"],
  ["Սեդա", "Seda", "Седа"],
  ["Մանե", "Mane", "Мане"],
  ["Լիանա", "Liana", "Лиана"],
  ["Դիանա", "Diana", "Диана"],
  ["Էլինա", "Elina", "Элина"],
  ["Զարուհի", "Zaruhi", "Заруи"],
  ["Հերմինե", "Hermine", "Эрмине"],
];

// Endings tried after a name, per script. Includes Armenian surname endings
// (-յան, -yan, -ян) because "Arami", "Արամին", "Арамян" are all personal.
export const NAME_SUFFIXES = {
  armn: ["ի", "ին", "ից", "ով", "ը", "ն", "ս", "դ", "ու", "ենց", "յի", "յին", "յից", "յով", "յան", "յանց", "յաններ"],
  latn: ["i", "in", "ic", "ich", "ov", "y", "s", "yi", "yin", "enc", "ents", "yan", "ian", "yants", "yanc"],
  cyrl: ["а", "у", "ом", "е", "ы", "ов", "ым", "ик", "ику", "ика", "чик", "ян", "янц", "ович", "овна", "овны"],
  // Russian names ending in -а/-я decline by replacing the last letter.
  // Kept short on purpose: -ой/-ин/-ина would turn Седа into "седой"/"седина".
  cyrlStemReplace: ["у", "ы", "е"],
};

// Top-level domains that make "word.tld" look like a link.
export const URL_TLDS: string[] = [
  "com", "net", "org", "am", "ru", "io", "me", "info", "biz", "xyz", "app", "dev", "site",
  "online", "store", "shop", "link", "ly", "co", "tv", "ua", "by", "kz", "ge", "us", "uk",
  "de", "fr", "eu", "su", "pro", "club", "top", "live", "gg", "to", "cc", "рф", "հայ",
];
