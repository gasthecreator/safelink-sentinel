# Languages

The app is available in **English** and **Spanish** (Español). Choose in Settings, Language: "Automatic" follows the phone's
language (any Spanish setting, such as es-US or es-MX, gives Spanish; everything else gives English).

## What is translated

All the words the app shows and speaks: every screen, buttons, alerts and confirmations, accessibility labels, error
messages, the turn-by-turn directions ("Gira a la izquierda hacia Main Street"), the voice prompts ("En 200 pies, ..."), the
map's labels, distances and times (feet/miles or metres/kilometres in words), and the kinds of place on "Find help nearby".

## What is not, and why

- **What people write.** An alert, a note or a place name is shown exactly as its author wrote it, in their language.
  Receiving a Spanish alert on an English phone shows Spanish text. Automatic translation would need the internet and
  could mistranslate an emergency.
- **Names from the map**: streets, hospitals and other places keep the name OpenStreetMap has for them.
- **Diagnostics** (the technical log screen, for developers) and the **server and dashboard** (a separate web app) are English only.
  The server's keyword matching of help requests ("urgent", "bleeding"...) is English only; the phone's own "detect
  priority" button understands a few Spanish words as well.
- Store listings and these documents.

## Honest status

**The Spanish was written by an AI model, not a translator, and has not been read by a native speaker.** It aims for plain,
neutral Latin American / US Spanish with the informal "tú". Before relying on it in a real emergency, have someone fluent
read at least the directions, the help request screens and the alert texts (all in `app/services/i18n/locales/es.js`; the
English text is each entry's key, so a reviewer sees the original beside every line).

Checked on a phone only for the home, settings, alert and directions screens (all text fits, including long phrases). Not checked:
the other screens in Spanish on a phone, right-to-left languages (none are offered), and whether a Spanish text-to-speech
voice is installed (the app speaks with the phone's own voice; with no Spanish voice installed it falls back to the phone's default).

## How it works

`t("Request help")` shows the phrase in the current language. **The English text is the key**, so a missing translation
shows readable English, never a blank or a code. `tp("{count} device", "{count} devices", n)` picks singular or plural, and
`{name}` placeholders are filled in. Text defined at the top of a file (where it cannot be translated yet) is marked with
`N_("...")` and translated where it is shown: `t(item.label)`.

Services translate at the moment they build text, so the directions, warnings and spoken prompts come out in the language
that was current when the route was worked out; switching language re-works the route.

## Adding a language

1. Add it to `LANGUAGES` and `CATALOGS` in `app/services/i18n/i18n.js` and create `app/services/i18n/locales/<code>.js`
   (an object from each English phrase to its translation; plurals are `{ one, other }`).
2. Plural rules: English and Spanish use "one" for exactly 1 and "other" otherwise. A language with more forms
   (Russian, Arabic, Polish...) needs `pluralFor` in `i18n.js` extended first.
3. Run `node app/scripts/lib/i18nScan.js` to list the phrases the code asks for, then `npm test` in `app`: the test fails
   until every phrase is translated, every placeholder matches, and nothing in the catalog is left over from deleted code.
4. Add the language to the choices shown in Settings (they come from `LANGUAGES`) and to `languageForLocale` if it should
   be picked automatically.

## Keeping it complete

`__tests__/i18n.test.js` fails if a screen shows English text that is not wrapped in `t()` (it scans the JSX), if a phrase
has no translation, if a translation drops or invents a placeholder, or if a stale entry is left behind. It cannot see
text built inside code (a message assembled from pieces): review those by reading, and prefer one whole phrase with
placeholders over joining fragments, because word order differs between languages.
