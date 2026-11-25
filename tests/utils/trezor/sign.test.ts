import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import * as utils from '../../../src/utils/trezor/sign';
import * as fixtures from './fixtures/sign';

describe('trezor sign utils', () => {
  fixtures.sign.forEach(f => {
    test(f.description, async () => {
      const signedTx = await utils.signTransaction(f.hex, f.witnesses, {
        testnet: f.testnet,
      });
      expect(
        await utils.signTransaction(f.hex, f.witnesses, { testnet: f.testnet }),
      ).toBe(f.signedTx);

      const tx = CardanoWasm.FixedTransaction.from_hex(signedTx);
      const txhash = tx.transaction_hash().to_hex();

      // just sanity check, signing shouldn't change the hash
      expect(txhash).toBe(f.txHash);
      expect(Buffer.from(tx.raw_body()).toString('hex')).toBe(f.hex);
      const vkeys = tx.witness_set().vkeys();
      if (!vkeys) throw new Error('Missing vkey witnesses');
      for (let i = 0; i < vkeys.len(); i++) {
        const witness = vkeys.get(i);
        expect(
          witness
            .vkey()
            .public_key()
            .verify(tx.transaction_hash().to_bytes(), witness.signature()),
        ).toBe(true);
      }
    });
  });

  test.each([false, true])(
    'rejects signatures for a different body with signOnly=%s',
    async signOnly => {
      const fixture = fixtures.sign[0];
      const body = CardanoWasm.TransactionBody.from_hex(fixture.hex).to_hex();
      await expect(async () =>
        utils.signTransaction(body, fixture.witnesses, { signOnly }),
      ).rejects.toMatchObject({ code: 1 });
    },
  );
});
