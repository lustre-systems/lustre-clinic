import { join } from 'node:path';

type Section = { version: string; major: number; text: string };

const source = await Bun.file(join(import.meta.dir, '..', 'CHANGELOG.md')).text();
const lines = source.trimEnd().split('\n');

const isLinkRef = (line: string) => /^\[[^\]]+\]: \S+$/.test(line);
const links = lines.filter(isLinkRef);
const body = lines.filter((line) => !isLinkRef(line));

const firstHeading = body.findIndex((line) => line.startsWith('## '));
const intro = body.slice(0, firstHeading).join('\n').trim();

const sections: Section[] = [];
for (let start = firstHeading; start !== -1 && start < body.length; ) {
    const next = body.findIndex((line, i) => i > start && line.startsWith('## '));
    const end = next === -1 ? body.length : next;
    const version = body[start]?.match(/^## \[([^\]]+)\]/)?.[1];
    if (version && version !== 'Unreleased') {
        sections.push({
            version,
            major: Number(version.split('.')[0]),
            text: body.slice(start, end).join('\n').trim(),
        });
    }
    start = next;
}

const [command, arg] = Bun.argv.slice(2);

if (command === 'notes' && arg) {
    const version = arg.replace(/^v/, '');
    const section = sections.find((s) => s.version === version);
    if (!section) {
        console.error(`CHANGELOG.md has no [${version}]. Move [Unreleased] under it before tagging.`);
        process.exit(1);
    }
    const entries = section.text.split('\n').slice(1).join('\n').trim();
    const compare = links.find((link) => link.startsWith(`[${version}]: `))?.split(': ')[1];
    console.log(compare ? `${entries}\n\n**Full diff:** ${compare}` : entries);
} else if (command === 'wiki' && arg) {
    const majors = [...new Set(sections.map((s) => s.major))].sort((a, b) => b - a);
    const [current, ...older] = majors;
    const pageName = (major: number) => (major === current ? 'Changelog' : `Changelog-${major}.x`);
    const nav = older.length
        ? `Older releases: ${older.map((m) => `[${m}.x](${pageName(m)})`).join(' · ')}`
        : '';

    for (const major of majors) {
        const title =
            major === current ? intro.replace(/^# .*\n+/, '') : `Every ${major}.x release, newest first.`;
        const page = [
            title,
            major === current ? nav : `Newer releases: [Changelog](Changelog)`,
            ...sections.filter((s) => s.major === major).map((s) => s.text),
            links.join('\n'),
        ]
            .filter(Boolean)
            .join('\n\n');
        await Bun.write(join(arg, `${pageName(major)}.md`), `${page}\n`);
    }
} else {
    console.error('Usage: bun scripts/changelog.ts notes vX.Y.Z | wiki <dir>');
    process.exit(1);
}
