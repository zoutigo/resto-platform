import { resetTestDb } from '../scripts/reset-test-db.mjs';
import './test-env';

export default async function setup() {
  await resetTestDb();
}
