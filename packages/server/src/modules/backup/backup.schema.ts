import { z } from 'zod';

export const linkDriveInput = z.object({
    code: z.string().min(1).max(2048),
    codeVerifier: z.string().min(43).max(128),
    account: z.string().max(320).optional(),
});
