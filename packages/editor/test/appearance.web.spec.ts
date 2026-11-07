import { test, expect } from './web-test';

test('appearance has three choices, follows OS live and persists explicit overrides', async ({page})=>{
  await page.emulateMedia({colorScheme:'dark'});
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const settings=page.getByRole('button',{name:/^Настройки/});
  await settings.first().click();
  const group=page.getByRole('group',{name:'Тема',exact:true});
  await expect(group.getByRole('button')).toHaveCount(3);
  await expect(group.getByRole('button',{name:'Системная'})).toHaveAttribute('aria-pressed','true');
  await group.getByRole('button',{name:'Светлая'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await settings.first().click();
  await group.getByRole('button',{name:'Тёмная'}).click();
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await group.getByRole('button',{name:'Системная'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(group.getByRole('button',{name:'Системная'})).toHaveAttribute('aria-pressed','true');
});

test('stored dark mode applies before hydration even while OS is light',async({page})=>{
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>localStorage.setItem('doompile-theme','dark'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
