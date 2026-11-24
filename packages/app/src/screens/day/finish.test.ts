import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { finishPress } from './finish';

const DAY_ROOT = path.resolve(import.meta.dir);

async function read(file: string): Promise<string> {
    return Bun.file(path.join(DAY_ROOT, file)).text();
}

function body(source: string, name: string): string {
    return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n {4}\\}`))?.[0] ?? '';
}

describe('a Finish tap', () => {
    it('asks when the clinic has the question on', () => {
        expect(finishPress(true, false)).toBe('ask');
    });

    it('asks before settings have loaded, because the question is on by default', () => {
        expect(finishPress(undefined, false)).toBe('ask');
    });

    it('finishes straight away when the clinic has turned the question off', () => {
        expect(finishPress(false, false)).toBe('finish');
    });

    it('is refused while a finish or an editor load is in flight', () => {
        expect(finishPress(true, true)).toBe('ignore');
        expect(finishPress(false, true)).toBe('ignore');
    });
});

describe('the doctor day wiring', () => {
    it('sends both Finish buttons through the prompt', async () => {
        const screen = await read('DoctorDayScreen.tsx');

        expect(screen.match(/onFinish=\{pressFinish\}/g)).toHaveLength(2);
        expect(screen).not.toContain('onFinish={finishVisit}');
    });

    it('finishes without editing through the Finish the button always made', async () => {
        const screen = await read('DoctorDayScreen.tsx');

        const skip = screen.match(/<FinishSheet[\s\S]*?onFinish=\{\(\) => \{([\s\S]*?)\}\}/)?.[1] ?? '';
        expect(skip).toContain('finishVisit(asking.appointment)');
        expect(body(screen, 'finishVisit')).toContain('finish.mutate(appointment.id');
    });

    it('edits into the visit editor in its finishing form', async () => {
        const screen = await read('DoctorDayScreen.tsx');

        const edit = screen.match(/onEdit=\{\(\) => \{([\s\S]*?)\}\}/)?.[1] ?? '';
        expect(edit).toContain('recordVisit(asking.appointment, true)');
        expect(body(screen, 'recordVisit')).toContain('loadVisit.mutate(appointment.id');
        expect(screen).toContain('finishing={editing.finishing}');
    });

    it('dismisses without writing anything', async () => {
        const screen = await read('DoctorDayScreen.tsx');
        const sheet = await read('components/FinishSheet.tsx');

        expect(sheet).toContain('onClose={onClose}');
        expect(sheet).not.toContain('onClose={onFinish}');
        expect(sheet).not.toContain('onClose={onEdit}');

        expect(screen).toMatch(/<FinishSheet[\s\S]*?onClose=\{closeFinishSheet\}/);
        const close = screen.match(/const closeFinishSheet = ([^\n]*)/)?.[1] ?? '';
        expect(close).toBe('() => setAsking((current) => ({ ...current, open: false }));');
    });
});

describe('the finishing editor', () => {
    it('has one button, and it saves before it sends to the desk', async () => {
        const visit = await read('components/VisitScreen.tsx');

        const footer = visit.match(/\{finishing \? \(([\s\S]*?)\) : \(/)?.[1] ?? '';
        expect(footer).toContain('onPress={handToDesk}');
        expect(footer).not.toContain('onPress={confirm}');

        const handToDesk = body(visit, 'handToDesk');
        expect(handToDesk).toMatch(/save\(\(\) =>\s*sendToDesk\.mutate\(appointment\.id/);
        expect(body(visit, 'save')).toMatch(/onSuccess: \(priced\) => \{[\s\S]*?then\(priced\)/);
    });
});
