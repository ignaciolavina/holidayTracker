import { expect, test } from '@playwright/test';
import { USERS, freshLogin, futureWindow, kpiValue, submitRequest } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Solicitar, aprobar y ver saldos', () => {
  const w = futureWindow(0);
  let requestId = '';
  let availableBefore = 0;

  test('Diego solicita vacaciones: previsualización y queda pendiente', async ({ page }) => {
    await freshLogin(page, USERS.diego);
    availableBefore = await kpiValue(page, 'available');
    const pendingBefore = await kpiValue(page, 'pending');

    await page.getByTestId('request-vacation-button').click();
    await page.getByTestId('request-start').fill(w.start);
    await page.getByTestId('request-end').fill(w.end);
    await expect(page.getByTestId('preview-summary')).toBeVisible();
    await expect(page.getByTestId('preview-balance')).toContainText('→');
    await expect(page.getByTestId('preview-allocation')).toBeVisible();
    await expect(page.getByTestId(`preview-day-${w.start}`)).toBeVisible();
    await page.getByTestId('request-comment').fill('Escapada e2e');
    await expect(page.getByTestId('request-submit')).toBeEnabled();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/requests') && r.request().method() === 'POST'),
      page.getByTestId('request-submit').click(),
    ]);
    expect(res.ok()).toBeTruthy();
    requestId = ((await res.json()) as { id: string }).id;

    const row = page.getByTestId('upcoming').getByTestId(`request-${requestId}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('status-PENDING')).toBeVisible();
    await expect.poll(() => kpiValue(page, 'pending')).toBeGreaterThan(pendingBefore);
  });

  test('Bruno (su manager) aprueba desde el panel de administración', async ({ page }) => {
    await freshLogin(page, USERS.bruno);
    await page.getByTestId('nav-admin').click();
    await expect(page.getByTestId('admin-dashboard')).toBeVisible();
    const approve = page.getByTestId(`approve-${requestId}`);
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(page.getByTestId(`approve-${requestId}`)).toHaveCount(0);
  });

  test('Diego ve su saldo reducido, la solicitud aprobada y la vista anual', async ({ page }) => {
    await freshLogin(page, USERS.diego);
    const row = page.getByTestId('upcoming').getByTestId(`request-${requestId}`);
    await expect(row.getByTestId('status-APPROVED')).toBeVisible();
    // el KPI "Disponibles" es del año en curso; la ventana de test cae en ese año salvo a final de diciembre
    if (w.start.slice(0, 4) === String(new Date().getFullYear())) {
      await expect.poll(() => kpiValue(page, 'available')).toBeLessThan(availableBefore);
    }
    await expect(page.getByTestId('kpi-total')).toBeVisible();

    await page.getByTestId('nav-calendar').click();
    await page.getByTestId('tab-year').click();
    await expect(page.getByTestId('year-grid')).toBeVisible();
    await expect(page.getByTestId('legend')).toBeVisible();
    const year = Number(w.start.slice(0, 4));
    const current = Number((await page.getByTestId('cal-title').innerText()).match(/\d{4}/)?.[0]);
    for (let i = current; i < year; i++) await page.getByTestId('cal-next').click();
    await expect(page.getByTestId(`day-${w.start}`)).toBeVisible();
    await expect(page.getByTestId(`day-${w.start}`)).toHaveAttribute('aria-label', /aprobad/i);
  });
});

test('Marta cancela una solicitud futura y recupera el saldo', async ({ page }) => {
  await freshLogin(page, USERS.marta);
  const pendingBefore = await kpiValue(page, 'pending');
  const id = await submitRequest(page, futureWindow(1));
  const row = page.getByTestId('upcoming').getByTestId(`request-${id}`);
  await expect(row).toBeVisible();
  await row.getByTestId(`request-cancel-${id}`).click();
  await page.getByTestId('cancel-reason').fill('Ya no puedo');
  await page.getByTestId('cancel-confirm').click();
  await expect(page.getByTestId('upcoming').getByTestId(`request-${id}`)).toHaveCount(0);
  await expect.poll(() => kpiValue(page, 'pending')).toBe(pendingBefore);
});

test('Ana anula una solicitud aprobada de otra persona (ANULAR + motivo)', async ({ page }) => {
  // Lucía solicita, Carla (su manager) aprueba y Ana la anula
  await freshLogin(page, USERS.lucia);
  const id = await submitRequest(page, futureWindow(2));

  await freshLogin(page, USERS.carla);
  await page.getByTestId('nav-admin').click();
  await page.getByTestId(`approve-${id}`).click();
  await expect(page.getByTestId(`approve-${id}`)).toHaveCount(0);

  await freshLogin(page, USERS.ana);
  await page.goto(`/approvals/${id}`);
  await expect(page.getByTestId('approval-page')).toBeVisible();
  await expect(page.getByTestId('status-APPROVED')).toBeVisible();
  await page.getByTestId('revoke-button').click();
  await expect(page.getByTestId('revoke-dialog')).toBeVisible();
  await expect(page.getByTestId('revoke-message')).toBeVisible();
  await page.getByTestId('revoke-reason').fill('Cierre de proyecto: se reorganiza el equipo');
  await expect(page.getByTestId('revoke-submit')).toBeDisabled();
  await page.getByTestId('revoke-confirm-text').fill('ANULAR');
  await page.getByTestId('revoke-submit').click();
  await expect(page.getByTestId('revoke-dialog')).toBeHidden();
  await expect(page.getByTestId('status-REVOKED')).toBeVisible();
});
