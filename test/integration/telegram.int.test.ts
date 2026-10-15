import { describe, expect, it, vi } from 'vitest';
import { TelegramClient, globalFetch } from '@image-host/provider-clients/telegram';

/**
 * The Telegram client's default `fetch`, in the only runtime that can judge it.
 *
 * workerd exposes `fetch` as `JSG_METHOD(fetch)` on `ServiceWorkerGlobalScope`, so
 * it must be invoked with `this === globalThis`. Handing it any other receiver
 * throws `TypeError: Illegal invocation` before the native callback runs — which
 * is what every Telegram call in production was doing, since the client stored
 * the bare global on an instance and called it as a method.
 *
 * Neither `tsc` nor ESLint can see this: `typeof fetch` is a plain function
 * signature. Neither can the node suite: Node's `fetch` is not receiver-checked,
 * so the identical code passes under vitest. Every unit test in
 * `test/providers/telegram.test.ts` also injects a stub, which means the default
 * parameter — the only value production uses — had no coverage anywhere.
 *
 * That is what this file is for. Nothing here asserts Telegram's behaviour, only
 * that the call leaves the isolate instead of dying on a receiver check.
 */

const env = { TELEGRAM_BOT_TOKEN: '000000:bottest-token', TELEGRAM_CHAT_ID: '-1000000000000' };

describe('the default fetch under workerd', () => {
  it('survives being invoked as a method', async () => {
    // A `data:` URL keeps this deterministic: no network, no Telegram, and the
    // illegal-invocation throw is synchronous, so a bare global fails here rather
    // than after some I/O.
    const holder = { call: globalFetch };
    const response = await holder.call('data:text/plain,ok');
    await expect(response.text()).resolves.toBe('ok');
  });

  it('is what an unconfigured TelegramClient actually dispatches through', async () => {
    // Locks the default *parameter*, which the probe above does not reach.
    //
    // Asserting on the thrown error would be worthless here: `call()` catches
    // every failure and flattens it to `BadGatewayError('Telegram is unreachable.')`,
    // so a receiver error and a genuine outage are indistinguishable from the
    // outside. What is distinguishable is whether the request was dispatched at
    // all, so that is what is asserted.
    //
    // The spy is installed *after* construction, and that ordering is the test. A
    // default parameter is evaluated at construction, so a client defaulting to
    // the bare global captured the original native — calling it as a method throws
    // before dispatch, and the spy is never reached. A wrapper resolves `fetch`
    // through the global at call time and reaches the spy.
    const client = new TelegramClient(env);
    const dispatch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    try {
      await expect(client.upload(new File(['x'], 'a.png'), 'a.png')).rejects.toThrow();
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      dispatch.mockRestore();
    }
  });
});
