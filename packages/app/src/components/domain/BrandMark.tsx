/**
 * The Lustre Clinics mark. Three forms. `mark` is the bare L and `lockup` is
 * the standalone Lustre wordmark — both redraw the master outlines from
 * `assets/brand/`, because a badge a few points wide has to take its tone from
 * the theme to stay legible when the surface inverts, which an imported file
 * cannot do.
 *
 * `clinic` is the primary colour logo, and it is the asset itself:
 * `assets/brand/lustre-clinics-colour.svg` imported through the Metro
 * transformer (see metro.config.js), gradient, blue CLINICS and all. It is
 * fixed-colour by definition — the brand's own values, not the theme's — so it
 * belongs on a light ground only, where the product is introducing itself
 * rather than labelling a screen. `tone` does not apply to it.
 */
import Svg, { G, Path } from 'react-native-svg';
import ClinicLogo from '../../../assets/brand/lustre-clinics-colour.svg';
import { color } from '../../theme';

export type BrandMarkProps = {
    variant?: 'mark' | 'lockup' | 'clinic';
    /** Cap height of the L in points. The wordmark scales with it. */
    size?: number;
    tone?: 'ink' | 'muted' | 'inverse';
};

/** Master outline, viewBox 0 0 100 118. Kept in sync with lustre-L-mark.svg. */
const MARK_PATH =
    'M42 2 L64 0 C52 31 41 67 34 93 C31.8 100.5 34.6 103 43.5 103 H55 L50.5 118 H9 C1 118 -1 113 1 106 C8 75 25 32 42 2 Z M63 103 H96 L100 118 H58.5 Z';

/**
 * USTRE, stroked rather than set in a font: the letters are custom, not type.
 * Each letter's offset in the file is folded into its path here.
 * Kept in sync with lustre-wordmark-mono.svg, whose viewBox is 168 × 52 and
 * whose L is the master outline scaled by 0.36.
 */
const USTRE = [
    'M1.1 0 V13.5 C1.1 18.6 3.8 21 9 21 C14.2 21 16.9 18.6 16.9 13.5 V0',
    'M41.6 3.2 C39.8 1.4 37.4 1 34.1 1 C29.5 1 26.3 3 26.3 6.1 C26.3 9.5 29.7 10.3 34.2 11.3 C38.8 12.3 41.8 13.7 41.8 16.6 C41.8 19.7 38.6 21 34.1 21 C30.5 21 27.8 20 25.5 17.8',
    'M50 1.1 H69 M59.5 1.1 V22',
    'M78.1 22 V1.1 H86.1 C91.2 1.1 94 3.1 94 6.5 C94 9.9 91.2 12 86.1 12 H78.1 M87.8 14.7 L94.4 22',
    'M119.5 1.1 H104.1 V20.9 H119.5 M108.1 10.8 H118.1',
];
const WORDMARK_RATIO = 168 / 52;
/** The wordmark's height per point of L cap height. */
const WORDMARK_PER_CAP = 52 / (118 * 0.36);

/**
 * The file's canvas: the ink (the cut USTRE ends at x ≈ 163) plus a 4-unit
 * margin, so the logo centres wherever it is placed.
 */
const CLINIC_VIEWBOX = { width: 167, height: 78 };

const TONE = {
    ink: color.ink,
    muted: color.muted,
    inverse: color.inverse,
} as const;

export function BrandMark({ variant = 'mark', size = 16, tone = 'ink' }: BrandMarkProps) {
    if (variant === 'clinic') {
        // Height-driven like the other two, so a caller passing `size` gets a
        // mark of the same optical weight whichever variant it asked for.
        const height = size * 2.4;
        return (
            <ClinicLogo
                width={(height * CLINIC_VIEWBOX.width) / CLINIC_VIEWBOX.height}
                height={height}
                viewBox={`0 0 ${CLINIC_VIEWBOX.width} ${CLINIC_VIEWBOX.height}`}
                accessibilityRole="image"
                accessibilityLabel="Lustre Clinics"
            />
        );
    }

    const fill = TONE[tone];

    if (variant === 'mark') {
        return (
            <Svg width={(size * 100) / 118} height={size} viewBox="0 0 100 118">
                <Path d={MARK_PATH} fill={fill} />
            </Svg>
        );
    }

    const height = size * WORDMARK_PER_CAP;
    return (
        <Svg
            width={height * WORDMARK_RATIO}
            height={height}
            viewBox="0 0 168 52"
            accessibilityRole="image"
            accessibilityLabel="Lustre Clinics"
        >
            <Path d={MARK_PATH} fill={fill} transform="translate(4 4) scale(0.36)" />
            <G
                fill="none"
                stroke={fill}
                strokeWidth={2.2}
                strokeLinejoin="round"
                transform="translate(44 24.6738) scale(0.992099)"
            >
                {USTRE.map((d) => (
                    <Path key={d} d={d} />
                ))}
            </G>
        </Svg>
    );
}
