import { expect, type Locator } from '@playwright/test';

export async function inspectInstrument(tile: Locator): Promise<void> {
  await tile.click({ button: 'right' });
  const inspect = tile.page().getByRole('menuitem', { name: 'Inspect', exact: true });
  await expect(inspect).toBeFocused();
  await inspect.click();
}
