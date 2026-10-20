import { randomBytes } from 'node:crypto';

/** "Nechtové štúdio Žaneta" → "nechtove-studio-zaneta" */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'salon';
}

export function slugWithSuffix(base: string): string {
  return `${base}-${randomBytes(3).toString('hex')}`;
}
