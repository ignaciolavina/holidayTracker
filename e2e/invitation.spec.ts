import { expect, test } from '@playwright/test';
import { USERS, freshLogin, inviteLinkFor } from './helpers';

test('Ana invita a una persona nueva y esta acepta la invitación', async ({ page }) => {
  const newEmail = 'nuevo.e2e@holidaytracker.local';
  await freshLogin(page, USERS.ana);

  // Administración → Usuarios → Invitar persona
  await page.getByTestId('nav-admin').click();
  await page.getByTestId('admin-nav-users').click();
  await page.getByTestId('invite-open').click();
  await expect(page.getByTestId('invite-dialog')).toBeVisible();
  await page.getByTestId('invite-email').fill(newEmail);
  await page.getByTestId('invite-name').fill('Nuria Nueva');
  await page.getByTestId('invite-submit').click();
  await expect(page.getByTestId('invite-dialog')).toBeHidden();
  await page.getByTestId('tab-invitations').click();
  await expect(page.getByTestId('invitations-table')).toContainText(newEmail);

  // El token solo viaja por email: se lee del transporte `console`
  const link = await inviteLinkFor(newEmail);
  expect(link).toContain('/invite?token=');

  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByTestId('invite-form')).toContainText('Nuria Nueva');
  await page.getByTestId('invite-password').fill('contraseña-larga-2027');
  await page.getByTestId('invite-password-again').fill('contraseña-larga-2027');
  await page.getByTestId('invite-birthday-month').selectOption('03');
  await page.getByTestId('invite-birthday-day').selectOption('17');
  await page.getByTestId('invite-submit').click();

  await expect(page.getByTestId('request-vacation-button')).toBeVisible();
  await expect(page.getByTestId('kpis')).toBeVisible();
  // el enlace es de un solo uso
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByTestId('invite-invalid')).toBeVisible();
});
