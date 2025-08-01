/* This file contains the raw subtitles for the test data.
 * It is used to test the subtitle importer. There are some 
 * specific idiosyncrasies we're trying to make sure we handle
 * here. For instance, sometimes there is a single dash in the 
 * arrow for the subtitles in English. This came directly from 
 * the file provided by the user. In addition, the tigrinia 
 * subtitles below start well before the English subtitles 
 * start because there is forced narrative on screen that 
 * doesn't get subtitled in English, but it does get subtitled 
 * in translations. So we need to be able to handle peratextual 
 * cells like this that have no corresponding source cell. 
 * Furthermore, the cells don't overlap one to one. What we 
 * need to do in our algorithm is find the best time overlap 
 * that represents the best fit between the two sets of subtitles. 
 * Currently the algorithm works by trying to maximize the amount 
 * of time overlap in any given set of subtitles that are being 
 * aligned. But there is often a one to many alignment between 
 * subtitles across languages. So we also need to account for 
 * child cells where two cells in the target match up with one 
 * cell in the source, etc.
 */

export const englishSubtitlesRaw = `
    WEBVTT
    
    1
    00:00:50.634 --> 00:00:51.468
    <i>Abba?</i>
    
    2
    00:00:54.012 --> 00:00:56.348
    -You should be sleeping, little one.
    -I can't sleep.
    
    3
    00:00:56.431 --> 00:00:58.308
    Sit down, sit down.
    
    4
    00:00:59.601 --> 00:01:02.437
    -Is your head hurting you again?
    -No.
    
    5
    00:01:02.521 --> 00:01:06.233
    I know. You were thinking
    of the big new star.
    
    6
    00:01:06.316 --> 00:01:08.026
    Hey, look, it's right there, see?
    
    7
    00:01:09.820 --> 00:01:10.904
    No.
    "I don't see it."
    
    8
    00:01:11.572 --> 00:01:14.533
    -Why can't you sleep?
    -I'm scared.
    
    00:01:06.024 –> 00:01:07.651
    "I see it over there. Do you see it?"
    
    00:01:09.278 –> 00:01:10.571
    
    00:01:11.238 –> 00:01:12.698
    "What is that noise you hear?"
    
    9
    00:01:15.742 --> 00:01:18.537
    -Of what?
    -I don't know.
    
    10
    00:01:19.204 --> 00:01:22.708
    Hey, what do we do when we are scared?
    `;

export const tigrinyaSubtitlesRaw = `
    WEBVTT
    
    00:00:08.884 --> 00:00:11.345
    እቶም ሕሩያት ኣብ ሓቀኛ ታሪኽ ወንጌላት | The Chosen is based on the true stories of the gospels
    ጎይታናን መድሓኒናን እየሱስ ክርስቶስ | of our Lord and Savior Jesus Christ
    
    00:00:11.428 --> 00:00:12.638
    ዝተሞርኮሰት ፊልም እያ። | This is a film.
    
    00:00:12.721 --> 00:00:14.932
    ገለ ቦታታትን ናይ ግዜ መስመራትን | Some locations and timelines
    ተዋሃሂዶም ወይ ሓጺሮም ኣለዉ። | have been condensed or shortened.
    
    00:00:15.015 --> 00:00:17.142
    ድሕረ-ዛንታታትን ገለ ገጸ ባህርያት | Backstories and some characters
    ወይ ዝርርብን ተወሰኹ እዩ። | or dialogue have been added.
    
    00:00:17.226 --> 00:00:18.727
    ይኹን እምበር | However
    ኩሉ መጽሓፍ ቅዱሳውን ታሪኻውን ኵነታትን | all biblical and historical context
    
    00:00:18.810 --> 00:00:20.312
    ዝኾነ ስነ ጥበባዊ | Any artistic
    ምናኔን ንሓቅን ዕላማን | license is designed to support the truth and intention
    
    00:00:20.395 --> 00:00:22.189
    ቅዱሳት መጻሕፍቲ | of the Holy Scriptures
    ንምድጋፍ ዝተዳለወ እዩ። | is what this is designed for.
    
    00:00:22.272 --> 00:00:23.732
    ተመልከቲ ወንጌላት ከንብቡ ይተባብዑ። | Viewers are encouraged to read the Gospels.
    
    00:00:23.815 --> 00:00:26.318
    እቶም መበቆላውያን ኣስማት፣ | The original names,
    ቦታታትን ሓረጋትን | places and phrases
    
    00:00:26.401 --> 00:00:27.569
    ናብ ትግርኛ ተተርጒሞም ኣለዉ። | have been translated to Tigrinya.
    
    00:00:37.579 --> 00:00:43.085
    መግደላ 2 ቅ.ል.ክ. | Magdala 2 AD
    
    00:00:50.259 --> 00:00:51.260
    ኣቦይ? | Father?
    
    00:00:53.512 --> 00:00:54.805
    ኣይደቀስክን ዲኺ ማርያም ጓለይ | Aren't you sleeping, Mary my daughter?
    
    00:00:54.888 --> 00:00:55.889
    ድቃስ ኣቢኒ። | I can't sleep.
    
    00:00:55.973 --> 00:00:57.182
    ኮፍ በሊ። | Sit down.
    
    00:00:57.266 --> 00:00:58.267
    ኮፍ በሊ። | Sit down.
    
    00:00:59.059 --> 00:01:00.394
    ርእስኺ ኣይገደፈክን ድዩ? | Is your head still hurting?
    
    00:01:00.894 --> 00:01:01.895
    ድሓን እየ። | I'm fine.
    
    00:01:02.563 --> 00:01:03.564
    እፈልጥ እየ። | I know.
    
    00:01:03.647 --> 00:01:05.941
    ሕጂ ቆብ ኣቢለኪ ብዛዕባ እታ | Now I know you're thinking about
    ዓባይ ኮኾብ ኢኺ ትሓስቢ ዘለኺ። | the big star.
    
    00:01:06.024 --> 00:01:07.651
    ራኣይ ኣብቲ ኣላ። ሪኢኽያ? | Look, it's right there. Do you see it?
    
    00:01:09.278 --> 00:01:10.571
    ኣይራኣኽዋን። | I don't see it.
    
    00:01:11.238 --> 00:01:12.698
    እንታይ ኮይኑ እዩ ድቃስ ኣቢኪ? | Why can't you sleep?
    
    00:01:12.781 --> 00:01:13.991
    ፈሪሐ | I'm scared.
    
    00:01:15.409 --> 00:01:16.451
    ብምንታይ? | Of what?
    
    00:01:16.535 --> 00:01:17.911
    እንድዒ (ኣይተረዳኣንን)። | I don't know.
    
    00:01:18.745 --> 00:01:22.207
    እንተዳኣ ፈርሕና እሞ | When we are scared,
    እንታይ ዲና ንገብር? | what do we do?
    `;

// Expected mapping from English cue IDs to Tigrinya cue IDs based on timestamp overlap
// This represents the ACTUAL computed output from our alignment algorithm (source of truth)
export const sourceOfTruthMapping: Record<string, string[]> = {
    "E1": ["T1"],
    "E2": ["T2", "T3"],
    "E3": ["T4", "T5"],
    "E4": ["T6", "T7"],
    "E5": ["T8", "T9"],
    "E6": ["T10"],
    "E7": ["T11"],
    "E8": ["T12", "T13"],
    "E9": ["T14", "T15"],
    "E10": ["T16"]
}; 