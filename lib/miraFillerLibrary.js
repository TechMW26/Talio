// 12 intent categories × 10 curated bilingual cores × 3 short openings =
// 720 distinct, on-demand phrases. No bulk synthesis or private query storage.
const groups = {
  camera: {
    match: /\b(camera|drawing|can you see|look at this|what is this)\b|कैमर|ड्राइंग|चित्र|दिख रहा|मुझे देख|ये क्या|यह क्या/iu,
    en: ['Let me take a look.', 'I’ll look at the details.', 'Let me get a clear view.', 'I’ll check the picture.', 'Let me look more closely.', 'I’ll check what’s visible.', 'Let me focus on that.', 'I’ll take a fresh look.', 'Let me see the whole picture.', 'I’ll look at what you’re showing.'],
    hi: ['ज़रा देखती हूँ।', 'इसकी बारीकियाँ देखती हूँ।', 'पहले साफ़ तस्वीर देख लूँ।', 'तस्वीर पर नज़र डालती हूँ।', 'ज़रा करीब से देखती हूँ।', 'जो दिख रहा है, उसे देखती हूँ।', 'इस पर ध्यान देती हूँ।', 'एक बार फिर देखती हूँ।', 'पूरी तस्वीर देख लूँ।', 'आप जो दिखा रहे हैं, उसे देखती हूँ।'],
  },
  music: {
    match: /music|song|playlist|spotify|गाना|गाने|संगीत|प्लेलिस्ट|gaana|gana chala/iu,
    en: ['Let me check the music.', 'I’ll look for that track.', 'Let me check the player.', 'I’ll look through the music options.', 'Let me check what’s available to play.', 'I’ll check the listening options.', 'Let me look at the music selection.', 'I’ll check the playback options.', 'Let me find the music controls.', 'I’ll take a look at the player.'],
    hi: ['संगीत देखती हूँ।', 'उस गाने को खोजती हूँ।', 'म्यूज़िक प्लेयर देखती हूँ।', 'संगीत के विकल्प देखती हूँ।', 'क्या चल सकता है, देखती हूँ।', 'सुनने के विकल्प देख लूँ।', 'गानों की सूची पर नज़र डालती हूँ।', 'प्लेबैक के विकल्प देखती हूँ।', 'म्यूज़िक के कंट्रोल देखती हूँ।', 'प्लेयर पर एक नज़र डालती हूँ।'],
  },
  writing: {
    match: /write|draft|compose|rewrite|email|लिख|मसौदा|likho/iu,
    en: ['Let me find the right words.', 'I’ll keep the wording clear.', 'Let me shape that thought.', 'I’ll work on the phrasing.', 'Let me keep this concise.', 'I’ll put that into words.', 'Let me consider the tone.', 'I’ll make the wording natural.', 'Let me organize the wording.', 'I’ll focus on your main point.'],
    hi: ['सही शब्द सोचती हूँ।', 'बात साफ़ रखती हूँ।', 'इस विचार को शब्द देती हूँ।', 'शब्दों पर थोड़ा काम करती हूँ।', 'इसे संक्षिप्त रखती हूँ।', 'इसे शब्दों में ढालती हूँ।', 'लहजे पर ध्यान देती हूँ।', 'भाषा सहज रखती हूँ।', 'बात को क्रम में रखती हूँ।', 'आपकी मुख्य बात पर ध्यान देती हूँ।'],
  },
  summary: {
    match: /summari[sz]e|summary|recap|brief|सारांश|संक्षेप|निचोड़/iu,
    en: ['Let me pull out the key points.', 'I’ll focus on what matters.', 'Let me find the main thread.', 'I’ll keep the essentials.', 'Let me sort the main ideas.', 'I’ll look for the takeaway.', 'Let me condense that.', 'I’ll separate the key details.', 'Let me get to the core of it.', 'I’ll look at the big picture.'],
    hi: ['मुख्य बातें निकालती हूँ।', 'ज़रूरी बातों पर ध्यान देती हूँ।', 'बात का मुख्य हिस्सा देखती हूँ।', 'ज़रूरी बातें ही रखती हूँ।', 'मुख्य विचार क्रम में रखती हूँ।', 'इसका सार देखती हूँ।', 'इसे छोटा करके बताती हूँ।', 'ज़रूरी विवरण अलग करती हूँ।', 'बात के मूल तक जाती हूँ।', 'पूरी बात पर नज़र डालती हूँ।'],
  },
  calculation: {
    match: /calculat|percent|total|multiply|divide|how much|how many|गणना|जोड़|प्रतिशत|कितन|हिसाब/iu,
    en: ['Let me work that out.', 'I’ll check the numbers.', 'Let me do the calculation.', 'I’ll go through the figures.', 'Let me check the arithmetic.', 'I’ll work through the values.', 'Let me check the units.', 'I’ll take a closer look at the numbers.', 'Let me put those figures together.', 'I’ll check the calculation carefully.'],
    hi: ['हिसाब लगाती हूँ।', 'आँकड़े देखती हूँ।', 'इसकी गणना करती हूँ।', 'इन संख्याओं को देखती हूँ।', 'जोड़-घटाव देख लेती हूँ।', 'इन मानों का हिसाब करती हूँ।', 'इकाइयाँ देखती हूँ।', 'आँकड़े ध्यान से देखती हूँ।', 'इन आँकड़ों को साथ रखती हूँ।', 'हिसाब ध्यान से जाँचती हूँ।'],
  },
  scheduling: {
    match: /schedule|calendar|meeting|appointment|remind|कैलेंडर|बैठक|मीटिंग|याद दिला/iu,
    en: ['Let me check the timing.', 'I’ll look at the schedule.', 'Let me check those dates.', 'I’ll check the calendar details.', 'Let me look at the time options.', 'I’ll check how that fits.', 'Let me review the timing.', 'I’ll look at the scheduling details.', 'Let me check the date and time.', 'I’ll take a look at the calendar.'],
    hi: ['समय देखती हूँ।', 'शेड्यूल पर नज़र डालती हूँ।', 'वे तारीखें देखती हूँ।', 'कैलेंडर का विवरण देखती हूँ।', 'समय के विकल्प देखती हूँ।', 'यह कहाँ फिट होता है, देखती हूँ।', 'समय एक बार जाँचती हूँ।', 'शेड्यूल की जानकारी देखती हूँ।', 'तारीख और समय देखती हूँ।', 'कैलेंडर पर नज़र डालती हूँ।'],
  },
  workplace: {
    match: /tasks?|projects?|attendance|employee|team|deadline|काम|प्रोजेक्ट|टीम|कर्मचारी|टास्क/iu,
    en: ['Let me check the details.', 'I’ll look at the work items.', 'Let me review the status.', 'I’ll check the relevant records.', 'Let me look at the latest details.', 'I’ll check the work context.', 'Let me look through that.', 'I’ll review the information.', 'Let me check the relevant items.', 'I’ll take a look at the details.'],
    hi: ['विवरण देखती हूँ।', 'काम की सूची देखती हूँ।', 'स्थिति जाँचती हूँ।', 'संबंधित जानकारी देखती हूँ।', 'ताज़ा विवरण देखती हूँ।', 'काम का संदर्भ देखती हूँ।', 'इस पर नज़र डालती हूँ।', 'जानकारी देख लेती हूँ।', 'संबंधित काम देखती हूँ।', 'विवरण पर एक नज़र डालती हूँ।'],
  },
  navigation: {
    match: /\b(open|launch|navigate|app|browser|kholo)\b|खोल|ऐप/iu,
    en: ['Let me check where to open that.', 'I’ll check the app options.', 'Let me find the right place.', 'I’ll look for the application.', 'Let me check the destination.', 'I’ll check the available apps.', 'Let me look for that page.', 'I’ll check the opening options.', 'Let me find the right window.', 'I’ll check how to get there.'],
    hi: ['इसे कहाँ खोलना है, देखती हूँ।', 'ऐप के विकल्प देखती हूँ।', 'सही जगह खोजती हूँ।', 'ऐप ढूँढती हूँ।', 'मंज़िल देखती हूँ।', 'उपलब्ध ऐप देखती हूँ।', 'वह पेज खोजती हूँ।', 'खोलने के विकल्प देखती हूँ।', 'सही विंडो ढूँढती हूँ।', 'वहाँ पहुँचने का तरीका देखती हूँ।'],
  },
  screen: {
    match: /screen|click|select|scroll|type|send|message|स्क्रीन|क्लिक|भेज|संदेश|bhejo/iu,
    en: ['Let me check the screen.', 'I’ll look at the current view.', 'Let me find the right control.', 'I’ll check the next step.', 'Let me look at the layout.', 'I’ll check the available controls.', 'Let me see where things are.', 'I’ll look at the active window.', 'Let me check the current step.', 'I’ll look for the right option.'],
    hi: ['स्क्रीन देखती हूँ।', 'अभी का दृश्य देखती हूँ।', 'सही कंट्रोल ढूँढती हूँ।', 'अगला कदम देखती हूँ।', 'लेआउट पर नज़र डालती हूँ।', 'उपलब्ध कंट्रोल देखती हूँ।', 'चीज़ें कहाँ हैं, देखती हूँ।', 'खुली विंडो देखती हूँ।', 'अभी का कदम जाँचती हूँ।', 'सही विकल्प खोजती हूँ।'],
  },
  research: {
    match: /weather|news|search|find|look up|latest|internet|मौसम|खबर|खोज|ढूँढ|ताज़ा|khojo/iu,
    en: ['Let me look that up.', 'I’ll check the sources.', 'Let me find the relevant information.', 'I’ll check what’s current.', 'Let me look into that.', 'I’ll look for reliable details.', 'Let me check the available information.', 'I’ll look for a clear answer.', 'Let me check the latest information.', 'I’ll look at the relevant sources.'],
    hi: ['इसके बारे में खोजती हूँ।', 'स्रोत देखती हूँ।', 'संबंधित जानकारी ढूँढती हूँ।', 'अभी की जानकारी देखती हूँ।', 'इसके बारे में पता करती हूँ।', 'भरोसेमंद विवरण खोजती हूँ।', 'उपलब्ध जानकारी देखती हूँ।', 'साफ़ जवाब ढूँढती हूँ।', 'ताज़ा जानकारी जाँचती हूँ।', 'संबंधित स्रोतों पर नज़र डालती हूँ।'],
  },
  comparison: {
    match: /compare|versus|better|which|choose|difference|तुलना|बेहतर|कौन|अंतर|चुन/iu,
    en: ['Let me weigh those options.', 'I’ll compare the key points.', 'Let me look at the differences.', 'I’ll consider both sides.', 'Let me check what matters most.', 'I’ll look at the trade-offs.', 'Let me put the options side by side.', 'I’ll think through the choice.', 'Let me compare the details.', 'I’ll focus on the important differences.'],
    hi: ['विकल्पों पर विचार करती हूँ।', 'मुख्य बातों की तुलना करती हूँ।', 'अंतर देखती हूँ।', 'दोनों पहलू देखती हूँ।', 'सबसे ज़रूरी बात देखती हूँ।', 'फ़ायदे और कमियाँ देखती हूँ।', 'विकल्प साथ रखकर देखती हूँ।', 'चुनाव पर थोड़ा सोचती हूँ।', 'विवरण की तुलना करती हूँ।', 'ज़रूरी अंतर पर ध्यान देती हूँ।'],
  },
  reasoning: {
    match: /what|why|how|explain|would|should|क्यों|कैसे|समझा|क्या|kya|kyun|kaise|samjhao/iu,
    en: ['Let me think that through.', 'I’ll work through the idea.', 'Let me consider the question.', 'I’ll look at the reasoning.', 'Let me connect the pieces.', 'I’ll think about the key point.', 'Let me work through that.', 'I’ll find a clear way to explain.', 'Let me consider the context.', 'I’ll look at the underlying idea.'],
    hi: ['इस पर सोचती हूँ।', 'इस विचार को समझती हूँ।', 'सवाल पर विचार करती हूँ।', 'इसका तर्क देखती हूँ।', 'बातों को जोड़कर देखती हूँ।', 'मुख्य बात पर सोचती हूँ।', 'इसे समझकर बताती हूँ।', 'समझाने का साफ़ तरीका सोचती हूँ।', 'संदर्भ पर विचार करती हूँ।', 'इसके पीछे का विचार देखती हूँ।'],
  },
}
const openings = { en: ['', 'Okay, ', 'All right, '], hi: ['', 'अच्छा, ', 'ठीक है, '] }
export const MIRA_FILLER_LIBRARY = Object.freeze(Object.entries(groups).flatMap(([category, group]) => ['en', 'hi'].flatMap(language =>
  group[language].flatMap((body, core) => openings[language].map((prefix, variant) => ({ id: `${category}:${language}:${core}:${variant}`, core: `${category}:${language}:${core}`, category, language,
    text: `[warm][fast] ${prefix}${prefix && language === 'en' && !body.startsWith('I') ? body[0].toLowerCase() + body.slice(1) : body}` }))))))

export function miraFillerCategory(text) { return Object.entries(groups).find(([, group]) => group.match.test(text))?.[0] || null }

export function createMiraFillerSelector(random = Math.random) {
  const recent = [], cores = []
  return (category, language) => {
    const entries = MIRA_FILLER_LIBRARY.filter(item => item.category === category && item.language === language)
    const unseen = entries.filter(item => !recent.includes(item.id))
    const candidates = unseen.length ? unseen : entries.filter(item => !recent.slice(-12).includes(item.id))
    const novel = candidates.filter(item => !cores.slice(-7).includes(item.core))
    const pool = novel.length ? novel : candidates
    if (!pool.length) return null
    const selected = pool[Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length))]
    recent.push(selected.id); cores.push(selected.core)
    if (recent.length > 80) recent.shift()
    if (cores.length > 20) cores.shift()
    return selected.text
  }
}
