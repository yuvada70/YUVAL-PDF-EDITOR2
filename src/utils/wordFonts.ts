/**
 * Maps a PDF-embedded font's name to a font family that's actually
 * available in Word, since embedded/subsetted PDF fonts essentially never
 * exist on the reader's machine. There's no way to reliably identify a
 * font family Word has installed from a PDF-side name alone, so this falls
 * back by two signals that usually survive subsetting: whether the name
 * suggests a serif design, and whether the text itself is Hebrew or Latin.
 */

const SERIF_HINT_RE = /times|georgia|garamond|cambria|serif|minion|palatino|book\s?antiqua|century/i;

export function mapFontFamily(pdfFontName: string, isHebrew: boolean): string {
  const serif = SERIF_HINT_RE.test(pdfFontName);
  if (isHebrew) {
    return serif ? 'Frank Ruehl CLM' : 'David';
  }
  return serif ? 'Times New Roman' : 'Arial';
}
