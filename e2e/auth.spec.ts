import { expect, test } from '@playwright/test';
import { PASSWORD, USERS, login, loginOk, logout } from './helpers';

test.describe('Autenticación', () => {
  test('login correcto lleva al dashboard y logout vuelve al login', async ({ page }) => {
    await loginOk(page, USERS.sara);
    await expect(page.getByTestId('kpis')).toBeVisible();
    await logout(page);
    // tras cerrar sesión, una ruta privada redirige al login
    await page.goto('/');
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('login incorrecto muestra un error y no entra', async ({ page }) => {
    await login(page, USERS.sara, PASSWORD + 'x');
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('request-vacation-button')).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
  });
});
