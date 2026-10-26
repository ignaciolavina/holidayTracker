import { expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const PASSWORD = 'vacaciones2026';
export const email = (local: string) => `${local}@holidaytracker.local`;

export const USERS = {
  ana: email('ana.admin'),
  bruno: email('bruno.manager'),
  carla: email('carla.manager'),
  diego: email('diego.ruiz'),
  marta: email('marta.sanchez'),
  javier: email('javier.lopez'),
  lucia: email('lucia.fernandez'),
  pablo: email('pablo.martin'),
  sara: email('sara.gomez'),
};

export async function login(page: Page, userEmail: string, password = PASSWORD) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByTestId('login-email').fill(userEmail);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

export async function loginOk(page: Page, userEmail: string) {
  await login(page, userEmail);
  await expect(page.getByTestId('request-vacation-button')).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
}

/** Sesión limpia: cada rol entra con su propio contexto de cookies. */
export async function freshLogin(page: Page, userEmail: string) {
  await page.context().clearCookies();
  await loginOk(page, userEmail);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Tres días laborables (martes a jueves) en una semana futura, a partir de unas 3 semanas desde hoy.
 * `slot` desplaza semanas para que cada test use fechas distintas. Fechas siempre futuras.
 */
export function futureWindow(slot: number): { start: string; end: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 21 + slot * 7);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); // martes
  const start = iso(d);
  d.setUTCDate(d.getUTCDate() + 2);
  return { start, end: iso(d) };
}

/** Rellena el formulario de solicitud y envía; devuelve el id de la solicitud creada. */
export async function submitRequest(page: Page, w: { start: string; end: string }): Promise<string> {
  await page.getByTestId('request-vacation-button').click();
  await expect(page.getByTestId('request-form')).toBeVisible();
  await page.getByTestId('request-start').fill(w.start);
  await page.getByTestId('request-end').fill(w.end);
  await expect(page.getByTestId('preview-summary')).toBeVisible();
  await expect(page.getByTestId('preview-balance')).toContainText('→');
  const submit = page.getByTestId('request-submit');
  await expect(submit).toBeEnabled();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/requests') && r.request().method() === 'POST'),
    submit.click(),
  ]);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { id: string };
  await expect(page.getByTestId('request-vacation-button')).toBeVisible();
  return body.id;
}

/** Valor numérico del KPI (p. ej. "21,5" o "21"). */
export async function kpiValue(page: Page, id: 'available' | 'pending' | 'total'): Promise<number> {
  const text = (await page.getByTestId(`kpi-${id}-value`).innerText()).replace('−', '-');
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) throw new Error(`KPI ${id} sin número: ${text}`);
  return Number(m[0].replace(',', '.'));
}

/** Enlace de invitación del email más reciente (transporte `console`) enviado a `to`. */
export async function inviteLinkFor(to: string): Promise<string> {
  const dir = path.resolve(process.cwd(), 'server/tmp/mails');
  const safe = to.replace(/[^a-z0-9@._-]/gi, '_');
  for (let i = 0; i < 30; i++) {
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.includes(safe) && f.endsWith('.html')).sort();
    const latest = files.at(-1);
    if (latest) {
      const html = await readFile(path.join(dir, latest), 'utf8');
      const m = /href="([^"]*\/invite\?token=[^"]+)"/.exec(html) ?? /(https?:\/\/[^\s"'<>]*\/invite\?token=[A-Za-z0-9_-]+)/.exec(html);
      if (m) return m[1]!.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No se encontró email de invitación para ${to}`);
}
