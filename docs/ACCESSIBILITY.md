# Accessibility

What the app does for people using a screen reader (TalkBack on Android, VoiceOver on iOS), large text, or reduced
motion, how it is checked, and what has **not** been checked.

## What is built in

- **Every button has a role and words.** Buttons say "button"; icon-only ones ("+", "−") have labels ("Zoom in");
  choices (chips, radio rows, priority pills) report whether they are selected; the voice toggle reports on/off.
- **Every text box and switch has a label** ("Your message", "Include my location in this message"), not just a placeholder.
- **Headings are marked**, so a screen reader can jump between sections.
- **The route map** is announced as an image with its length, and says the turn-by-turn list below has the same
  information in words. The roads themselves are drawn shapes and are not navigable by touch.
- **Live directions with a screen reader on** are announced through the screen reader (one voice, in the person's
  own speech settings) instead of the app's own text-to-speech talking over it. With no screen reader, the app's
  spoken directions work as before and can be turned off.
- **The status card** reads as one sentence ("Mesh network: Unstable connection. 0 devices nearby. 0 percent of
  messages delivered") and its pulsing dot stops when the phone's "reduce motion" setting is on.
- **Alert cards** are read with their priority in words, not just a coloured dot.
- **Text size:** nothing opts out of font scaling. At the largest system size (200%) the home, alert and directions
  screens reflow; the status card, which used to be cut off ("0 devic..."), now wraps.
- **Colour contrast:** text and button colours meet WCAG AA (4.5:1). Blue links, green buttons and grey secondary
  text on light screens, and secondary text and placeholders on dark screens, were darkened or lightened to get there.
- **Touch targets:** every button's touch area is 10 points larger on each side than it looks.

## How it is kept that way

`__tests__/accessibility.test.js` scans every screen and component and fails on a button without a role, a
symbol-only button without a label, a text box or switch without a label, an image without a label, or font scaling
turned off; it also checks the colour pairs above and that the colours that used to fail are not used again.
Run it with the rest of the tests (`npm test` in `app`). The scanner itself is tested too.

## Not checked

- **Real screen readers.** No one has used the app with TalkBack or VoiceOver, so reading order, focus order,
  and how natural the labels sound are untested. The automated scan finds missing labels, not bad ones.
- **Switch control, keyboard and voice control.**
- **iOS** (text size, VoiceOver), and Android's "bold text", "high contrast text" and "colour correction".
- **Screens not looked at at 200% text:** Saved places, Report a road, Settings, Offline maps and Find help nearby
  were built the same way but only the home, alert and directions screens were seen at that size.
- **Colour alone:** some status colours (green/amber/red dots for signal strength) rely on colour; most have text
  beside them, but this was not audited screen by screen.
- Other languages (the app is English only).
