export function cutChangelog(source: string, version: string, date: string): string | null {
    if (source.includes(`\n## [${version}]`)) return null;

    const lines = source.split('\n');
    const heading = lines.indexOf('## [Unreleased]');
    if (heading === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
    const next = lines.findIndex((line, i) => i > heading && line.startsWith('## '));
    const entries = lines.slice(heading + 1, next === -1 ? undefined : next);
    if (!entries.some((line) => line.startsWith('- '))) {
        throw new Error(
            'nothing under [Unreleased] in CHANGELOG.md. Write what the clinic will notice first.',
        );
    }

    const link = lines.findIndex((line) => /^\[Unreleased\]: \S+\/compare\/\S+\.\.\.HEAD$/.test(line));
    const match = lines[link]?.match(/^\[Unreleased\]: (\S+)\/compare\/(\S+)\.\.\.HEAD$/);
    if (!match) throw new Error('CHANGELOG.md has no "[Unreleased]: …/compare/vX.Y.Z...HEAD" link');
    const [, base, previous] = match;

    lines.splice(
        link,
        1,
        `[Unreleased]: ${base}/compare/v${version}...HEAD`,
        `[${version}]: ${base}/compare/${previous}...v${version}`,
    );
    lines.splice(heading + 1, 0, '', `## [${version}] - ${date}`);
    return lines.join('\n');
}
