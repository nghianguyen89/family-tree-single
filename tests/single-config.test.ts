import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import { singleDeploymentConfig } from '../utils/single-config'

const env = {
  FAMILY_ID: '',
  APP_URL: 'http://localhost:3000',
  SITE_NAME: 'Example family',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ssssssssssssssssssss.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
    'sb_publishable_single_fixture_only'
}

test('single configuration requires no family directory and projects only public fields', () => {
  const config = singleDeploymentConfig({
    ...env,
    SUPABASE_SERVICE_ROLE_KEY: 'private-key-sentinel',
    SUPABASE_DB_URL: 'private-database-sentinel'
  })
  assert.equal(config.id, 'single')
  assert.equal(config.siteName, env.SITE_NAME)
  assert.equal(config.appUrl, env.APP_URL)
  assert.equal(config.logo, '')
  assert.ok(!JSON.stringify(config).includes('sentinel'))
  assert.equal(
    singleDeploymentConfig({ ...env, SITE_NAME: '' }).siteName,
    'Gia Phả'
  )
  for (const patch of [
    { FAMILY_ID: 'missing' },
    { APP_URL: '' },
    { APP_URL: 'http://family.example' },
    { APP_URL: 'https://family.example/path' },
    { APP_URL: 'https://user:password@family.example' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://untrusted.example' },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: '' }
  ])
    assert.throws(() => singleDeploymentConfig({ ...env, ...patch }))
})

test('single build and runtime enforce the selected project and origin', () => {
  execFileSync(
    process.execPath,
    [
      '-e',
      `
    import assert from 'node:assert/strict';
    import config from './next.config.ts';
    process.env.NEXT_PUBLIC_FAMILY_CONFIG=config.env.NEXT_PUBLIC_FAMILY_CONFIG;
    const {getDeploymentConfig}=await import('./utils/deployment.ts');
    assert.equal(getDeploymentConfig().id,'single');
    process.env.APP_URL='https://other.example';
    assert.throws(getDeploymentConfig);
    process.env.APP_URL=${JSON.stringify(env.APP_URL)};
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://xxxxxxxxxxxxxxxxxxxx.supabase.co';
    assert.throws(getDeploymentConfig);
    process.env.NEXT_PUBLIC_SUPABASE_URL=${JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL)};
    process.env.SUPABASE_SERVICE_ROLE_KEY='not-a-valid-key';
    assert.throws(getDeploymentConfig);
    process.env.SUPABASE_SERVICE_ROLE_KEY='';
    process.env.SUPABASE_DB_URL='postgresql://postgres:fixture@db.xxxxxxxxxxxxxxxxxxxx.supabase.co/postgres';
    assert.throws(getDeploymentConfig);
  `
    ],
    {
      env: {
        ...process.env,
        ...env,
        APP_MODE: 'family',
        NEXT_PUBLIC_APP_MODE: 'family',
        SUPABASE_SERVICE_ROLE_KEY: '',
        SUPABASE_DB_URL: ''
      },
      stdio: 'pipe'
    }
  )
})
