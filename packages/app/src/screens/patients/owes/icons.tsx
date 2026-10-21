import { GLYPH, icon } from '../../../components/domain';
import { color } from '../../../theme';

export const CaretDownIcon = icon(GLYPH.caretDown, { size: 12, stroke: color.ink2, width: 2 });

/** How long a balance has been owed, on the debtor rows. */
export const OwedForIcon = icon(GLYPH.waiting, { size: 12, stroke: color.due, width: 2.2 });
