// ../admin-console/AdminConsoleFrontend.ts
import { AdminHttpClient } from './http/AdminHttpClient';
import { AdminInputValidator } from './validation/AdminInputValidator';
import { AdminStoreFormAdapter } from './adapters/AdminStoreFormAdapter';
import { AdminContractCallSequencer } from './wallet/AdminContractCallSequencer';
import type { AdminPollerStatusDTO } from '/src/contracts/domain';

export async function onCreateStoreSubmit(
  e: Event,
  form: {
    principal: string;
    name?: string;
    display_name?: string;
    logo_url?: string;
    brand_color?: string;
    webhook_url?: string;
    support_email?: string;
    support_url?: string;
    allowed_origins?: string;
  },
  authHeader: string,
): Promise<void> {
  e.preventDefault();
  AdminInputValidator.assertStacksAddress(form.principal, 'principal');
  const body = AdminStoreFormAdapter.toCreateStoreBody(form);
  const resp = await AdminHttpClient.request('/stores', { method: 'POST', authHeader, jsonBody: body });
  if (resp.status === 201) {
    await AdminHttpClient.parseJson(resp);
    return;
  }
  if (resp.status === 409) {
    throw new Error('conflict');
  }
  throw new Error(`create_store_failed_${resp.status}`);
}

export async function onActivateToggle(storeId: string, active: boolean, authHeader: string): Promise<void> {
  AdminInputValidator.assertUuid(storeId, 'storeId');
  const resp = await AdminHttpClient.request(`/stores/${storeId}/activate`, {
    method: 'PATCH',
    authHeader,
    jsonBody: { active },
  });
  if (resp.ok) {
    await AdminHttpClient.parseJson(resp);
    return;
  }
  throw new Error(`activate_toggle_failed_${resp.status}`);
}

export async function onRotateKeysClick(
  storeId: string,
  authHeader: string,
): Promise<{ apiKey: string; hmacSecret: string }> {
  AdminInputValidator.assertUuid(storeId, 'storeId');
  const resp = await AdminHttpClient.request(`/stores/${storeId}/rotate-keys`, {
    method: 'POST',
    authHeader,
  });
  if (!resp.ok) throw new Error(`rotate_keys_failed_${resp.status}`);
  const json = await AdminHttpClient.parseJson<{ apiKey: string; hmacSecret: string }>(resp);
  return { apiKey: String(json.apiKey), hmacSecret: String(json.hmacSecret) };
}

export async function onSyncOnchainClick(
  storeId: string,
  authHeader: string,
  openContractCall: (call: any) => Promise<void>,
): Promise<void> {
  AdminInputValidator.assertUuid(storeId, 'storeId');
  const resp = await AdminHttpClient.request(`/stores/${storeId}/sync-onchain`, {
    method: 'POST',
    authHeader,
  });
  if (!resp.ok) throw new Error(`sync_onchain_failed_${resp.status}`);
  const json = await AdminHttpClient.parseJson<{ calls: any[] }>(resp);
  await AdminContractCallSequencer.runSequential(Array.isArray(json.calls) ? json.calls : [], openContractCall);
}

export async function onSetSbtcTokenSubmit(
  e: Event,
  form: { contractAddress: string; contractName: string },
  authHeader: string,
  openContractCall: (call: any) => Promise<void>,
): Promise<void> {
  e.preventDefault();
  AdminInputValidator.assertContractPrincipalPair(form.contractAddress, form.contractName);
  const resp = await AdminHttpClient.request('/set-sbtc-token', {
    method: 'POST',
    authHeader,
    jsonBody: { contractAddress: form.contractAddress, contractName: form.contractName },
  });
  if (!resp.ok) throw new Error(`set_sbtc_token_failed_${resp.status}`);
  const json = await AdminHttpClient.parseJson<{ call: any }>(resp);
  await AdminContractCallSequencer.runSingle(json.call, openContractCall);
}

export async function onRestartPollerClick(authHeader: string): Promise<{ running: boolean }> {
  const resp = await AdminHttpClient.request('/poller/restart', { method: 'POST', authHeader });
  if (!resp.ok) throw new Error(`restart_poller_failed_${resp.status}`);
  const json = await AdminHttpClient.parseJson<AdminPollerStatusDTO>(resp);
  return { running: !!json.running };
}

export async function onRetryWebhookClick(webhookLogId: string, authHeader: string): Promise<void> {
  AdminInputValidator.assertUuid(webhookLogId, 'webhookLogId');
  const resp = await AdminHttpClient.request('/webhooks/retry', {
    method: 'POST',
    authHeader,
    jsonBody: { webhookLogId },
  });
  if (resp.status === 200 || resp.status === 202) return;
  throw new Error(`retry_webhook_failed_${resp.status}`);
}

export async function onCancelInvoiceClick(
  invoiceId: string,
  authHeader: string,
  maybeBuildOnchainCancel: () => Promise<any | undefined>,
  openContractCall: (call: any) => Promise<void>,
): Promise<void> {
  AdminInputValidator.assertUuid(invoiceId, 'invoiceId');
  const resp = await AdminHttpClient.request(`/invoices/${invoiceId}/cancel`, {
    method: 'POST',
    authHeader,
  });
  if (resp.status === 400) {
    const j = await AdminHttpClient.parseJson<{ error?: string }>(resp);
    if (j?.error === 'already_paid') throw new Error('already_paid');
    throw new Error('cancel_invoice_bad_request');
  }
  if (!resp.ok) throw new Error(`cancel_invoice_failed_${resp.status}`);
  await AdminHttpClient.parseJson(resp);
  const cancelCall = await maybeBuildOnchainCancel();
  if (cancelCall) await AdminContractCallSequencer.runSingle(cancelCall, openContractCall);
}

export async function onBootstrapAdminClick(
  authHeader: string,
  buildCall: () => Promise<any>,
  openContractCall: (call: any) => Promise<void>,
  verifyGetAdmin: () => Promise<boolean>,
): Promise<void> {
  const call = await buildCall();
  await AdminContractCallSequencer.runSingle(call, openContractCall);
  const ok = await verifyGetAdmin();
  if (!ok) throw new Error('bootstrap_admin_verification_failed');
}
