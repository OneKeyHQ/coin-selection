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
    'matches body set tags and omits empty signature collections, tagged=%s',
    async tagged => {
      const original = fixtures.sign[0].hex;
      const body = tagged
        ? CardanoWasm.TransactionBody.from_hex(original).to_hex()
        : original;
      const fixed = CardanoWasm.FixedTransaction.new_from_body_bytes(
        Buffer.from(body, 'hex'),
      );
      const key = CardanoWasm.PrivateKey.generate_ed25519();
      const witness = {
        pubKey: key.to_public().to_hex(),
        signature: key.sign(fixed.transaction_hash().to_bytes()).to_hex(),
        chainCode: '11'.repeat(32),
      };
      for (const types of [[], [0], [1], [0, 1]]) {
        const witnesses = types.map(type => ({ ...witness, type }));
        const signed = await utils.signTransaction(body, witnesses);
        const tx = CardanoWasm.FixedTransaction.from_hex(signed);
        expect(Buffer.from(tx.raw_body()).toString('hex')).toBe(body);
        expect(tx.transaction_hash().to_hex()).toBe(
          fixed.transaction_hash().to_hex(),
        );
        expect(CardanoWasm.has_transaction_set_tag(tx.to_bytes())).toBe(
          tagged
            ? CardanoWasm.TransactionSetsState.AllSetsHaveTag
            : CardanoWasm.TransactionSetsState.AllSetsHaveNoTag,
        );
        expect(tx.witness_set().vkeys()?.len() ?? 0).toBe(
          types.includes(1) ? 1 : 0,
        );
        expect(tx.witness_set().bootstraps()?.len() ?? 0).toBe(
          types.includes(0) ? 1 : 0,
        );
        expect(tx.raw_witness_set()[0]).toBe(0xa0 + types.length);
        expect(
          await utils.signTransaction(body, witnesses, { signOnly: true }),
        ).toBe(Buffer.from(tx.raw_witness_set()).toString('hex'));
      }
    },
  );

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
